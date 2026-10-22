import {
	Notice,
	Plugin,
	normalizePath,
} from 'obsidian';
import {
	apiRequest,
	AckResultItem,
	BindStartResponse,
	BindStatusResponse,
	isBindAuthLostError,
	isBindClaimed,
	migrateApiBaseUrl,
	resolveBindAccessToken,
	SyncArticlesResponse,
} from './api';
import {
	resolveArchiveFolder,
	buildTopicGroupsFromProfiles,
	WECHAT_MEDIA_FOLDER,
	type VaultKeywordIndex,
} from './folders';
import { countLooseWechatNotes, organizeLooseWechatArticles } from './organize';
import {
	formatArticleMarkdown,
	resolveArticleFileName,
	sanitizeFileName,
	SyncArticle,
} from './markdown';
import { DEFAULT_SETTINGS, SyncBridgeSettings, SyncBridgeSettingTab } from './settings';
import { migrateTopicProfiles, syncBuiltinTopicRules } from './topic-profiles';
import { downloadRemoteMedia, forceHttpsUrl } from './media-download';
import { createVaultIO, type VaultIO } from './vault-targets';
import {
	detectSource,
	fetchArticleByUrl,
	getSourceProfile,
	type ArticleSource,
} from './sources';

function createDeviceId(): string {
	return `vb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default class SyncBridgePlugin extends Plugin {
	settings: SyncBridgeSettings = DEFAULT_SETTINGS;
	private statusBarEl: HTMLElement | null = null;
	private lastSyncTime: Date | null = null;
	private bindingPollInterval: number | undefined;
	private activeSync: Promise<void> | null = null;
	private activeOrganize: Promise<void> | null = null;

	async onload() {
		await this.loadSettings();
		if (!this.settings.deviceId) {
			this.settings.deviceId = createDeviceId();
			await this.saveSettings();
		}

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass('vb-statusbar');
		this.updateStatusBar('idle');

		this.addRibbonIcon('link', 'SyncBridge · 拉取链接', async () => {
			await this.syncNow(true);
		});


		this.addCommand({
			id: 'pull-links',
			name: '拉取待处理链接',
			callback: async () => this.syncNow(true),
		});


		this.addCommand({
			id: 'organize-notes',
			name: '整理微信文章笔记',
			callback: async () => this.organizeNotes(true),
		});

		this.addSettingTab(new SyncBridgeSettingTab(this.app, this));
	}

	onunload() {
		if (this.bindingPollInterval) window.clearInterval(this.bindingPollInterval);
	}

	async loadSettings() {
		const loaded = ((await this.loadData()) ?? {}) as Partial<SyncBridgeSettings> & {
			subfolderByKeywords?: boolean;
			keywordRules?: string;
			useBuiltinTopicGroups?: boolean;
			topicSynonymGroups?: string;
			token?: string;
		};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		const migratedApiBase = migrateApiBaseUrl(this.settings.apiBaseUrl);
		if (migratedApiBase && migratedApiBase !== this.settings.apiBaseUrl) {
			this.settings.apiBaseUrl = migratedApiBase;
			await this.saveSettings();
			new Notice('SyncBridge：服务地址已从管理后台改为 API 地址');
		}
		if (loaded.subfolderByKeywords !== undefined && loaded.subfolderByAutoKeywords === undefined) {
			this.settings.subfolderByAutoKeywords = loaded.subfolderByKeywords;
		}
		if (!loaded.topicProfiles?.length) {
			this.settings.topicProfiles = migrateTopicProfiles(loaded);
			await this.saveSettings();
		}
		const synced = syncBuiltinTopicRules(
			this.settings.topicProfiles,
			this.settings.builtinTopicRulesVersion,
		);
		if (synced.changed) {
			this.settings.topicProfiles = synced.profiles;
			this.settings.builtinTopicRulesVersion = synced.version;
			await this.saveSettings();
		}
		const raw = this.settings as SyncBridgeSettings & { syncIntervalMinutes?: number; token?: string };
		if ('syncIntervalMinutes' in raw) {
			delete raw.syncIntervalMinutes;
			await this.saveSettings();
		}
		// 旧版仅 bindCode+userId、无 accessToken → 需重新配对
		if ((loaded.bindCode || loaded.token) && !this.settings.accessToken) {
			delete (this.settings as { token?: string }).token;
			this.settings.bindCode = '';
			this.settings.userId = '';
			this.settings.accessToken = '';
			this.settings.claimed = false;
			await this.saveSettings();
			new Notice('SyncBridge：鉴权已升级为短码配对 + 长 Token，请重新生成配对码');
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private getTargetIO(): VaultIO {
		return createVaultIO(this.app, this.settings.targetVaultId || '');
	}

	isPaired(): boolean {
		return Boolean(this.settings.accessToken && this.settings.claimed);
	}

	private authOpts() {
		return {
			accessToken: this.settings.accessToken,
		};
	}

	async startBinding(): Promise<BindStartResponse> {
		const body: Record<string, string> = {
			deviceId: this.settings.deviceId,
			deviceName: this.settings.deviceName || 'Obsidian',
			vaultName: this.app.vault.getName(),
		};
		const res = await apiRequest<BindStartResponse>(this.settings.apiBaseUrl, '/api/obsync/bind/start', {
			method: 'POST',
			// 重新绑定时带上旧 Token，服务端作废并换新短码
			accessToken: this.settings.accessToken || undefined,
			body,
		});
		// 换码后先保存新的 pending 身份，认领前暂不可同步；旧 Token 已作废
		if (res.userId) {
			this.settings.userId = res.userId;
		}
		if (res.bindCode || res.code) {
			this.settings.bindCode = res.bindCode || res.code;
		}
		this.settings.accessToken = '';
		this.settings.claimed = false;
		await this.saveSettings();
		return res;
	}

	pollBinding(code: string, onStatus: (status: BindStatusResponse) => void) {
		if (this.bindingPollInterval) window.clearInterval(this.bindingPollInterval);
		this.bindingPollInterval = window.setInterval(() => {
			void (async () => {
				try {
					const status = await apiRequest<BindStatusResponse>(
						this.settings.apiBaseUrl,
						`/api/obsync/bind/status?code=${encodeURIComponent(code)}`,
					);
					const accessToken = resolveBindAccessToken(status);
					// 先落盘配对结果，再通知 UI，避免刷新时仍显示「待配对」
					if (isBindClaimed(status?.status) && accessToken) {
						this.settings.bindCode = status.bindCode || code;
						if (status.userId) {
							this.settings.userId = status.userId;
						}
						this.settings.accessToken = accessToken;
						this.settings.unlimited = Boolean(status.unlimited);
						this.settings.claimed = true;
						await this.saveSettings();
						window.clearInterval(this.bindingPollInterval);
						this.bindingPollInterval = undefined;
						new Notice('SyncBridge 配对成功，请手动拉取链接');
					}
					if (
						status?.status === 'invalid' ||
						status?.status === 'unbound' ||
						status?.status === 'expired'
					) {
						window.clearInterval(this.bindingPollInterval);
						this.bindingPollInterval = undefined;
					}
					onStatus(status);
				} catch (error) {
					console.error('SyncBridge binding poll failed', error);
				}
			})();
		}, 2500);
	}

	async activateInvite(inviteCode: string) {
		if (!this.isPaired()) {
			throw new Error('尚未配对');
		}
		const data = await apiRequest<{ unlimited?: boolean; tip?: string }>(
			this.settings.apiBaseUrl,
			'/api/obsync/invite/activate',
			{
				method: 'POST',
				...this.authOpts(),
				body: { inviteCode },
			},
		);
		this.settings.unlimited = Boolean(data?.unlimited);
		await this.saveSettings();
		return data;
	}

	/** 调用服务端解绑并清空本地配对信息 */
	async unbindBinding(): Promise<void> {
		const accessToken = (this.settings.accessToken || '').trim();
		if (!accessToken) {
			await this.clearPairingLocal();
			return;
		}
		try {
			await apiRequest(this.settings.apiBaseUrl, '/api/obsync/bind/unbind', {
				method: 'POST',
				accessToken,
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			// Token 已在服务端失效时仍清理本地，避免卡死在「已配对」
			if (!isBindAuthLostError(error) && !/未绑定|无效|失效|401|Token/i.test(msg)) {
				throw error;
			}
		}
		await this.clearPairingLocal();
	}

	async clearPairingLocal(): Promise<void> {
		if (this.bindingPollInterval) {
			window.clearInterval(this.bindingPollInterval);
			this.bindingPollInterval = undefined;
		}
		this.settings.bindCode = '';
		this.settings.userId = '';
		this.settings.accessToken = '';
		this.settings.unlimited = false;
		this.settings.claimed = false;
		await this.saveSettings();
	}

	async syncNow(showNotice = false) {
		if (this.activeSync) {
			if (showNotice) new Notice('正在处理，请稍候');
			return this.activeSync;
		}
		this.activeSync = this.runSync(showNotice);
		try {
			await this.activeSync;
		} finally {
			this.activeSync = null;
		}
	}

	private async runSync(showNotice = false) {
		if (!this.isPaired()) {
			if (showNotice) new Notice('尚未配对，请先生成配对码并在（同步文本助手微信）小程序认领');
			return;
		}
		this.updateStatusBar('syncing');
		try {
			const response = await apiRequest<SyncArticlesResponse>(
				this.settings.apiBaseUrl,
				'/api/obsync/sync/articles',
				{ ...this.authOpts() },
			);
			const articles = response?.articles || [];
			const abandoned = response?.abandoned || [];
			if (typeof response?.unlimited === 'boolean' && this.settings.unlimited !== response.unlimited) {
				this.settings.unlimited = response.unlimited;
				await this.saveSettings();
			}

			for (const tip of abandoned) {
				new Notice(
					`三次同步失败，请手动处理：${tip.title || tip.sourceUrl || tip.id}`,
					8000,
				);
			}

			if (articles.length === 0) {
				this.updateStatusBar('idle');
				if (showNotice && response?.quotaExhausted) {
					new Notice('今日同步已达 66 篇上限。会员到期后会恢复该限制，可激活新的激活码或明天再同步');
				} else if (showNotice) {
					new Notice(
						abandoned.length
							? `暂无待处理链接（有 ${abandoned.length} 条已放弃，见提示）`
							: '暂无待处理链接',
					);
				}
				return;
			}

			const io = this.getTargetIO();
			const syncIdToPath = io.indexFrontmatter('sync_id');

			let written = 0;
			let updated = 0;
			let failed = 0;
			const ackResults: AckResultItem[] = [];

			let keywordIndex = this.settings.subfolderByAutoKeywords
				? io.buildKeywordIndex(this.settings.syncFolder)
				: undefined;

			for (let i = 0; i < articles.length; i++) {
				const article = articles[i];
				if (!article) continue;
				if (showNotice && articles.length > 1) {
					this.updateStatusBar('syncing', `${i + 1}/${articles.length}`);
				} else {
					this.updateStatusBar('syncing', `下载中…`);
				}
				try {
					let payload: SyncArticle = article as SyncArticle;
					if (
						!payload.markdown ||
						payload.parseStatus === 'link_only' ||
						payload.parseStatus === 'empty' ||
						!String(payload.markdown).trim()
					) {
						if (!payload.sourceUrl) throw new Error('缺少 sourceUrl');
						payload = await this.fetchArticleLocally(payload.sourceUrl);
						payload.id = article.id;
					}

					const archiveBase = this.resolveArchiveBase(payload);
					if (this.settings.subfolderByAutoKeywords) {
						keywordIndex = io.buildKeywordIndex(archiveBase);
					}

					const existingPath = syncIdToPath.get(article.id);
					let path: string;
					if (existingPath && io.exists(existingPath)) {
						await this.updateArticle(existingPath, payload, io);
						path = existingPath;
						updated += 1;
					} else {
						path = await this.writeArticle(payload, keywordIndex, io);
						written += 1;
						syncIdToPath.set(article.id, path);
					}
					ackResults.push({
						id: article.id,
						writtenPath: path,
						title: payload.title,
					});
				} catch (err) {
					console.error(`SyncBridge sync failed: ${article.id}`, err);
					failed += 1;
					ackResults.push({
						id: article.id,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			// 批量回写成功/失败，失败会重试，满 3 次 abandoned
			try {
				const batch = await apiRequest<{
					successCount: number;
					failCount: number;
					abandonedCount: number;
					details?: Array<{ status?: string; tip?: string; sourceUrl?: string }>;
				}>(this.settings.apiBaseUrl, '/api/obsync/sync/articles/ack-batch', {
					method: 'POST',
					...this.authOpts(),
					body: { results: ackResults },
				});
				for (const d of batch?.details || []) {
					if (d.status === 'abandoned' && d.tip) {
						new Notice(d.tip, 10000);
					}
				}
			} catch (e) {
				console.error('SyncBridge ack-batch failed', e);
				if (showNotice) {
					new Notice(`结果回写失败：${e instanceof Error ? e.message : String(e)}`);
				}
			}

			this.updateStatusBar(failed > 0 && written + updated === 0 ? 'error' : 'success');
			if (showNotice) {
				const parts: string[] = [];
				if (written > 0) parts.push(`新增 ${written}`);
				if (updated > 0) parts.push(`更新 ${updated}`);
				if (failed > 0) parts.push(`失败 ${failed}`);
				const targetHint = io.isExternal ? ` → ${io.label}` : '';
				new Notice(`SyncBridge：${parts.join('，') || '完成'}${targetHint}`);
			}
		} catch (error) {
			console.error('SyncBridge sync failed', error);
			this.updateStatusBar('error');
			if (isBindAuthLostError(error)) {
				await this.clearPairingLocal();
				new Notice(
					'（同步文本助手微信）小程序已解绑或绑定已失效，请重新生成配对码并在（同步文本助手微信）小程序认领',
					10000,
				);
				return;
			}
			if (showNotice) {
				new Notice(`拉取失败：${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	private async fetchArticleLocally(url: string): Promise<SyncArticle> {
		return fetchArticleByUrl(url);
	}

	private resolveSource(article: SyncArticle): ArticleSource {
		if (
			article.source === 'wechat' ||
			article.source === 'tencent_cloud' ||
			article.source === 'aliyun' ||
			article.source === 'xiaohongshu'
		) {
			return article.source;
		}
		return detectSource(article.sourceUrl || '');
	}

	private resolveArchiveBase(article: SyncArticle): string {
		const profile = getSourceProfile(this.resolveSource(article), this.settings.syncFolder);
		return normalizePath(profile.archiveFolder || this.settings.syncFolder || DEFAULT_SETTINGS.syncFolder);
	}

	private resolveMediaFolder(article: SyncArticle): string {
		const profile = getSourceProfile(this.resolveSource(article), this.settings.syncFolder);
		return profile.mediaFolder || WECHAT_MEDIA_FOLDER;
	}

	private resolveMediaReferer(article: SyncArticle): string {
		return getSourceProfile(this.resolveSource(article), this.settings.syncFolder).referer;
	}

	private archiveOptions(article: SyncArticle, keywordIndex?: VaultKeywordIndex) {
		return {
			subfolderByAccount: this.settings.subfolderByAccount,
			accountName: article.account || article.author,
			subfolderByAutoKeywords: this.settings.subfolderByAutoKeywords,
			title: article.title || '',
			keywordIndex,
			topicGroups: buildTopicGroupsFromProfiles(this.settings.topicProfiles),
		};
	}

	private resolveFolder(article: SyncArticle, keywordIndex?: VaultKeywordIndex): string {
		const base = this.resolveArchiveBase(article);
		return normalizePath(resolveArchiveFolder(base, this.archiveOptions(article, keywordIndex)));
	}

	private async writeArticle(
		article: SyncArticle,
		keywordIndex?: VaultKeywordIndex,
		io?: VaultIO,
	): Promise<string> {
		const target = io ?? this.getTargetIO();
		const folder = this.resolveFolder(article, keywordIndex);
		await target.ensureFolder(folder);
		const baseName = resolveArticleFileName(article);
		const path = await target.nextAvailablePath(folder, baseName);
		let content = formatArticleMarkdown(article);
		if (this.settings.localizeImages) {
			try {
				content = await this.localizeAttachments(
					content,
					article.title || baseName,
					target,
					article,
				);
			} catch (err) {
				console.warn('SyncBridge media localize failed', err);
			}
		}
		await target.writeText(path, content);
		return path;
	}

	async organizeNotes(showNotice = false) {
		if (!this.settings.subfolderByAutoKeywords) {
			if (showNotice) new Notice('请先在「归档规则」中开启智能关键词归类');
			return;
		}
		if (this.activeOrganize) {
			if (showNotice) new Notice('正在整理，请稍候');
			return this.activeOrganize;
		}

		const pending = countLooseWechatNotes(this.app, this.settings);
		if (pending === 0) {
			if (showNotice) new Notice('没有需要整理的散放笔记');
			return;
		}

		this.activeOrganize = (async () => {
			this.updateStatusBar('syncing', '整理笔记…');
			try {
				const result = await organizeLooseWechatArticles(
					this.app,
					this.settings,
					(msg) => this.updateStatusBar('syncing', msg),
				);
				this.updateStatusBar('success');
				if (showNotice) {
					new Notice(
						`整理完成：扫描 ${result.scanned}，移动 ${result.moved}，跳过 ${result.skipped}` +
							(result.errors > 0 ? `，失败 ${result.errors}` : ''),
					);
				}
			} catch (error) {
				this.updateStatusBar('error');
				if (showNotice) {
					new Notice(`整理失败：${error instanceof Error ? error.message : String(error)}`);
				}
			} finally {
				this.activeOrganize = null;
			}
		})();

		return this.activeOrganize;
	}

	private async updateArticle(path: string, article: SyncArticle, io?: VaultIO) {
		const target = io ?? this.getTargetIO();
		if (!target.exists(path)) return;
		const baseName = path.split('/').pop()?.replace(/\.md$/i, '') || '未命名文章';
		let content = formatArticleMarkdown(article);
		if (this.settings.localizeImages) {
			content = await this.localizeAttachments(
				content,
				article.title || baseName,
				target,
				article,
			);
		}
		await target.writeText(path, content);
	}

	/**
	 * 图片与视频下载到库根对应来源媒体目录：
	 * {媒体根}/{文章标题}/{文章标题}-01.jpg
	 * {媒体根}/{文章标题}/{文章标题}-02.mp4
	 * 嵌入统一用 ![[库根路径]]，避免相对路径空格被 Markdown 截断。
	 */
	private async localizeAttachments(
		markdownContent: string,
		articleTitle: string,
		io?: VaultIO,
		article?: SyncArticle,
	): Promise<string> {
		const target = io ?? this.getTargetIO();
		const titleBase = mediaTitleBase(articleTitle);
		const mediaRoot = article ? this.resolveMediaFolder(article) : WECHAT_MEDIA_FOLDER;
		const mediaReferer = article ? this.resolveMediaReferer(article) : undefined;
		const attachmentFolder = normalizePath(`${mediaRoot}/${titleBase}`);
		await target.ensureFolder(attachmentFolder);

		type MediaHit =
			| {
					kind: 'image';
					index: number;
					fullMatch: string;
					altText: string;
					url: string;
			  }
			| {
					kind: 'video';
					index: number;
					fullMatch: string;
					url: string;
					before: string;
					after: string;
			  };

		const hits: MediaHit[] = [];
		const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
		for (const match of markdownContent.matchAll(imageRegex)) {
			if (!match[2] || match.index === undefined) continue;
			hits.push({
				kind: 'image',
				index: match.index,
				fullMatch: match[0],
				altText: match[1] || '',
				url: match[2],
			});
		}
		const videoRegex =
			/<video\b([^>]*)\bsrc=["'](https?:\/\/[^"']+)["']([^>]*)>\s*<\/video>/gi;
		for (const match of markdownContent.matchAll(videoRegex)) {
			if (!match[2] || match.index === undefined) continue;
			hits.push({
				kind: 'video',
				index: match.index,
				fullMatch: match[0],
				url: match[2],
				before: match[1] || '',
				after: match[3] || '',
			});
		}
		hits.sort((a, b) => a.index - b.index);
		if (hits.length === 0) return markdownContent;

		let result = markdownContent;
		let seq = 0;
		for (const hit of hits) {
			seq += 1;
			const seqLabel = String(seq).padStart(2, '0');

			if (hit.kind === 'image') {
				try {
					const buffer = await downloadRemoteMedia(forceHttpsUrl(hit.url), {
						referer: mediaReferer,
					});
					if (!buffer || buffer.byteLength <= 0) {
						seq -= 1;
						continue;
					}
					const ext = guessImageExt(hit.url);
					const fileName = `${titleBase}-${seqLabel}${ext}`;
					const vaultPath = `${attachmentFolder}/${fileName}`;
					await target.writeBinary(vaultPath, buffer);
					// 用库根维基链接，避免相对路径空格被 Markdown 截断
					result = result.replace(hit.fullMatch, `\n![[${vaultPath}]]\n`);
				} catch (err) {
					console.warn(`SyncBridge image download failed: ${hit.url}`, err);
					seq -= 1;
				}
				continue;
			}

			const altAttr = `${hit.before}${hit.after}`.match(/data-vb-alts=["']([^"']+)["']/i);
			const candidates = dedupeUrls(
				[
					hit.url,
					...(altAttr?.[1] ? altAttr[1].split(/\s+/).filter(Boolean) : []),
					...siblingQualityUrls(hit.url),
				].map(forceHttpsUrl),
			);

			let buffer: ArrayBuffer | null = null;
			for (const candidate of candidates) {
				if (!candidate) continue;
				try {
					const downloaded = await downloadRemoteMedia(candidate, {
						referer: mediaReferer,
					});
					if (downloaded && downloaded.byteLength > 1024) {
						buffer = downloaded;
						break;
					}
				} catch (err) {
					console.warn(`SyncBridge video download failed: ${candidate}`, err);
				}
			}

			if (!buffer) {
				result = result.replace(
					hit.fullMatch,
					`\n[视频原文（本地下载失败）](${forceHttpsUrl(hit.url)})\n`,
				);
				seq -= 1;
				continue;
			}

			try {
				const fileName = `${titleBase}-${seqLabel}.mp4`;
				const vaultPath = `${attachmentFolder}/${fileName}`;
				await target.writeBinary(vaultPath, buffer);
				result = result.replace(hit.fullMatch, `\n![[${vaultPath}]]\n`);
			} catch (err) {
				console.warn(`SyncBridge video write failed: ${hit.url}`, err);
				result = result.replace(
					hit.fullMatch,
					`\n[视频原文（本地写入失败）](${forceHttpsUrl(hit.url)})\n`,
				);
				seq -= 1;
			}
		}
		return result;
	}

	private updateStatusBar(status: 'idle' | 'syncing' | 'success' | 'error', detail?: string) {
		if (!this.statusBarEl) return;
		const prefix = 'SyncBridge';
		if (status === 'syncing') {
			this.statusBarEl.setText(detail ? `${prefix} · ${detail}` : `${prefix} · 处理中…`);
		} else if (status === 'success') {
			this.lastSyncTime = new Date();
			const t = this.lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			this.statusBarEl.setText(`${prefix} · ${t}`);
		} else if (status === 'error') {
			this.statusBarEl.setText(`${prefix} · 失败`);
		} else if (this.lastSyncTime) {
			const t = this.lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			this.statusBarEl.setText(`${prefix} · ${t}`);
		} else {
			this.statusBarEl.setText(`${prefix} · 待命`);
		}
	}
}

/** 尝试同视频其他清晰度（.f10002 / .f10104 等） */
function siblingQualityUrls(url: string): string[] {
	const httpsUrl = forceHttpsUrl(url);
	const formats = ['10104', '10004', '10102', '10002'];
	const current = httpsUrl.match(/\.f(\d+)\.mp4/i)?.[1];
	const out: string[] = [];
	for (const f of formats) {
		if (f === current) continue;
		out.push(httpsUrl.replace(/\.f\d+\.mp4/i, `.f${f}.mp4`));
	}
	return out;
}

function dedupeUrls(urls: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const url of urls) {
		if (!url || seen.has(url)) continue;
		seen.add(url);
		result.push(url);
	}
	return result;
}

/** 附件目录/文件名前缀：文章标题（去掉日期前缀，截断过长） */
function mediaTitleBase(title: string): string {
	let cleaned = (title || '未命名文章').trim();
	cleaned = cleaned.replace(
		/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\s*[-—–_]?\s*/,
		'',
	);
	cleaned = sanitizeFileName(cleaned || '未命名文章').replace(/\.+$/, '');
	return (cleaned || '未命名文章').slice(0, 60);
}

function guessImageExt(url: string): string {
	const lower = url.toLowerCase();
	if (lower.includes('.png') || lower.includes('wx_fmt=png')) return '.png';
	if (lower.includes('.gif') || lower.includes('wx_fmt=gif')) return '.gif';
	if (lower.includes('.webp') || lower.includes('wx_fmt=webp')) return '.webp';
	return '.jpg';
}
