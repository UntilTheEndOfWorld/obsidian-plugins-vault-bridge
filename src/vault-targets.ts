import { App, FileSystemAdapter, Platform, TFile, TFolder, normalizePath } from 'obsidian';
import type { VaultKeywordIndex } from './folders';
import { extractKeywords, MEDIA_SKIP_FOLDERS, MULTI_TOPIC_FOLDER } from './folders';
import { getFileTitle } from './folder-utils';

export interface VaultOption {
	id: string;
	path: string;
	name: string;
	isCurrent: boolean;
}

export interface VaultIO {
	/** 空表示走当前库 API */
	vaultId: string;
	label: string;
	isExternal: boolean;
	ensureFolder(vaultRelativePath: string): Promise<void>;
	exists(vaultRelativePath: string): boolean;
	writeText(vaultRelativePath: string, content: string): Promise<void>;
	writeBinary(vaultRelativePath: string, data: ArrayBuffer): Promise<void>;
	nextAvailablePath(folder: string, baseName: string): Promise<string>;
	findPathByFrontmatter(key: string, value: string): string | undefined;
	/** frontmatter 字段 → 库内相对路径 */
	indexFrontmatter(key: string): Map<string, string>;
	buildKeywordIndex(syncFolder: string): VaultKeywordIndex;
}

/** 当前库绝对路径（仅桌面本地库） */
export function getCurrentVaultPath(app: App): string | null {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return adapter.getBasePath();
	}
	return null;
}

/** 读取 Obsidian 已注册的全部仓库 */
export function listObsidianVaults(currentPath: string | null): VaultOption[] {
	if (!Platform.isDesktopApp) return [];

	try {
		const fs = nodeRequire('fs') as typeof import('fs');
		const path = nodeRequire('path') as typeof import('path');
		const configPath = resolveObsidianConfigPath(path);
		if (!configPath || !fs.existsSync(configPath)) return [];

		const raw = fs.readFileSync(configPath, 'utf8');
		const json = JSON.parse(raw) as {
			vaults?: Record<string, { path?: string }>;
		};
		const vaults = json.vaults || {};
		const currentNorm = currentPath ? normalizeFsPath(currentPath) : '';

		const options: VaultOption[] = [];
		for (const [id, info] of Object.entries(vaults)) {
			const vaultPath = info?.path?.trim();
			if (!vaultPath) continue;
			if (!fs.existsSync(vaultPath)) continue;
			const name = path.basename(vaultPath) || vaultPath;
			options.push({
				id,
				path: vaultPath,
				name,
				isCurrent: Boolean(currentNorm && normalizeFsPath(vaultPath) === currentNorm),
			});
		}
		options.sort((a, b) => {
			if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
			return a.name.localeCompare(b.name, 'zh');
		});
		return options;
	} catch (err) {
		console.warn('VaultBridge list vaults failed', err);
		return [];
	}
}

function resolveObsidianConfigPath(path: typeof import('path')): string | null {
	const env = getNodeEnv();
	const home = env.HOME || env.USERPROFILE || '';
	const platform = env.platform || '';
	if (platform === 'win32') {
		const appData = env.APPDATA;
		if (appData) return path.join(appData, 'obsidian', 'obsidian.json');
	} else if (platform === 'darwin') {
		if (home) return path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
	} else if (home) {
		return path.join(home, '.config', 'obsidian', 'obsidian.json');
	}
	return null;
}

function getNodeEnv(): {
	HOME?: string;
	USERPROFILE?: string;
	APPDATA?: string;
	platform?: string;
} {
	try {
		const proc = nodeRequire('process') as {
			env?: Record<string, string | undefined>;
			platform?: string;
		};
		return {
			HOME: proc.env?.HOME,
			USERPROFILE: proc.env?.USERPROFILE,
			APPDATA: proc.env?.APPDATA,
			platform: proc.platform,
		};
	} catch {
		return {};
	}
}

function normalizeFsPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function nodeRequire(id: string): unknown {
	const req = (window as unknown as { require?: (x: string) => unknown }).require;
	if (!req) throw new Error('Node require unavailable');
	return req(id);
}

/** 创建写入目标：未选或选当前库 → 当前库；否则写到其它本地仓库 */
export function createVaultIO(app: App, targetVaultId: string): VaultIO {
	const id = (targetVaultId || '').trim();
	if (!id || !Platform.isDesktopApp) {
		return new CurrentVaultIO(app);
	}

	const currentPath = getCurrentVaultPath(app);
	const vaults = listObsidianVaults(currentPath);
	const selected = vaults.find((v) => v.id === id);
	if (!selected || selected.isCurrent || !selected.path) {
		return new CurrentVaultIO(app);
	}
	return new ExternalVaultIO(selected.id, selected.name, selected.path);
}

class CurrentVaultIO implements VaultIO {
	vaultId = '';
	label: string;
	isExternal = false;

	constructor(private readonly app: App) {
		this.label = `当前库（${app.vault.getName()}）`;
	}

	async ensureFolder(vaultRelativePath: string): Promise<void> {
		const parts = normalizePath(vaultRelativePath).split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
			} else if (!(existing instanceof TFolder)) {
				throw new Error(`${current} exists and is not a folder.`);
			}
		}
	}

	exists(vaultRelativePath: string): boolean {
		return Boolean(this.app.vault.getAbstractFileByPath(normalizePath(vaultRelativePath)));
	}

	async writeText(vaultRelativePath: string, content: string): Promise<void> {
		const path = normalizePath(vaultRelativePath);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else if (!existing) {
			await this.app.vault.create(path, content);
		}
	}

	async writeBinary(vaultRelativePath: string, data: ArrayBuffer): Promise<void> {
		const path = normalizePath(vaultRelativePath);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.app.vault.modifyBinary(existing, data);
		} else if (!existing) {
			await this.app.vault.createBinary(path, data);
		}
	}

	async nextAvailablePath(folder: string, baseName: string): Promise<string> {
		let candidate = normalizePath(`${folder}/${baseName}.md`);
		let index = 2;
		while (this.exists(candidate)) {
			candidate = normalizePath(`${folder}/${baseName} ${index}.md`);
			index += 1;
		}
		return candidate;
	}

	findPathByFrontmatter(key: string, value: string): string | undefined {
		const normalized = value.trim().replace(/\/+$/, '');
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const raw: unknown = fm?.[key];
			const found = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
			if (found && found === normalized) return file.path;
			if (raw != null && String(raw).trim() === normalized) return file.path;
		}
		return undefined;
	}

	indexFrontmatter(key: string): Map<string, string> {
		const map = new Map<string, string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const raw: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
			if (raw == null || raw === '') continue;
			map.set(String(raw).trim(), file.path);
		}
		return map;
	}

	buildKeywordIndex(syncFolder: string): VaultKeywordIndex {
		return buildCurrentVaultKeywordIndex(this.app, syncFolder);
	}
}

class ExternalVaultIO implements VaultIO {
	isExternal = true;

	constructor(
		public vaultId: string,
		public label: string,
		private readonly basePath: string,
	) {}

	private abs(vaultRelativePath: string): string {
		const path = nodeRequire('path') as typeof import('path');
		const rel = normalizePath(vaultRelativePath).replace(/^\/+/, '');
		return path.join(this.basePath, ...rel.split('/'));
	}

	async ensureFolder(vaultRelativePath: string): Promise<void> {
		const fs = nodeRequire('fs') as typeof import('fs');
		const path = nodeRequire('path') as typeof import('path');
		const parts = normalizePath(vaultRelativePath).split('/').filter(Boolean);
		let current = this.basePath;
		for (const part of parts) {
			current = path.join(current, part);
			if (!fs.existsSync(current)) {
				fs.mkdirSync(current);
			}
		}
	}

	exists(vaultRelativePath: string): boolean {
		const fs = nodeRequire('fs') as typeof import('fs');
		return fs.existsSync(this.abs(vaultRelativePath));
	}

	async writeText(vaultRelativePath: string, content: string): Promise<void> {
		const fs = nodeRequire('fs') as typeof import('fs');
		const path = nodeRequire('path') as typeof import('path');
		const full = this.abs(vaultRelativePath);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, 'utf8');
	}

	async writeBinary(vaultRelativePath: string, data: ArrayBuffer): Promise<void> {
		const fs = nodeRequire('fs') as typeof import('fs');
		const path = nodeRequire('path') as typeof import('path');
		const full = this.abs(vaultRelativePath);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, new Uint8Array(data));
	}

	async nextAvailablePath(folder: string, baseName: string): Promise<string> {
		let candidate = normalizePath(`${folder}/${baseName}.md`);
		let index = 2;
		while (this.exists(candidate)) {
			candidate = normalizePath(`${folder}/${baseName} ${index}.md`);
			index += 1;
		}
		return candidate;
	}

	findPathByFrontmatter(key: string, value: string): string | undefined {
		const map = this.indexFrontmatter(key);
		const normalized = value.trim().replace(/\/+$/, '');
		for (const [k, path] of map) {
			if (k.replace(/\/+$/, '') === normalized) return path;
		}
		return undefined;
	}

	indexFrontmatter(key: string): Map<string, string> {
		const fs = nodeRequire('fs') as typeof import('fs');
		const path = nodeRequire('path') as typeof import('path');
		const map = new Map<string, string>();
		const root = this.basePath;
		if (!fs.existsSync(root)) return map;

		const stack = [root];
		while (stack.length) {
			const dir = stack.pop()!;
			let entries: string[] = [];
			try {
				entries = fs.readdirSync(dir);
			} catch {
				continue;
			}
			for (const name of entries) {
				if (name.startsWith('.')) continue;
				const full = path.join(dir, name);
				let stat;
				try {
					stat = fs.statSync(full);
				} catch {
					continue;
				}
				if (stat.isDirectory()) {
					stack.push(full);
					continue;
				}
				if (!name.toLowerCase().endsWith('.md')) continue;
				try {
					const text = fs.readFileSync(full, 'utf8');
					const m = text.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, 'm'));
					if (!m?.[1]) continue;
					let found = m[1].trim();
					if (
						(found.startsWith('"') && found.endsWith('"')) ||
						(found.startsWith("'") && found.endsWith("'"))
					) {
						found = found.slice(1, -1);
					}
					found = found.trim();
					if (!found) continue;
					const rel = normalizePath(path.relative(this.basePath, full).replace(/\\/g, '/'));
					map.set(found, rel);
				} catch {
					/* ignore */
				}
			}
		}
		return map;
	}

	buildKeywordIndex(syncFolder: string): VaultKeywordIndex {
		const fs = nodeRequire('fs') as typeof import('fs');
		const path = nodeRequire('path') as typeof import('path');
		const byKeyword = new Map<string, number>();
		const folderNames = new Set<string>();
		const root = this.abs(syncFolder || '');
		if (!fs.existsSync(root)) return { byKeyword, folderNames };

		const walk = (dir: string) => {
			let entries: string[] = [];
			try {
				entries = fs.readdirSync(dir);
			} catch {
				return;
			}
			for (const name of entries) {
				if (name === 'attachments' || name === '微信公众号媒体' || name === '腾讯云媒体' || name === '阿里云媒体' || name === '小红书媒体' || name.startsWith('.')) continue;
				const full = path.join(dir, name);
				let stat;
				try {
					stat = fs.statSync(full);
				} catch {
					continue;
				}
				if (stat.isDirectory()) {
					if (name !== MULTI_TOPIC_FOLDER) {
						folderNames.add(name);
						if (name.trim().length >= 2) {
							byKeyword.set(name, (byKeyword.get(name) || 0) + 1);
						}
					}
					walk(full);
				} else if (name.toLowerCase().endsWith('.md')) {
					try {
						const text = fs.readFileSync(full, 'utf8');
						const titleMatch = text.match(/^title:\s*(.*)$/m);
						let title = name.replace(/\.md$/i, '');
						if (titleMatch?.[1]) {
							let t = titleMatch[1].trim();
							if (
								(t.startsWith('"') && t.endsWith('"')) ||
								(t.startsWith("'") && t.endsWith("'"))
							) {
								t = t.slice(1, -1);
							}
							if (t) title = t;
						} else {
							const dash = title.indexOf(' - ');
							if (dash > 0) title = title.slice(dash + 3);
						}
						for (const kw of extractKeywords(title)) {
							byKeyword.set(kw, (byKeyword.get(kw) || 0) + 1);
						}
					} catch {
						/* ignore */
					}
				}
			}
		};
		walk(root);
		return { byKeyword, folderNames };
	}
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCurrentVaultKeywordIndex(app: App, syncFolder: string): VaultKeywordIndex {
	const byKeyword = new Map<string, number>();
	const folderNames = new Set<string>();
	const rootPath = normalizePath(syncFolder || '');
	const root = app.vault.getAbstractFileByPath(rootPath);
	if (!(root instanceof TFolder)) return { byKeyword, folderNames };

	const scan = (folder: TFolder) => {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				if (!MEDIA_SKIP_FOLDERS.has(child.name)) {
					folderNames.add(child.name);
					const fk = child.name.trim();
					if (fk.length >= 2) byKeyword.set(fk, (byKeyword.get(fk) || 0) + 1);
					scan(child);
				}
			} else if (child instanceof TFile && child.extension === 'md') {
				const title = getFileTitle(app, child);
				for (const kw of extractKeywords(title)) {
					byKeyword.set(kw, (byKeyword.get(kw) || 0) + 1);
				}
			}
		}
	};
	scan(root);
	return { byKeyword, folderNames };
}
