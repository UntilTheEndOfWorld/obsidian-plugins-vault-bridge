import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import { sanitizeFileName } from './markdown';
import { getFileTitle } from './folder-utils';
import {
	collectTopicGroupHits,
	matchTopicFolder,
	mergeTopicGroups,
	type TopicGroup,
} from './topic-groups';
import { type TopicGroupProfile } from './topic-profiles';

export { getFileTitle };

/** 命中多个主题或无法归类时使用的归档文件夹 */
export const UNCATEGORIZED_FOLDER = '未分类';

/** @deprecated 使用 UNCATEGORIZED_FOLDER */
export const MULTI_TOPIC_FOLDER = UNCATEGORIZED_FOLDER;

/** 公众号图片/视频统一存放目录（库根下） */
export const WECHAT_MEDIA_FOLDER = '微信公众号媒体';
export const TENCENT_MEDIA_FOLDER = '腾讯云媒体';
export const ALIYUN_MEDIA_FOLDER = '阿里云媒体';
export const XHS_MEDIA_FOLDER = '小红书媒体';

/** 扫描/归类时跳过的媒体目录名 */
export const MEDIA_SKIP_FOLDERS = new Set([
	'attachments',
	WECHAT_MEDIA_FOLDER,
	TENCENT_MEDIA_FOLDER,
	ALIYUN_MEDIA_FOLDER,
	XHS_MEDIA_FOLDER,
]);

/** 中文停用词（过短或过于泛化） */
const STOPWORDS = new Set([
	'文章', '如何', '什么', '怎么', '一个', '这种', '可以', '进行', '关于', '分享',
	'推荐', '收藏', '点击', '关注', '阅读', '原文', '来源', '标题', '笔记', '学习',
	'方法', '技巧', '详解', '解析', '深入', '理解', '全面', '最新', '完整', '实用',
	'入门', '指南', '教程', '原理', '实践', '总结', '盘点', '干货', '必看', '建议',
	'为什么', '这些', '那些', '我们', '你们', '他们', '自己', '已经', '还是', '以及',
	'用了', '用了这', '用了这些', '只用了', '只用了这', '这三招', '这五步', '这六招',
	'这招', '这步', '三招', '五步', '六招', '十招', '必会', '骚操作', '不会', '浪费',
	'自从', '连续', '几天', '没睡', '好觉', '到底', '怎样', '这么', '那么', '如果',
	'the', 'and', 'for', 'with', 'from', 'into', 'your', 'our',
]);

/** 不宜直接作为文件夹名的口语碎片 */
const JUNK_FOLDER_KEYWORDS = new Set([
	'用了这', '用了这些', '只用了这', '这三招', '这五步', '这六招', '这招', '这步',
	'三招', '五步', '六招', '十招', '必会', '骚操作', '不会', '浪费',
]);

export interface VaultKeywordIndex {
	/** 关键词 → 仓库内已有文章标题命中次数 */
	byKeyword: Map<string, number>;
	/** 已存在的归档子文件夹名 */
	folderNames: Set<string>;
}

/** 从标题提取候选关键词（英文技术词 + 中文词段） */
export function extractKeywords(title: string): string[] {
	if (!title?.trim()) return [];
	const found = new Set<string>();

	const english = title.match(/\b[A-Za-z][A-Za-z0-9+#.-]{1,24}\b/g);
	if (english) {
		for (const w of english) {
			const t = w.trim();
			if (t.length >= 2 && !STOPWORDS.has(t.toLowerCase())) found.add(t);
		}
	}

	const segments = title.split(/[\s\-—_|·,【】（）()[\]：:《》<>「」""''、，。！？!?/\\]+/);
	for (const seg of segments) {
		const s = seg.trim();
		if (s.length < 2) continue;

		const cjkParts = s.match(/[\u4e00-\u9fff]+/g);
		if (!cjkParts) continue;

		for (const part of cjkParts) {
			if (part.length >= 2 && part.length <= 10 && !STOPWORDS.has(part) && !JUNK_FOLDER_KEYWORDS.has(part)) {
				found.add(part);
			}
			// 仅对较长连续中文切分，且最短 3 字，避免「用了这」类碎片建目录
			if (part.length >= 5) {
				for (let len = Math.min(4, part.length); len >= 3; len--) {
					for (let i = 0; i <= part.length - len; i++) {
						const sub = part.slice(i, i + len);
						if (!STOPWORDS.has(sub) && !JUNK_FOLDER_KEYWORDS.has(sub)) found.add(sub);
					}
				}
			}
		}
	}

	return [...found].filter((k) => k.length >= 2 && !isJunkKeyword(k));
}

function isJunkKeyword(keyword: string): boolean {
	if (!keyword) return true;
	if (STOPWORDS.has(keyword) || JUNK_FOLDER_KEYWORDS.has(keyword)) return true;
	if (/^用了/.test(keyword) || /只用了/.test(keyword)) return true;
	if (/^这\d*[招步]$/.test(keyword)) return true;
	return false;
}

/** 扫描同步根目录下已有笔记标题与文件夹名，建立关键词索引 */
export function buildVaultKeywordIndex(app: App, syncFolder: string): VaultKeywordIndex {
	const byKeyword = new Map<string, number>();
	const folderNames = new Set<string>();
	const rootPath = normalizePath(syncFolder || '');
	const root = app.vault.getAbstractFileByPath(rootPath);
	if (!(root instanceof TFolder)) {
		return { byKeyword, folderNames };
	}
	scanFolder(app, root, byKeyword, folderNames);
	return { byKeyword, folderNames };
}

function scanFolder(
	app: App,
	folder: TFolder,
	byKeyword: Map<string, number>,
	folderNames: Set<string>,
) {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			if (MEDIA_SKIP_FOLDERS.has(child.name)) continue;
			folderNames.add(child.name);
			const fk = child.name.trim();
			if (fk.length >= 2) {
				byKeyword.set(fk, (byKeyword.get(fk) || 0) + 1);
			}
			scanFolder(app, child, byKeyword, folderNames);
		} else if (child instanceof TFile && child.extension === 'md') {
			const title = getFileTitle(app, child);
			for (const kw of extractKeywords(title)) {
				byKeyword.set(kw, (byKeyword.get(kw) || 0) + 1);
			}
		}
	}
}

/** 标题是否包含某文件夹名（英文尽量按词边界，中文按子串） */
export function titleMatchesFolder(title: string, folderName: string): boolean {
	if (!title?.trim() || !folderName?.trim()) return false;
	if (title.includes(folderName)) return true;
	if (/^[a-z0-9+#.-]+$/i.test(folderName)) {
		const escaped = folderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(title);
	}
	return false;
}

/** 收集标题命中的已有子文件夹名 */
function collectMatchedSubfolders(title: string, index: VaultKeywordIndex): string[] {
	const matched = new Set<string>();
	for (const fn of index.folderNames) {
		if (fn === UNCATEGORIZED_FOLDER || MEDIA_SKIP_FOLDERS.has(fn)) continue;
		if (isJunkKeyword(fn)) continue;
		if (titleMatchesFolder(title, fn)) matched.add(fn);
	}
	return [...matched];
}

/** 收集与仓库已有标题共享、且尚无对应文件夹的关键词（用于首次建类） */
function collectMatchedKeywords(title: string, index: VaultKeywordIndex): string[] {
	const matched = new Set<string>();
	const folderLower = new Set([...index.folderNames].map((f) => f.toLowerCase()));
	for (const kw of extractKeywords(title)) {
		if (isJunkKeyword(kw)) continue;
		if (kw.length < 3 && !/^[A-Za-z]/.test(kw)) continue;
		if ((index.byKeyword.get(kw) || 0) <= 0) continue;
		const sanitized = sanitizeFileName(kw);
		if (folderLower.has(sanitized.toLowerCase()) || folderLower.has(kw.toLowerCase())) continue;
		matched.add(sanitized);
	}
	return [...matched];
}

/**
 * 智能归类（优先级）：
 * 1. 主题同义词分组（支持层级：中间件/Kafka；父子命中取更具体路径）
 * 2. 已有子文件夹名匹配
 * 3. 仓库标题关键词共现
 * 多个互不相关主题或无法确定 →「未分类」
 */
export function findAutoKeywordFolder(
	newTitle: string,
	index: VaultKeywordIndex,
	topicGroups: TopicGroup[] = [],
): string | null {
	const topicFolder = matchTopicFolder(newTitle, topicGroups);
	if (topicFolder) return topicFolder;

	const topicHits = collectTopicGroupHits(newTitle, topicGroups);
	if (topicHits.length >= 2) return sanitizeFileName(UNCATEGORIZED_FOLDER);

	const folderHits = collectMatchedSubfolders(newTitle, index);
	if (folderHits.length >= 2) return sanitizeFileName(UNCATEGORIZED_FOLDER);
	if (folderHits.length === 1) return folderHits[0] ?? null;

	const keywordHits = collectMatchedKeywords(newTitle, index);
	if (keywordHits.length >= 2) return sanitizeFileName(UNCATEGORIZED_FOLDER);
	if (keywordHits.length === 1) return keywordHits[0] ?? null;

	return sanitizeFileName(UNCATEGORIZED_FOLDER);
}

export function buildTopicGroupsFromProfiles(profiles: TopicGroupProfile[]): TopicGroup[] {
	let merged = '';
	for (const profile of profiles) {
		if (!profile.enabled || !profile.rules?.trim()) continue;
		merged += `\n${profile.rules}`;
	}
	return mergeTopicGroups('', merged);
}

/** @deprecated 兼容旧调用 */
export function buildTopicGroups(_useBuiltin: boolean, customText: string): TopicGroup[] {
	return mergeTopicGroups('', customText || '');
}

/** 不含关键词层的父目录（根目录 + 可选公众号） */
export function resolveParentArchiveFolder(
	baseFolder: string,
	options: {
		subfolderByAccount: boolean;
		accountName?: string;
	},
): string {
	let folder = baseFolder;
	if (options.subfolderByAccount && options.accountName) {
		folder = `${folder}/${sanitizeFileName(options.accountName)}`;
	}
	return folder;
}

/** 解析归档路径：父目录 + 关键词子目录名 */
export function resolveArchivePaths(
	baseFolder: string,
	options: {
		subfolderByAccount: boolean;
		accountName?: string;
		subfolderByAutoKeywords: boolean;
		title: string;
		keywordIndex?: VaultKeywordIndex;
		topicGroups?: TopicGroup[];
	},
): { parentPath: string; fullPath: string; keywordFolder: string | null } {
	const parentPath = normalizePath(
		resolveParentArchiveFolder(baseFolder, {
			subfolderByAccount: options.subfolderByAccount,
			accountName: options.accountName,
		}),
	);
	const fullPath = normalizePath(resolveArchiveFolder(baseFolder, options));
	let keywordFolder: string | null = null;
	if (fullPath !== parentPath && fullPath.startsWith(`${parentPath}/`)) {
		keywordFolder = fullPath.slice(parentPath.length + 1);
	}
	return { parentPath, fullPath, keywordFolder };
}

/** 组合归档路径：根目录 → 公众号 → 自动关键词 */
export function resolveArchiveFolder(
	baseFolder: string,
	options: {
		subfolderByAccount: boolean;
		accountName?: string;
		subfolderByAutoKeywords: boolean;
		title: string;
		keywordIndex?: VaultKeywordIndex;
		topicGroups?: TopicGroup[];
	},
): string {
	let folder = baseFolder;
	if (options.subfolderByAccount && options.accountName) {
		folder = `${folder}/${sanitizeFileName(options.accountName)}`;
	}
	if (options.subfolderByAutoKeywords) {
		const index = options.keywordIndex ?? { byKeyword: new Map(), folderNames: new Set() };
		const kwFolder = findAutoKeywordFolder(
			options.title,
			index,
			options.topicGroups || [],
		);
		if (kwFolder) {
			folder = `${folder}/${kwFolder}`;
		}
	}
	return folder;
}
