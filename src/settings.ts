import { App, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';

import type ObsyncBridgePlugin from './main';

import { isBindClaimed } from './api';

import { TopicProfileModal } from './topic-profile-modal';

import {

	createTopicProfileId,

	DEFAULT_TOPIC_PROFILES,

	nextCustomTopicName,

	type TopicGroupProfile,

} from './topic-profiles';

import { getCurrentVaultPath, listObsidianVaults } from './vault-targets';



export interface ObsyncBridgeSettings {
	apiBaseUrl: string;
	/** 短配对码（仅展示/换绑；业务鉴权用 accessToken） */
	bindCode: string;
	userId: string;
	/** 长访问令牌（认领后入库，重新绑定才更新） */
	accessToken: string;
	deviceId: string;
	deviceName: string;
	syncFolder: string;
	/**
	 * 目标仓库 ID（Obsidian obsidian.json 中的 vault id）。
	 * 空字符串 = 当前库；有值则同步写入对应本地仓库。
	 */
	targetVaultId: string;
	localizeImages: boolean;
	subfolderByAccount: boolean;
	subfolderByAutoKeywords: boolean;
	topicProfiles: TopicGroupProfile[];
	/** 内置「开发编程主题」词库合并版本 */
	builtinTopicRulesVersion?: number;
	/** 是否已激活邀请码（仅本地展示） */
	unlimited?: boolean;
	/** 小程序是否已认领绑定码 */
	claimed?: boolean;
}

export const DEFAULT_SETTINGS: ObsyncBridgeSettings = {
	apiBaseUrl: 'https://lycc.ltd/jx_slr_api',
	bindCode: '',
	userId: '',
	accessToken: '',
	deviceId: '',
	deviceName: 'Obsidian',
	syncFolder: '微信文章收藏',
	targetVaultId: '',
	localizeImages: true,
	subfolderByAccount: false,
	subfolderByAutoKeywords: false,
	topicProfiles: DEFAULT_TOPIC_PROFILES.map((p) => ({ ...p })),
	builtinTopicRulesVersion: 0,
	unlimited: false,
	claimed: false,
};



export class ObsyncBridgeSettingTab extends PluginSettingTab {

	plugin: ObsyncBridgePlugin;

	bindCode = '';

	bindStatus = '';

	private unbinding = false;



	constructor(app: App, plugin: ObsyncBridgePlugin) {

		super(app, plugin);

		this.plugin = plugin;

	}



	display(): void {

		const { containerEl } = this;

		containerEl.empty();

		containerEl.addClass('vb-settings-root');



		this.renderHero(containerEl);

		this.renderConnectionCard(containerEl);

		this.renderArchiveCard(containerEl);

		this.renderActionsCard(containerEl);

	}



	private renderHero(root: HTMLElement) {

		const hero = root.createDiv({ cls: 'vb-hero' });

		hero.createDiv({
			cls: 'vb-hero-badge',
			text: this.plugin.isPaired() ? '已配对' : '待配对',
		});

		hero.createEl('h1', { cls: 'vb-hero-title', text: 'ObsyncBridge' });

		hero.createEl('p', {
			cls: 'vb-hero-desc',
			text: '将微信/腾讯云/阿里云/小红书等链接桥接到本笔记库（小程序拉取）。',
		});

		if (this.plugin.isPaired()) {
			const meta = hero.createDiv({ cls: 'vb-hero-meta' });
			meta.createSpan({ text: `设备 · ${this.plugin.settings.deviceName}` });
			meta.createSpan({ text: `库 · ${this.app.vault.getName()}` });
			meta.createSpan({ text: `码 · ${this.plugin.settings.bindCode}` });
			if (this.plugin.settings.unlimited) {
				meta.createSpan({ text: '会员 · 无限额度' });
			}
		}

	}



	private renderConnectionCard(root: HTMLElement) {

		const card = root.createDiv({ cls: 'vb-card' });

		card.createEl('h2', { cls: 'vb-card-title', text: '连接与配对' });



		new Setting(card)

			.setName('服务地址')

			.setDesc('自建后端 API 根路径')

			.addText((t) =>

				t

					.setPlaceholder('https://lycc.ltd/jx_slr_api')

					.setValue(this.plugin.settings.apiBaseUrl)

					.onChange(async (v) => {

						this.plugin.settings.apiBaseUrl = (v || '').trim().replace(/\/+$/, '');

						await this.plugin.saveSettings();

					}),

			);



		new Setting(card)

			.setName('本机别名')

			.setDesc('配对时展示给手机端')

			.addText((t) =>

				t.setValue(this.plugin.settings.deviceName).onChange(async (v) => {

					this.plugin.settings.deviceName = v.trim() || 'Obsidian';

					await this.plugin.saveSettings();

				}),

			);



		const bindBox = card.createDiv({ cls: 'vb-bind-box' });
		bindBox.createEl('p', {
			cls: 'vb-bind-hint',
			text: this.plugin.isPaired()
				? '已配对。重新生成配对码会使旧 Token 作废，需在小程序重新认领并换发新 Token。'
				: '生成 6 位配对码，在手机小程序中输入完成绑定。',
		});

		if (this.plugin.isPaired()) {
			bindBox.createDiv({
				cls: 'vb-bind-status',
				text: `配对码 ${this.plugin.settings.bindCode} · 已持有 Access Token`,
			});
		}

		new Setting(bindBox)
			.setName('配对码')
			.addButton((btn) =>
				btn
					.setButtonText(this.plugin.isPaired() ? '重新生成配对码' : '生成配对码')
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText('生成中…');
						try {
							const bind = await this.plugin.startBinding();
							this.bindCode = bind.bindCode || bind.code;
							this.bindStatus = '等待小程序认领…';
							new Notice(`配对码：${this.bindCode}`);
							this.plugin.pollBinding(this.bindCode, (s) => {
								this.bindStatus = s?.status || '';
								if (
									isBindClaimed(s?.status) ||
									s?.status === 'invalid' ||
									s?.status === 'unbound' ||
									s?.status === 'expired'
								) {
									if (this.plugin.isPaired()) {
										this.bindCode = '';
										this.bindStatus = '';
									}
									this.display();
								}
							});
							this.display();
						} catch (e) {
							const msg = e instanceof Error ? e.message : String(e);
							console.error('[ObsyncBridge] 生成配对码失败', e);
							new Notice(`生成失败：${msg}`);
							this.bindStatus = msg;
							this.display();
						} finally {
							btn.setDisabled(false);
							btn.setButtonText(this.plugin.isPaired() ? '重新生成配对码' : '生成配对码');
						}
					}),
			);

		if (this.bindCode) {
			const codeEl = bindBox.createDiv({ cls: 'vb-bind-code', text: this.bindCode });
			codeEl.setAttr('aria-label', '配对码');
			bindBox.createDiv({ cls: 'vb-bind-status', text: this.bindStatus });
		}

		let inviteDraft = '';
		new Setting(card)
			.setName('激活码')
			.setDesc('格式 OBSYNCVIP-加8位。激活后在有效期内无限保存/同步，到期恢复每日 66 篇')
			.addText((t) =>
				t.setPlaceholder('OBSYNCVIP-XXXXXXXX').onChange((v) => {
					inviteDraft = (v || '').trim();
				}),
			)
			.addButton((btn) =>
				btn.setButtonText('激活').onClick(async () => {
					if (!this.plugin.isPaired()) {
						new Notice('请先完成配对');
						return;
					}
					if (!inviteDraft) {
						new Notice('请输入邀请码');
						return;
					}
					try {
						await this.plugin.activateInvite(inviteDraft);
						new Notice('会员已激活');
						this.display();
					} catch (e) {
						console.error('[ObsyncBridge] 激活邀请码失败', e);
						new Notice(`激活失败：${e instanceof Error ? e.message : String(e)}`);
					}
				}),
			);

	}



	private renderArchiveCard(root: HTMLElement) {

		const card = root.createDiv({ cls: 'vb-card' });

		card.createEl('h2', { cls: 'vb-card-title', text: '归档规则' });



		this.renderTargetVaultSetting(card);



		new Setting(card)

			.setName('根目录')

			.setDesc('所有导入文章写入此文件夹')

			.addText((t) =>

				t.setValue(this.plugin.settings.syncFolder).onChange(async (v) => {

					this.plugin.settings.syncFolder = v.trim() || DEFAULT_SETTINGS.syncFolder;

					await this.plugin.saveSettings();

				}),

			);



		new Setting(card)

			.setName('按公众号分目录')

			.setDesc('在根目录下按公众号名称创建子文件夹')

			.addToggle((tg) =>

				tg.setValue(this.plugin.settings.subfolderByAccount).onChange(async (v) => {

					this.plugin.settings.subfolderByAccount = v;

					await this.plugin.saveSettings();

				}),

			);



		new Setting(card)

			.setName('智能关键词归类')

			.setDesc('同步与整理时，按下方已开启的主题分组匹配目录；无法确定或命中多个互不相关主题时放入「未分类」')

			.addToggle((tg) =>

				tg.setValue(this.plugin.settings.subfolderByAutoKeywords).onChange(async (v) => {

					this.plugin.settings.subfolderByAutoKeywords = v;

					await this.plugin.saveSettings();

					this.display();

				}),

			);



		if (this.plugin.settings.subfolderByAutoKeywords) {

			this.renderTopicProfiles(card);

		}



		new Setting(card)

			.setName('本地化图片与视频')

			.setDesc('下载正文图片、视频到对应来源媒体目录（微信/腾讯云/阿里云/小红书；视频以 ![[video.mp4]] 嵌入）')

			.addToggle((tg) =>

				tg.setValue(this.plugin.settings.localizeImages).onChange(async (v) => {

					this.plugin.settings.localizeImages = v;

					await this.plugin.saveSettings();

				}),

			);

	}



	private renderTargetVaultSetting(card: HTMLElement) {

		const currentPath = getCurrentVaultPath(this.app);

		const vaults = listObsidianVaults(currentPath);

		const savedId = this.plugin.settings.targetVaultId || '';

		const savedStillExists = !savedId || vaults.some((v) => v.id === savedId);



		new Setting(card)

			.setName('目标仓库')

			.setDesc(

				Platform.isDesktopApp

					? '单选：不选则写入当前库；选择其它仓库后，拉取会同步到该本地库'

					: '跨库写入仅桌面端可用，移动端始终写入当前库',

			)

			.addDropdown((dd) => {

				dd.addOption('', '当前库（默认）');

				for (const vault of vaults) {

					const label = vault.isCurrent ? `${vault.name}（当前）` : vault.name;

					dd.addOption(vault.id, label);

				}

				dd.setValue(savedStillExists ? savedId : '');

				dd.onChange(async (v) => {

					this.plugin.settings.targetVaultId = v;

					await this.plugin.saveSettings();

				});

				if (!Platform.isDesktopApp) {

					dd.setDisabled(true);

				}

			});



		if (savedId && !savedStillExists) {

			card.createEl('p', {

				cls: 'vb-setting-hint',

				text: '已保存的目标仓库不存在，已回退为当前库。请重新选择。',

			});

			this.plugin.settings.targetVaultId = '';

			void this.plugin.saveSettings();

		}

	}



	private renderTopicProfiles(card: HTMLElement) {

		const section = card.createDiv({ cls: 'vb-topic-section' });

		section.createEl('h3', { cls: 'vb-topic-section-title', text: '自定义主题分组' });

		section.createEl('p', {

			cls: 'vb-topic-section-desc',

			text: '每个主题可单独开启。开启后，拉取同步与「整理微信文章笔记」都会按该主题的匹配规则归档。',

		});



		const list = section.createDiv({ cls: 'vb-topic-list' });

		for (const profile of this.plugin.settings.topicProfiles) {

			this.renderTopicProfileRow(list, profile);

		}



		const addRow = section.createDiv({ cls: 'vb-topic-add-row' });

		addRow.createEl('button', { text: '+ 添加自定义主题', cls: 'mod-cta vb-topic-add-btn' }).addEventListener(

			'click',

			async () => {

				const profile: TopicGroupProfile = {

					id: createTopicProfileId(),

					name: nextCustomTopicName(this.plugin.settings.topicProfiles),

					enabled: false,

					rules: '',

				};

				this.plugin.settings.topicProfiles.push(profile);

				await this.plugin.saveSettings();

				this.display();

			},

		);

	}



	private renderTopicProfileRow(list: HTMLElement, profile: TopicGroupProfile) {

		const row = list.createDiv({ cls: 'vb-topic-row' });

		row.createSpan({ cls: 'vb-topic-row-name', text: profile.name });



		const actions = row.createDiv({ cls: 'vb-topic-row-actions' });

		actions

			.createEl('button', { text: '配置详情', cls: 'vb-topic-config-btn' })

			.addEventListener('click', () => {

				new TopicProfileModal(this.app, profile, async (updated) => {

					const idx = this.plugin.settings.topicProfiles.findIndex((p) => p.id === updated.id);

					if (idx >= 0) {

						this.plugin.settings.topicProfiles[idx] = updated;

						await this.plugin.saveSettings();

						this.display();

					}

				}).open();

			});



		if (!profile.builtin) {

			actions

				.createEl('button', { text: '删除', cls: 'vb-topic-delete-btn' })

				.addEventListener('click', async () => {

					this.plugin.settings.topicProfiles = this.plugin.settings.topicProfiles.filter(

						(p) => p.id !== profile.id,

					);

					await this.plugin.saveSettings();

					this.display();

				});

		}



		const toggleWrap = row.createDiv({ cls: 'vb-topic-row-toggle' });

		new Setting(toggleWrap).addToggle((tg) => {

			tg.setValue(profile.enabled).onChange(async (v) => {

				profile.enabled = v;

				await this.plugin.saveSettings();

			});

		});

	}



	private renderActionsCard(root: HTMLElement) {

		const card = root.createDiv({ cls: 'vb-card vb-card-actions' });

		card.createEl('h2', { cls: 'vb-card-title', text: '手动操作' });



		const grid = card.createDiv({ cls: 'vb-action-grid' });



		this.actionButton(grid, '拉取待处理链接', '从服务端读取手机端提交的链接，本机逐篇下载', () =>

			this.plugin.syncNow(true),

		);

		// 剪贴板导入暂时关闭，恢复时取消下面注释
		// this.actionButton(grid, '剪贴板导入', '读取剪贴板中的微信/腾讯云/阿里云/小红书链接并写入', () =>
		// 	this.plugin.importFromClipboard(true),
		// );

		this.actionButton(

			grid,

			'整理微信文章笔记',

			'整理根目录散放笔记，并把「未分类」内文章尽量归到主主题目录',

			() => this.plugin.organizeNotes(true),

		);

		this.actionButton(
			grid,
			'解除本地配对',
			this.plugin.isPaired()
				? '请求服务端解绑并清除本库 Token，之后需重新生成配对码'
				: '需先完成配对后才可解除',
			async () => {
				if (!this.plugin.isPaired() || this.unbinding) {
					return;
				}
				this.unbinding = true;
				this.display();
				try {
					await this.plugin.unbindBinding();
					this.bindCode = '';
					this.bindStatus = '';
					new Notice('已解除配对，请重新生成配对码');
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					console.error('[ObsyncBridge] 解除配对失败', e);
					new Notice(`解除失败：${msg}`);
				} finally {
					this.unbinding = false;
					this.display();
				}
			},
			true,
			!this.plugin.isPaired() || this.unbinding,
		);

	}



	private actionButton(
		parent: HTMLElement,
		title: string,
		desc: string,
		onClick: () => void | Promise<void>,
		danger = false,
		disabled = false,
	) {
		const btn = parent.createDiv({
			cls: `vb-action-item${danger ? ' vb-action-danger' : ''}${disabled ? ' is-disabled' : ''}`,
		});
		btn.createEl('span', { cls: 'vb-action-title', text: title });
		btn.createEl('span', { cls: 'vb-action-desc', text: desc });
		if (disabled) {
			btn.setAttr('aria-disabled', 'true');
			return;
		}
		btn.addEventListener('click', () => void onClick());
	}

}

