import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import type { SyncBridgeSettings } from './settings';
import {
	buildVaultKeywordIndex,
	buildTopicGroupsFromProfiles,
	UNCATEGORIZED_FOLDER,
	WECHAT_MEDIA_FOLDER,
	resolveArchivePaths,
	resolveParentArchiveFolder,
} from './folders';
import { pickPrimaryTopicFolder } from './topic-groups';
import { ensureFolderPath, getFileTitle, uniquePathInFolder, sleepTick } from './folder-utils';

export interface OrganizeResult {
	scanned: number;
	moved: number;
	skipped: number;
	errors: number;
}

/** 统计待整理数量（散放 +「未分类」+ 可重归类子目录） */
export function countLooseWechatNotes(app: App, settings: SyncBridgeSettings): number {
	return listOrganizableMarkdownFiles(app, settings).length;
}

/**
 * 手动整理：
 * - 根目录散放笔记
 * - 「未分类」内笔记（优先拆到主主题目录）
 * - 其他关键词子目录中可按新规则重归类的笔记
 */
export async function organizeLooseWechatArticles(
	app: App,
	settings: SyncBridgeSettings,
	onProgress?: (message: string) => void,
): Promise<OrganizeResult> {
	const result: OrganizeResult = { scanned: 0, moved: 0, skipped: 0, errors: 0 };
	if (!settings.subfolderByAutoKeywords) return result;

	const base = normalizePath(settings.syncFolder || '');
	const files = listOrganizableMarkdownFiles(app, settings);
	result.scanned = files.length;
	if (files.length === 0) return result;

	let index = buildVaultKeywordIndex(app, settings.syncFolder);
	const topicGroups = buildTopicGroupsFromProfiles(settings.topicProfiles);
	const uncategorizedName = normalizePath(UNCATEGORIZED_FOLDER);

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (!file) continue;
		onProgress?.(`整理中 ${i + 1} / ${files.length}`);

		try {
			const title = getFileTitle(app, file);
			const account = getAccountFromFile(app, file);
			const parentPath = file.parent?.path ?? '';
			const underUncategorized = isUnderFolderNamed(parentPath, uncategorizedName);

			let { parentPath: archiveParent, fullPath, keywordFolder } = resolveArchivePaths(base, {
				subfolderByAccount: settings.subfolderByAccount,
				accountName: account,
				subfolderByAutoKeywords: true,
				title,
				keywordIndex: index,
				topicGroups,
			});

			// 「未分类」内：若仍无法唯一归类，改选主主题，尽量拆出
			if (underUncategorized) {
				const stillUncategorized =
					!keywordFolder ||
					normalizePath(keywordFolder) === uncategorizedName ||
					keywordFolder.split('/')[0] === UNCATEGORIZED_FOLDER;
				if (stillUncategorized) {
					const primary = pickPrimaryTopicFolder(title, topicGroups);
					if (primary && normalizePath(primary) !== uncategorizedName) {
						keywordFolder = primary;
						fullPath = normalizePath(`${archiveParent}/${primary}`);
					}
				}
			}

			// 已在具体主题目录：不要因为模糊匹配再次塞回「未分类」
			if (
				keywordFolder &&
				normalizePath(keywordFolder) === uncategorizedName &&
				parentPath !== archiveParent &&
				!underUncategorized
			) {
				result.skipped++;
				continue;
			}

			if (!keywordFolder) {
				result.skipped++;
				continue;
			}

			if (parentPath === fullPath) {
				result.skipped++;
				continue;
			}

			await ensureFolderPath(app, fullPath);
			const dest = await uniquePathInFolder(app, fullPath, file.name);
			await app.vault.rename(file, dest);
			result.moved++;

			if (result.moved % 10 === 0) {
				index = buildVaultKeywordIndex(app, settings.syncFolder);
				await sleepTick();
			}
		} catch (err) {
			console.error('SyncBridge organize failed for', file.path, err);
			result.errors++;
		}

		if ((i + 1) % 5 === 0) await sleepTick();
	}

	return result;
}

function listOrganizableMarkdownFiles(app: App, settings: SyncBridgeSettings): TFile[] {
	const base = normalizePath(settings.syncFolder || '');
	const root = app.vault.getAbstractFileByPath(base);
	if (!(root instanceof TFolder)) return [];

	const out: TFile[] = [];
	collectOrganizable(app, root, base, settings, out);
	return out;
}

function collectOrganizable(
	app: App,
	folder: TFolder,
	syncBase: string,
	settings: SyncBridgeSettings,
	out: TFile[],
) {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			if (child.name === 'attachments' || child.name === WECHAT_MEDIA_FOLDER) continue;
			collectOrganizable(app, child, syncBase, settings, out);
		} else if (child instanceof TFile && child.extension === 'md') {
			if (isOrganizableArticle(app, child, syncBase, settings)) {
				out.push(child);
			}
		}
	}
}

function isUnderFolderNamed(parentPath: string, folderName: string): boolean {
	const parts = normalizePath(parentPath).split('/');
	return (
		parts.includes(folderName) ||
		parts.includes(UNCATEGORIZED_FOLDER) ||
		parts.includes('多标题')
	);
}

/**
 * 可整理：
 * - 散放在归档父目录
 * - 「未分类」（及旧「多标题」）及其下笔记
 * - 其他关键词子目录（误分重归类）
 */
function isOrganizableArticle(
	app: App,
	file: TFile,
	syncBase: string,
	settings: SyncBridgeSettings,
): boolean {
	const parentPath = file.parent?.path;
	if (!parentPath) return false;

	const account = getAccountFromFile(app, file);
	const expectedParent = normalizePath(
		resolveParentArchiveFolder(syncBase, {
			subfolderByAccount: settings.subfolderByAccount,
			accountName: account,
		}),
	);

	if (parentPath === expectedParent) return true;
	if (isUnderFolderNamed(parentPath, UNCATEGORIZED_FOLDER)) {
		return parentPath === expectedParent || parentPath.startsWith(`${expectedParent}/`);
	}
	return parentPath.startsWith(`${expectedParent}/`);
}

function getAccountFromFile(app: App, file: TFile): string | undefined {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter;
	if (typeof fm?.account === 'string' && fm.account.trim()) return fm.account.trim();
	if (typeof fm?.author === 'string' && fm.author.trim()) return fm.author.trim();
	return undefined;
}
