/**
 * 多源链接识别与抓取：微信公众号 / 腾讯云 / 阿里云 / 小红书
 */

import { requestUrl } from 'obsidian';
import { htmlToMarkdown, type ParsedWechatArticle, type SyncArticle } from './markdown';

export type ArticleSource =
	| 'wechat'
	| 'tencent_cloud'
	| 'aliyun'
	| 'xiaohongshu'
	| 'unknown';

export interface SourceProfile {
	id: ArticleSource;
	/** 归档根目录名（按链接站点头部区分） */
	archiveFolder: string;
	/** 媒体附件根目录 */
	mediaFolder: string;
	label: string;
	referer: string;
}

export const SOURCE_PROFILES: Record<Exclude<ArticleSource, 'unknown'>, SourceProfile> = {
	wechat: {
		id: 'wechat',
		archiveFolder: '微信文章收藏',
		mediaFolder: '微信公众号媒体',
		label: '微信公众号',
		referer: 'https://mp.weixin.qq.com/',
	},
	tencent_cloud: {
		id: 'tencent_cloud',
		archiveFolder: '腾讯云开发者社区',
		mediaFolder: '腾讯云媒体',
		label: '腾讯云开发者社区',
		referer: 'https://cloud.tencent.com/',
	},
	aliyun: {
		id: 'aliyun',
		archiveFolder: '阿里云开发者社区',
		mediaFolder: '阿里云媒体',
		label: '阿里云开发者社区',
		referer: 'https://developer.aliyun.com/',
	},
	xiaohongshu: {
		id: 'xiaohongshu',
		archiveFolder: '小红书',
		mediaFolder: '小红书媒体',
		label: '小红书',
		referer: 'https://www.xiaohongshu.com/',
	},
};

const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MOBILE_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.40';

/** 从剪贴板/分享文案中提取第一个可识别链接 */
export function extractImportableUrl(text: string | null | undefined): string | null {
	if (!text) return null;
	const patterns = [
		/https?:\/\/mp\.weixin\.qq\.com\/s[^\s"'<>]*/i,
		/https?:\/\/(?:cloud\.tencent\.com|cloud\.tencent\.cn)\/developer\/article\/\d+[^\s"'<>]*/i,
		/https?:\/\/developer\.aliyun\.com\/article\/\d+[^\s"'<>]*/i,
		/https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:discovery\/item|explore)\/[A-Za-z0-9]+[^\s"'<>]*/i,
		/https?:\/\/(?:www\.)?xiaohongshu\.com\/[^\s"'<>]*/i,
		/https?:\/\/(?:www\.)?xhslink\.(?:com|cn)\/[^\s"'<>]*/i,
	];
	for (const re of patterns) {
		const m = text.match(re);
		if (m?.[0]) return cleanUrl(m[0]);
	}
	return null;
}

/** @deprecated 使用 extractImportableUrl */
export function extractWechatUrl(text: string | null | undefined): string | null {
	if (!text) return null;
	const m = text.match(/https?:\/\/mp\.weixin\.qq\.com\/s[^\s"'<>]*/i);
	return m?.[0] ? cleanUrl(m[0]) : null;
}

export function detectSource(url: string): ArticleSource {
	const u = (url || '').toLowerCase();
	if (/mp\.weixin\.qq\.com\/s/.test(u)) return 'wechat';
	if (/cloud\.tencent\.(com|cn)\/developer\/article\//.test(u)) return 'tencent_cloud';
	if (/developer\.aliyun\.com\/article\//.test(u)) return 'aliyun';
	if (/xiaohongshu\.com|xhslink\.(com|cn)/.test(u)) return 'xiaohongshu';
	return 'unknown';
}

export function getSourceProfile(source: ArticleSource, fallbackSyncFolder?: string): SourceProfile {
	if (source === 'wechat') {
		return {
			...SOURCE_PROFILES.wechat,
			archiveFolder: fallbackSyncFolder?.trim() || SOURCE_PROFILES.wechat.archiveFolder,
		};
	}
	if (source === 'tencent_cloud') return SOURCE_PROFILES.tencent_cloud;
	if (source === 'aliyun') return SOURCE_PROFILES.aliyun;
	if (source === 'xiaohongshu') return SOURCE_PROFILES.xiaohongshu;
	return {
		id: 'wechat',
		archiveFolder: fallbackSyncFolder?.trim() || SOURCE_PROFILES.wechat.archiveFolder,
		mediaFolder: SOURCE_PROFILES.wechat.mediaFolder,
		label: '未知来源',
		referer: 'https://www.google.com/',
	};
}

export function extractShareTitle(text: string, url: string): string {
	const cleaned = (text || '')
		.replace(url, ' ')
		.replace(/https?:\/\/\S+/gi, ' ')
		.replace(/存好内容[，,].*/g, ' ')
		.replace(/复制这段文字[，,].*/g, ' ')
		.replace(/打开【小红书】.*/g, ' ')
		.replace(/去【小红书】.*/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned) return '';
	// 取第一句/第一行作为标题
	const first = cleaned.split(/[。！？\n]/)[0]?.trim() || cleaned;
	return first.slice(0, 80);
}

function cleanUrl(url: string): string {
	return url.replace(/[)，。；;！!？?]+$/, '').trim();
}

export async function fetchArticleByUrl(
	url: string,
	options?: { clipboardText?: string },
): Promise<SyncArticle & { source: ArticleSource }> {
	const source = detectSource(url);
	if (source === 'wechat') {
		const parsed = await fetchWechat(url);
		return toSyncArticle(url, parsed, source);
	}
	if (source === 'tencent_cloud') {
		const parsed = await fetchTencentCloud(url);
		return toSyncArticle(url, parsed, source);
	}
	if (source === 'aliyun') {
		const parsed = await fetchAliyun(url);
		return toSyncArticle(url, parsed, source);
	}
	if (source === 'xiaohongshu') {
		const parsed = await fetchXiaohongshu(url, options?.clipboardText);
		return toSyncArticle(url, parsed, source);
	}
	throw new Error('暂不支持该链接类型');
}

function toSyncArticle(
	url: string,
	parsed: ParsedWechatArticle & { parseError?: string },
	source: ArticleSource,
): SyncArticle & { source: ArticleSource } {
	const hasContent = Boolean(parsed.markdown?.trim());
	return {
		id: `local_${Date.now()}`,
		title: parsed.title,
		author: parsed.author,
		account: parsed.account,
		sourceUrl: url,
		markdown: parsed.markdown,
		publishedAt: parsed.publishedAt,
		savedAt: new Date().toISOString(),
		parseStatus: hasContent ? 'ok' : 'empty',
		parseError: parsed.parseError || (hasContent ? undefined : '未能解析正文或图片'),
		contentKind: parsed.contentKind,
		source,
	};
}

async function fetchWechat(url: string): Promise<ParsedWechatArticle> {
	const response = await requestUrl({
		url,
		headers: {
			'User-Agent': BROWSER_UA,
			Referer: SOURCE_PROFILES.wechat.referer,
		},
	});
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`抓取失败 HTTP ${response.status}`);
	}
	return htmlToMarkdown(response.text);
}

async function fetchAliyun(url: string): Promise<ParsedWechatArticle & { parseError?: string }> {
	const response = await requestUrl({
		url,
		headers: {
			'User-Agent': BROWSER_UA,
			Referer: SOURCE_PROFILES.aliyun.referer,
			Accept: 'text/html,application/xhtml+xml',
		},
	});
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`阿里云抓取失败 HTTP ${response.status}`);
	}
	const html = response.text || '';
	const title =
		matchGroup(html, /class="article-title"[^>]*>([\s\S]*?)<\//i)?.replace(/<[^>]+>/g, '').trim() ||
		matchGroup(html, /property="og:title"\s+content="([^"]+)"/i)?.replace(/-阿里云.*$/, '').trim() ||
		matchGroup(html, /<title[^>]*>([^<]+)/i)?.replace(/-阿里云.*$/, '').trim() ||
		'未命名阿里云文章';
	const author =
		matchGroup(html, /href="\/profile\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i)?.replace(/<[^>]+>/g, '').trim() ||
		'';
	const timeText =
		matchGroup(html, /class="article-info-time"[^>]*>([\s\S]*?)<\//i)?.replace(/<[^>]+>/g, '').trim() ||
		'';
	const publishedAt = resolveAliyunTime(timeText);

	const larkContent = extractAliyunLarkContent(html);
	let markdown = '';
	if (larkContent) {
		markdown = lakeHtmlToMarkdown(larkContent);
	}
	if (!markdown.trim()) {
		const contentHtml =
			matchGroup(html, /id="lark-content"[^>]*>([\s\S]*?)<\/div>/i) ||
			matchGroup(html, /class="article-content"[^>]*>([\s\S]*?)<div class="article-comment"/i) ||
			'';
		markdown = convertGenericHtml(contentHtml);
	}

	const imgCount = (markdown.match(/!\[[^\]]*\]\(/g) || []).length;
	return {
		title: decodeHtml(title),
		author: decodeHtml(author),
		account: '阿里云开发者社区',
		markdown: markdown.trim(),
		publishedAt,
		contentKind: imgCount > 0 && markdown.length < 80 ? 'image_gallery' : 'standard',
		parseError: markdown.trim() ? undefined : '未能从阿里云页面解析正文',
	};
}

/** 页面中 GLOBAL_CONFIG.larkContent = '...' 赋值（初始字段常为空） */
function extractAliyunLarkContent(html: string): string {
	const assign =
		html.match(/GLOBAL_CONFIG\.larkContent\s*=\s*'((?:\\'|[^'])*)'/) ||
		html.match(/GLOBAL_CONFIG\.larkContent\s*=\s*"((?:\\"|[^"])*)"/);
	if (assign?.[1]) return decodeJsString(assign[1]);

	const inline =
		html.match(/"larkContent"\s*:\s*'((?:\\'|[^'])*)'/) ||
		html.match(/"larkContent"\s*:\s*"((?:\\"|[^"])*)"/);
	if (inline?.[1]) return decodeJsString(inline[1]);
	return '';
}

function decodeJsString(input: string): string {
	return input
		.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r')
		.replace(/\\t/g, '\t')
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\\//g, '/')
		.replace(/\\\\/g, '\\');
}

/** 语雀 Lake HTML（含 card）→ Markdown */
function lakeHtmlToMarkdown(html: string): string {
	let text = html;
	// 去掉 lake doctype / meta
	text = text.replace(/<!doctype lake>/i, '');
	text = text.replace(/<meta[^>]*>/gi, '');

	// <card ... value="data:..."> → 图片 / 代码 / 视频
	text = text.replace(/<card\b([^>]*)>(?:<\/card>)?/gi, (_m, attrs: string) => {
		const name = matchAttr(attrs, 'name') || '';
		const value = matchAttr(attrs, 'value') || '';
		const data = parseLakeCardValue(value);
		if (!data) return '\n\n';
		if (/^image$/i.test(name)) {
			const src = normalizeMediaUrl(String(data.src || data.url || ''));
			return src ? `\n\n![](${src})\n\n` : '\n\n';
		}
		if (/^video$/i.test(name)) {
			const src = normalizeMediaUrl(String(data.src || data.url || data.videoUrl || ''));
			return src ? `\n\n<video controls width="100%" src="${src}"></video>\n\n` : '\n\n';
		}
		if (/^codeblock$/i.test(name)) {
			const code = String(data.code || '');
			const mode = String(data.mode || '').replace(/plain/i, '');
			const lang = mode && mode !== 'plain' ? mode : '';
			return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
		}
		return '\n\n';
	});

	return convertGenericHtml(text);
}

function parseLakeCardValue(value: string): Record<string, unknown> | null {
	if (!value) return null;
	let raw = value.trim();
	if (raw.startsWith('data:')) raw = raw.slice('data:'.length);
	try {
		const decoded = decodeURIComponent(raw);
		const obj = JSON.parse(decoded) as Record<string, unknown>;
		return obj && typeof obj === 'object' ? obj : null;
	} catch {
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return null;
		}
	}
}

function matchAttr(tag: string, name: string): string | undefined {
	const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
	return m?.[1];
}

function resolveAliyunTime(text: string): string | undefined {
	const t = (text || '').trim();
	if (!t) return undefined;
	const m = t.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
	if (!m) return t;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (!y || !mo || !d) return t;
	return new Date(Date.UTC(y, mo - 1, d)).toISOString();
}

async function fetchTencentCloud(url: string): Promise<ParsedWechatArticle & { parseError?: string }> {
	const response = await requestUrl({
		url,
		headers: {
			'User-Agent': BROWSER_UA,
			Referer: SOURCE_PROFILES.tencent_cloud.referer,
			Accept: 'text/html,application/xhtml+xml',
		},
	});
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`腾讯云抓取失败 HTTP ${response.status}`);
	}
	const html = response.text || '';
	const fromNext = parseTencentNextData(html);
	if (fromNext && fromNext.markdown.trim()) return fromNext;

	// 回退：从页面渲染 HTML 提取
	const title =
		matchGroup(html, /property="og:title"\s+content="([^"]+)"/i)?.replace(/-腾讯云.*$/, '').trim() ||
		matchGroup(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, '').trim() ||
		'未命名腾讯云文章';
	const contentHtml =
		matchGroup(html, /class="[^"]*rno-markdown[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*rno-/i) ||
		matchGroup(html, /article-content[^>]*>([\s\S]*?)<\/article>/i) ||
		'';
	const markdown = contentHtml
		? convertGenericHtml(contentHtml)
		: '';
	const images = extractImgUrls(contentHtml || html).filter((u) => /qcloudimg|tencent/i.test(u));
	let md = markdown;
	if (images.length > 0) {
		const existing = new Set([...(md.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g) || [])]);
		const extra = images.filter((u) => !existing.has(`![](${u})`));
		if (extra.length) md = md ? `${md}\n\n${extra.map((u) => `![](${u})`).join('\n\n')}` : extra.map((u) => `![](${u})`).join('\n\n');
	}
	return {
		title: decodeHtml(title),
		author: '',
		account: '腾讯云开发者社区',
		markdown: md.trim(),
		publishedAt: undefined,
		contentKind: images.length > 0 && md.length < 80 ? 'image_gallery' : md ? 'standard' : 'text_only',
		parseError: md.trim() ? undefined : '未能从腾讯云页面解析正文',
	};
}

function parseTencentNextData(html: string): (ParsedWechatArticle & { parseError?: string }) | null {
	const raw = matchGroup(html, /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
	if (!raw) return null;
	try {
		const data = JSON.parse(raw) as {
			props?: {
				pageProps?: {
					fallback?: Record<
						string,
						{
							articleInfo?: {
								title?: string;
								content?: { blocks?: DraftBlock[]; entityMap?: Record<string, DraftEntity> };
								plain?: string;
								createTime?: number | string;
							};
							authorInfo?: { nickname?: string };
							publishTime?: number;
						}
					>;
				};
			};
		};
		const fallback = data.props?.pageProps?.fallback;
		if (!fallback) return null;
		const detailKey = Object.keys(fallback).find((k) => k.includes('/api/article/detail'));
		const detail = detailKey ? fallback[detailKey] : Object.values(fallback)[0];
		if (!detail?.articleInfo) return null;

		const info = detail.articleInfo;
		const title = info.title || '未命名腾讯云文章';
		const author = detail.authorInfo?.nickname || '';
		const publishedAt = resolveUnixTime(detail.publishTime || info.createTime);

		let markdown = '';
		if (info.content?.blocks?.length) {
			markdown = draftJsToMarkdown(info.content.blocks, info.content.entityMap || {});
		}
		if (!markdown.trim() && info.plain) {
			markdown = info.plain.trim();
		}

		const imgCount = (markdown.match(/!\[[^\]]*\]\(/g) || []).length;
		return {
			title,
			author,
			account: '腾讯云开发者社区',
			markdown: markdown.trim(),
			publishedAt,
			contentKind: imgCount > 0 && markdown.length < 80 ? 'image_gallery' : 'standard',
		};
	} catch (err) {
		console.warn('VaultBridge parse Tencent __NEXT_DATA__ failed', err);
		return null;
	}
}

interface DraftBlock {
	text?: string;
	type?: string;
	depth?: number;
	inlineStyleRanges?: Array<{ offset: number; length: number; style: string }>;
	entityRanges?: Array<{ offset: number; length: number; key: number }>;
	data?: Record<string, unknown>;
}

interface DraftEntity {
	type?: string;
	data?: {
		url?: string;
		imageUrl?: string;
		imageAlt?: string;
		videoUrl?: string;
		src?: string;
		href?: string;
		[key: string]: unknown;
	};
}

function draftJsToMarkdown(
	blocks: DraftBlock[],
	entityMap: Record<string, DraftEntity>,
): string {
	const lines: string[] = [];
	let listBuffer: string[] = [];
	let listKind: 'ol' | 'ul' | null = null;
	let codeBuffer: string[] = [];

	const flushList = () => {
		if (listBuffer.length) {
			lines.push(listBuffer.join('\n'));
			listBuffer = [];
			listKind = null;
		}
	};
	const flushCode = () => {
		if (codeBuffer.length) {
			lines.push('```\n' + codeBuffer.join('\n') + '\n```');
			codeBuffer = [];
		}
	};

	for (const block of blocks) {
		const type = block.type || 'unstyled';
		if (type !== 'code-block') flushCode();
		if (type !== 'ordered-list-item' && type !== 'unordered-list-item') flushList();

		if (type === 'code-block') {
			codeBuffer.push(block.text || '');
			continue;
		}

		const atomic = renderAtomicOrMedia(block, entityMap);
		if (atomic !== null) {
			lines.push(atomic);
			continue;
		}

		const text = applyDraftInline(block, entityMap);
		const depth = block.depth || 0;
		const indent = '  '.repeat(Math.max(0, depth));

		switch (type) {
			case 'header-one':
				lines.push(`# ${text}`);
				break;
			case 'header-two':
				lines.push(`## ${text}`);
				break;
			case 'header-three':
				lines.push(`### ${text}`);
				break;
			case 'header-four':
				lines.push(`#### ${text}`);
				break;
			case 'header-five':
				lines.push(`##### ${text}`);
				break;
			case 'header-six':
				lines.push(`###### ${text}`);
				break;
			case 'blockquote':
				lines.push(`> ${text}`);
				break;
			case 'unordered-list-item':
				if (listKind && listKind !== 'ul') flushList();
				listKind = 'ul';
				listBuffer.push(`${indent}- ${text}`);
				break;
			case 'ordered-list-item':
				if (listKind && listKind !== 'ol') flushList();
				listKind = 'ol';
				listBuffer.push(`${indent}1. ${text}`);
				break;
			default:
				if (text.trim()) lines.push(text);
				else lines.push('');
		}
	}
	flushCode();
	flushList();
	return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderAtomicOrMedia(block: DraftBlock, entityMap: Record<string, DraftEntity>): string | null {
	const ranges = block.entityRanges || [];
	if (block.type !== 'atomic' && ranges.length === 0) return null;

	for (const r of ranges) {
		const ent = entityMap[String(r.key)];
		if (!ent) continue;
		const t = (ent.type || '').toUpperCase();
		const d = ent.data || {};
		if (t === 'IMAGE' || t === 'IMG') {
			const url = normalizeMediaUrl(String(d.imageUrl || d.url || d.src || ''));
			if (url) return `![](${url})`;
		}
		if (t === 'VIDEO' || t === 'MEDIA' || t.includes('VIDEO')) {
			const url = normalizeMediaUrl(
				String(d.videoUrl || d.url || d.src || d.href || ''),
			);
			if (url) {
				return `<video controls width="100%" src="${url}"></video>`;
			}
		}
	}
	if (block.type === 'atomic') return '';
	return null;
}

function applyDraftInline(block: DraftBlock, entityMap: Record<string, DraftEntity>): string {
	const text = block.text || '';
	if (!text) return '';

	const linkRanges = [...(block.entityRanges || [])]
		.filter((r) => (entityMap[String(r.key)]?.type || '').toUpperCase() === 'LINK')
		.sort((a, b) => a.offset - b.offset);

	return rebuildWithLinks(text, block.inlineStyleRanges || [], linkRanges, entityMap);
}

function rebuildWithLinks(
	text: string,
	styles: Array<{ offset: number; length: number; style: string }>,
	linkRanges: Array<{ offset: number; length: number; key: number }>,
	entityMap: Record<string, DraftEntity>,
): string {
	if (linkRanges.length === 0) return applyStylesOnPlain(text, styles);

	const parts: string[] = [];
	let cursor = 0;
	const links = [...linkRanges].sort((a, b) => a.offset - b.offset);
	for (const r of links) {
		if (r.offset > cursor) {
			parts.push(
				applyStylesOnPlain(
					text.slice(cursor, r.offset),
					shiftStyles(styles, cursor, r.offset),
				),
			);
		}
		const ent = entityMap[String(r.key)];
		const href = String(ent?.data?.url || ent?.data?.href || '');
		const label = applyStylesOnPlain(
			text.slice(r.offset, r.offset + r.length),
			shiftStyles(styles, r.offset, r.offset + r.length),
		);
		parts.push(`[${label}](${href})`);
		cursor = r.offset + r.length;
	}
	if (cursor < text.length) {
		parts.push(
			applyStylesOnPlain(text.slice(cursor), shiftStyles(styles, cursor, text.length)),
		);
	}
	return parts.join('');
}

function shiftStyles(
	styles: Array<{ offset: number; length: number; style: string }>,
	start: number,
	end: number,
): Array<{ offset: number; length: number; style: string }> {
	const out: Array<{ offset: number; length: number; style: string }> = [];
	for (const s of styles) {
		const sEnd = s.offset + s.length;
		if (sEnd <= start || s.offset >= end) continue;
		const ns = Math.max(s.offset, start);
		const ne = Math.min(sEnd, end);
		out.push({ offset: ns - start, length: ne - ns, style: s.style });
	}
	return out;
}

function applyStylesOnPlain(
	text: string,
	styles: Array<{ offset: number; length: number; style: string }>,
): string {
	if (!text || styles.length === 0) return text;
	type Mark = { i: number; open: boolean; token: string; pri: number };
	const marks: Mark[] = [];
	let pri = 0;
	for (const s of styles) {
		const token = styleToken(s.style);
		if (!token) continue;
		marks.push({ i: s.offset, open: true, token, pri: pri++ });
		marks.push({ i: s.offset + s.length, open: false, token, pri: pri++ });
	}
	marks.sort((a, b) => {
		if (a.i !== b.i) return a.i - b.i;
		if (a.open !== b.open) return a.open ? 1 : -1;
		return b.pri - a.pri;
	});
	let out = '';
	let prev = 0;
	for (const m of marks) {
		out += text.slice(prev, m.i);
		out += m.open ? m.token : m.token;
		prev = m.i;
	}
	out += text.slice(prev);
	return out;
}

function styleToken(style: string): string {
	const s = (style || '').toUpperCase();
	if (s === 'BOLD') return '**';
	if (s === 'ITALIC') return '*';
	if (s === 'CODE') return '`';
	return '';
}

async function fetchXiaohongshu(
	url: string,
	clipboardText?: string,
): Promise<ParsedWechatArticle & { parseError?: string }> {
	const shareTitle = extractShareTitle(clipboardText || '', url);
	let finalUrl = url;
	let html = '';

	try {
		const resolved = await resolveXiaohongshuUrl(url);
		finalUrl = resolved.finalUrl || url;
		html = resolved.html || '';
	} catch (err) {
		console.warn('VaultBridge xiaohongshu resolve failed', err);
	}

	const ogTitle =
		matchGroup(html, /property="og:title"\s+content="([^"]+)"/i) ||
		matchGroup(html, /content="([^"]+)"\s+property="og:title"/i);
	const ogDesc =
		matchGroup(html, /property="og:description"\s+content="([^"]+)"/i) ||
		matchGroup(html, /content="([^"]+)"\s+property="og:description"/i);
	const ogImages = [
		...html.matchAll(/property="og:image"\s+content="([^"]+)"/gi),
		...html.matchAll(/content="([^"]+)"\s+property="og:image"/gi),
	]
		.map((m) => normalizeMediaUrl(m[1] || ''))
		.filter(Boolean);

	const stateNote = parseXiaohongshuInitialState(html);
	const title =
		stateNote?.title ||
		decodeHtml(ogTitle || '') ||
		shareTitle ||
		'小红书笔记';
	const author = stateNote?.author || '';
	const desc = stateNote?.desc || decodeHtml(ogDesc || '') || shareTitle;
	const images = dedupe([...((stateNote?.images || []) as string[]), ...ogImages]);
	const videos = (stateNote?.videos || []) as string[];

	const parts: string[] = [];
	if (desc) parts.push(desc);
	for (const img of images) parts.push(`![](${img})`);
	for (const v of videos) {
		parts.push(`<video controls width="100%" src="${v}"></video>`);
	}
	parts.push(`\n[打开小红书原文](${finalUrl})`);

	const markdown = parts.join('\n\n').trim();
	const hasRich = images.length > 0 || videos.length > 0 || Boolean(stateNote?.desc || ogDesc);

	return {
		title: title.slice(0, 120),
		author,
		account: '小红书',
		markdown,
		publishedAt: stateNote?.publishedAt,
		contentKind: images.length > 0 && !stateNote?.desc ? 'image_gallery' : 'standard',
		parseError: hasRich
			? undefined
			: '小红书反爬较强，未能拉取完整正文/媒体；已保存分享文案与链接，可在 App 内打开查看',
	};
}

async function resolveXiaohongshuUrl(
	url: string,
): Promise<{ finalUrl: string; html: string }> {
	// 短链优先用移动 UA，桌面常 404
	const isShort = /xhslink\.(com|cn)/i.test(url);
	const headersList = isShort
		? [
				{ 'User-Agent': MOBILE_UA, Referer: 'https://www.xiaohongshu.com/' },
				{ 'User-Agent': BROWSER_UA, Referer: 'https://www.xiaohongshu.com/' },
			]
		: [
				{ 'User-Agent': BROWSER_UA, Referer: 'https://www.xiaohongshu.com/' },
				{ 'User-Agent': MOBILE_UA, Referer: 'https://www.xiaohongshu.com/' },
			];

	let lastError: Error | null = null;
	for (const headers of headersList) {
		try {
			const response = await requestUrl({ url, headers });
			const html = response.text || '';
			// requestUrl 通常已跟随跳转；从 canonical / og:url 取最终地址
			const canonical =
				matchGroup(html, /rel="canonical"\s+href="([^"]+)"/i) ||
				matchGroup(html, /property="og:url"\s+content="([^"]+)"/i) ||
				url;
			if (response.status >= 200 && response.status < 300 && html.length > 200) {
				return { finalUrl: canonical, html };
			}
			lastError = new Error(`HTTP ${response.status}`);
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
		}
	}
	throw lastError || new Error('小红书链接无法访问');
}

function parseXiaohongshuInitialState(html: string): {
	title?: string;
	desc?: string;
	author?: string;
	images?: string[];
	videos?: string[];
	publishedAt?: string;
} | null {
	if (!html) return null;
	// window.__INITIAL_STATE__=...
	const m =
		html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i) ||
		html.match(/__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script>|;)/i);
	if (!m?.[1]) {
		// 退化：从 HTML 里捞图片 CDN
		const imgs = extractImgUrls(html).filter((u) => /xhscdn|xiaohongshu|sns-webpic/i.test(u));
		if (imgs.length === 0) return null;
		return { images: imgs.slice(0, 30) };
	}
	try {
		const jsonText = m[1]
			.replace(/undefined/g, 'null')
			.replace(/:\s*undefined/g, ':null');
		const state = JSON.parse(jsonText) as Record<string, unknown>;
		const note = findXhsNote(state);
		if (!note) return { images: extractImgUrls(html).filter((u) => /xhscdn|xiaohongshu/i.test(u)).slice(0, 30) };

		const title = String(note.title || note.displayTitle || '').trim();
		const desc = String(note.desc || note.description || note.summary || '').trim();
		const user = (note.user || note.author || {}) as Record<string, unknown>;
		const author = String(user.nickname || user.name || note.nickname || '').trim();
		const images: string[] = [];
		const videos: string[] = [];

		const imageList = (note.imageList || note.images || note.image_list || []) as Array<
			Record<string, unknown> | string
		>;
		for (const img of imageList) {
			if (typeof img === 'string') {
				images.push(normalizeMediaUrl(img));
			} else if (img && typeof img === 'object') {
				const infoList = img.infoList as Array<{ url?: string }> | undefined;
				if (infoList?.[0]?.url) {
					images.push(normalizeMediaUrl(infoList[0].url));
					continue;
				}
				const u = String(img.urlDefault || img.url || img.original || '');
				if (u.startsWith('http')) images.push(normalizeMediaUrl(u));
			}
		}

		const video = (note.video || note.videoInfo || {}) as Record<string, unknown>;
		const media = (video.media || video) as Record<string, unknown>;
		const stream = (media.stream || {}) as Record<string, unknown>;
		for (const key of ['h264', 'h265', 'av1', 'mp4']) {
			const arr = stream[key] as Array<{ masterUrl?: string; url?: string }> | undefined;
			if (arr?.[0]) {
				const vu = arr[0].masterUrl || arr[0].url;
				if (vu) videos.push(normalizeMediaUrl(vu));
			}
		}
		if (typeof video.url === 'string') videos.push(normalizeMediaUrl(video.url));

		return {
			title: title || desc.slice(0, 40),
			desc,
			author,
			images: dedupe(images.filter(Boolean)),
			videos: dedupe(videos.filter(Boolean)),
			publishedAt: note.time
				? new Date(Number(note.time)).toISOString()
				: undefined,
		};
	} catch (err) {
		console.warn('VaultBridge parse XHS state failed', err);
		return null;
	}
}

function findXhsNote(state: Record<string, unknown>): Record<string, unknown> | null {
	const noteData = state.note as Record<string, unknown> | undefined;
	const map = (noteData?.noteDetailMap || state.noteDetailMap) as
		| Record<string, { note?: Record<string, unknown> }>
		| undefined;
	if (map && typeof map === 'object') {
		const first = Object.values(map)[0];
		if (first?.note) return first.note;
	}
	if (noteData?.note && typeof noteData.note === 'object') {
		return noteData.note as Record<string, unknown>;
	}
	return null;
}

function convertGenericHtml(html: string): string {
	let text = html;
	text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
	text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
	text = text.replace(/<br\s*\/?>/gi, '\n');
	text = text.replace(/<\/p>/gi, '\n\n');
	text = text.replace(/<\/div>/gi, '\n');
	text = text.replace(/<\/h([1-6])>/gi, '\n\n');
	text = text.replace(/<h([1-6])[^>]*>/gi, (_, level) => `${'#'.repeat(Number(level))} `);
	text = text.replace(/<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi, (_m, code) => {
		return `\n\`\`\`\n${decodeHtml(code.replace(/<[^>]+>/g, ''))}\n\`\`\`\n`;
	});
	text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, c) => `\`${c.replace(/<[^>]+>/g, '')}\``);
	text = text.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, src) => {
		const url = normalizeMediaUrl(src);
		return url ? `![](${url})\n\n` : '';
	});
	text = text.replace(/<(?:video|source)[^>]*(?:src)=["']([^"']+)["'][^>]*>/gi, (_m, src) => {
		const url = normalizeMediaUrl(src);
		return url ? `\n<video controls width="100%" src="${url}"></video>\n\n` : '';
	});
	text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
		const clean = label.replace(/<[^>]+>/g, '').trim();
		return `[${clean || href}](${href})`;
	});
	text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
	text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
	text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, li) => `- ${li.replace(/<[^>]+>/g, '').trim()}\n`);
	text = text.replace(/<[^>]+>/g, '');
	text = decodeHtml(text);
	return text.replace(/\n{3,}/g, '\n\n').trim();
}

function extractImgUrls(html: string): string[] {
	const urls: string[] = [];
	for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
		const u = normalizeMediaUrl(m[1] || '');
		if (u && !u.startsWith('data:')) urls.push(u);
	}
	return dedupe(urls);
}

function normalizeMediaUrl(url: string): string {
	if (!url?.trim()) return '';
	let normalized = decodeHtml(url.trim());
	if (normalized.startsWith('//')) normalized = `https:${normalized}`;
	if (normalized.startsWith('http://')) {
		normalized = `https://${normalized.slice('http://'.length)}`;
	}
	return normalized.replace(/&amp;/g, '&');
}

function resolveUnixTime(value: number | string | undefined): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n) || n <= 0) return String(value);
	const ms = n < 1e12 ? n * 1000 : n;
	return new Date(ms).toISOString();
}

function matchGroup(text: string, regex: RegExp): string | undefined {
	const m = text.match(regex);
	return m?.[1];
}

function decodeHtml(input: string): string {
	return input
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function dedupe(urls: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const u of urls) {
		if (!u || seen.has(u)) continue;
		seen.add(u);
		out.push(u);
	}
	return out;
}
