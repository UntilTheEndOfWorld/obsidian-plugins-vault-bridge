export interface SyncArticle {
	id: string;
	title: string;
	author?: string;
	account?: string;
	sourceUrl: string;
	markdown: string;
	publishedAt?: string;
	savedAt: string;
	parseStatus: string;
	parseError?: string;
	contentKind?: string;
	/** wechat | tencent_cloud | aliyun | xiaohongshu */
	source?: string;
}

export interface ParsedWechatArticle {
	title: string;
	author: string;
	account: string;
	markdown: string;
	publishedAt?: string;
	contentKind: 'standard' | 'image_gallery' | 'text_only';
}

export function extractWechatUrl(text: string | null | undefined): string | null {
	if (!text) return null;
	const match = text.match(/https?:\/\/mp\.weixin\.qq\.com\/s[^\s"'<>]*/i);
	if (!match) return null;
	return match[0].replace(/[)，。；;]+$/, '');
}

export function sanitizeFileName(value: string): string {
	return value
		.replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
}

export function formatArticleMarkdown(article: SyncArticle): string {
	const frontmatter = [
		'---',
		`source_url: ${JSON.stringify(article.sourceUrl || '')}`,
		`title: ${JSON.stringify(article.title || '')}`,
		article.source ? `source: ${JSON.stringify(article.source)}` : undefined,
		article.account ? `account: ${JSON.stringify(article.account)}` : undefined,
		article.author ? `author: ${JSON.stringify(article.author)}` : undefined,
		article.publishedAt ? `published_at: ${JSON.stringify(article.publishedAt)}` : undefined,
		`saved_at: ${JSON.stringify(article.savedAt || new Date().toISOString())}`,
		`sync_id: ${JSON.stringify(article.id || '')}`,
		`parse_status: ${JSON.stringify(article.parseStatus || 'ok')}`,
		article.contentKind ? `content_kind: ${JSON.stringify(article.contentKind)}` : undefined,
		article.parseError ? `parse_error: ${JSON.stringify(article.parseError)}` : undefined,
		'---',
	].filter(Boolean);

	return `${frontmatter.join('\n')}\n\n# ${article.title || '未命名文章'}\n\n${(article.markdown || '').trim()}\n`;
}

export function resolveArticleFileName(article: SyncArticle): string {
	const title = article.title || '未命名公众号文章';
	return sanitizeFileName(title);
}

/** 微信公众号 HTML → Markdown（含以图为主的文章） */
export function htmlToMarkdown(html: string): ParsedWechatArticle {
	const title =
		extractScriptString(html, /window\.msg_title\s*=\s*window\.title\s*=\s*'([^']*)'/) ||
		matchGroup(html, /property="og:title"\s+content="([^"]+)"/i) ||
		matchGroup(html, /<h1[^>]*class="rich_media_title"[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, '').trim() ||
		'未命名公众号文章';

	const account =
		extractScriptString(html, /nick_name\s*:\s*'([^']*)'/) ||
		matchGroup(html, /id="js_name"[^>]*>([\s\S]*?)<\/a>/i)?.replace(/<[^>]+>/g, '').trim() ||
		matchGroup(html, /property="og:article:author"\s+content="([^"]+)"/i) ||
		'';

	const author =
		matchGroup(html, /id="js_author_name"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.replace(/<[^>]+>/g, '').trim() ||
		account;

	const publishedAt = resolvePublishedAt(html);

	const contentHtml =
		matchGroup(html, /id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<script/i) ||
		matchGroup(html, /id="js_content"[^>]*>([\s\S]*?)<\/div>/i) ||
		'';

	const videos = extractWechatVideos(html, contentHtml);
	const videoById = new Map<string, WechatVideoAsset>();
	for (const v of videos) {
		if (v.videoId) videoById.set(v.videoId, v);
	}

	const usedVideoIds = new Set<string>();
	const textFromHtml = convertContentHtml(contentHtml, videoById, usedVideoIds);
	const textFromScript =
		extractScriptString(html, /content_noencode\s*:\s*'([^']*)'/) ||
		extractScriptString(html, /content_noencode\s*:\s*'((?:\\'|[^'])*)'/) ||
		extractScriptString(html, /content_noencode\s*:\s*"((?:\\"|[^"])*)"/) ||
		'';

	let markdown = textFromHtml.trim() || decodeHtml(textFromScript).trim();

	const htmlImages = extractImagesFromHtml(contentHtml || html);
	const galleryImages = extractPicturePageImages(html);
	// 正文已内联的图片不要再在文末重复追加
	const inlineImageKeys = new Set(
		[...(markdown.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g) || [])]
			.map((m) => imageDedupeKey(m.replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/, '$1')))
			.filter(Boolean),
	);
	const images = dedupeImageUrls([...htmlImages, ...galleryImages]).filter(
		(url) => !inlineImageKeys.has(imageDedupeKey(url)),
	);

	let contentKind: ParsedWechatArticle['contentKind'] = 'standard';
	if (images.length > 0 && markdown.length < 80) {
		contentKind = 'image_gallery';
	} else if (images.length === 0 && markdown.length > 0) {
		contentKind = 'text_only';
	}

	if (images.length > 0) {
		const imageMd = images.map((url) => `![](${url})`).join('\n\n');
		markdown = markdown ? `${markdown}\n\n${imageMd}` : imageMd;
	}

	// 正文内未能落位的视频，再追加到文末（保底）
	const orphanVideos = videos.filter((v) => !v.videoId || !usedVideoIds.has(v.videoId));
	if (orphanVideos.length > 0) {
		const videoMd = orphanVideos.map((v) => formatVideoEmbed(v, true)).join('\n\n');
		markdown = markdown ? `${markdown}\n\n${videoMd}` : videoMd;
	}

	return {
		title: decodeHtml(title),
		author: decodeHtml(author),
		account: decodeHtml(account),
		markdown: markdown.trim(),
		publishedAt,
		contentKind,
	};
}

function resolvePublishedAt(html: string): string | undefined {
	const createTime = extractScriptString(html, /create_time\s*:\s*'([^']*)'/);
	if (createTime) return createTime;

	const publishedAt =
		matchGroup(html, /id="publish_time"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.replace(/<[^>]+>/g, '').trim() ||
		matchGroup(html, /var\s+ct\s*=\s*"(\d+)"/);

	if (publishedAt && /^\d+$/.test(publishedAt)) {
		return new Date(Number(publishedAt) * 1000).toISOString();
	}
	return publishedAt || undefined;
}

function extractScriptString(html: string, regex: RegExp): string | undefined {
	const m = html.match(regex);
	if (!m?.[1]) return undefined;
	return decodeJsString(m[1]);
}

function decodeJsString(input: string): string {
	return input
		.replace(/\\x26amp;/g, '&')
		.replace(/\\x26/g, '&')
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r')
		.replace(/\\t/g, '\t');
}

function extractPicturePageImages(html: string): string[] {
	const markers = ['window.picture_page_info_list', 'picture_page_info_list'];
	for (const marker of markers) {
		const block = extractBalancedArray(html, marker);
		if (!block) continue;
		const urls = collectMmbizCdnUrls(block);
		if (urls.length > 0) return urls;
	}
	return [];
}

/** 从 marker 后第一个 [ 起做括号配对，截取完整数组文本 */
function extractBalancedArray(html: string, marker: string): string | null {
	const startIdx = html.indexOf(marker);
	if (startIdx < 0) return null;
	let i = startIdx + marker.length;
	while (i < html.length && html[i] !== '[') i++;
	if (i >= html.length) return null;

	let depth = 0;
	const begin = i;
	for (; i < html.length; i++) {
		const ch = html[i];
		if (ch === '[') depth++;
		else if (ch === ']') {
			depth--;
			if (depth === 0) return html.slice(begin, i + 1);
		}
	}
	return null;
}

function collectMmbizCdnUrls(block: string): string[] {
	const urls: string[] = [];
	for (const m of block.matchAll(/cdn_url\s*:\s*['"]([^'"]+)['"]/g)) {
		const url = normalizeMediaUrl(decodeJsString(m[1] || ''));
		if (url && /mmbiz\.qpic\.cn/i.test(url)) urls.push(url);
	}
	return dedupeImageUrls(urls);
}

export interface WechatVideoAsset {
	url: string;
	title?: string;
	videoId?: string;
	/** 备选清晰度 URL（下载失败时依次尝试） */
	altUrls?: string[];
}

/** 从页面脚本与正文中提取公众号视频 */
export function extractWechatVideos(html: string, contentHtml = ''): WechatVideoAsset[] {
	const fromInfos = extractVideosFromPageInfos(html);
	if (fromInfos.length > 0) return fromInfos;

	const urls: string[] = [];
	for (const m of html.matchAll(
		/url\s*:\s*\(?\s*['"](https?:\/\/mpvideo\.qpic\.cn\/[^'"]+\.mp4[^'"]*)['"]/gi,
	)) {
		urls.push(normalizeMediaUrl(decodeJsString(m[1] || '')));
	}
	const mediaHtml = contentHtml || html;
	for (const m of mediaHtml.matchAll(
		/<(?:video|iframe)[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/gi,
	)) {
		const url = normalizeMediaUrl(decodeJsString(m[1] || ''));
		if (url && (url.includes('.mp4') || url.includes('mpvideo'))) urls.push(url);
	}
	return pickBestMp4Assets(urls.filter(Boolean));
}

function extractVideosFromPageInfos(html: string): WechatVideoAsset[] {
	const block =
		extractBalancedArray(html, 'videoPageInfos') ||
		extractBalancedArray(html, 'window.videoPageInfos');
	if (!block) return [];

	const assets: WechatVideoAsset[] = [];
	// 按 video_id 切分条目（粗粒度）
	const parts = block.split(/video_id\s*:/);
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i] || '';
		const videoId = matchGroup(part, /^\s*'([^']+)'/) || matchGroup(part, /^\s*"([^"]+)"/);
		const title =
			matchGroup(part, /content_noencode\s*:\s*'((?:\\'|[^'])*)'/) ||
			matchGroup(part, /content_noencode\s*:\s*"((?:\\"|[^"])*)"/) ||
			undefined;
		const urls: { url: string; formatId: number; filesize: number }[] = [];
		for (const m of part.matchAll(
			/filesize\s*:\s*'(\d+)'[\s\S]{0,160}?format_id\s*:\s*'(\d+)'[\s\S]{0,240}?url\s*:\s*\(?\s*'([^']+\.mp4[^']*)'/gi,
		)) {
			urls.push({
				filesize: Number(m[1]),
				formatId: Number(m[2]),
				url: normalizeMediaUrl(decodeJsString(m[3] || '')),
			});
		}
		// 兼容字段顺序不同：url 在前
		if (urls.length === 0) {
			for (const m of part.matchAll(
				/url\s*:\s*\(?\s*['"](https?:\/\/mpvideo\.qpic\.cn\/[^'"]+\.mp4[^'"]*)['"]/gi,
			)) {
				urls.push({
					formatId: guessFormatId(m[1] || ''),
					filesize: 0,
					url: normalizeMediaUrl(decodeJsString(m[1] || '')),
				});
			}
		}
		if (urls.length === 0) continue;
		const ranked = rankVideoUrls(urls);
		const best = ranked[0];
		if (!best?.url) continue;
		assets.push({
			url: best.url,
			title: title ? decodeJsString(title).trim() : undefined,
			videoId: videoId || undefined,
			altUrls: ranked.slice(1).map((u) => u.url),
		});
	}
	return assets;
}

function guessFormatId(url: string): number {
	const m = url.match(/\.f(\d+)\.mp4/i);
	return m ? Number(m[1]) : 0;
}

/** 优先可选清晰度（约 1080p 以下、体积更小），超清 100MB+ 放到备选 */
function rankVideoUrls(
	urls: { url: string; formatId: number; filesize: number }[],
): { url: string; formatId: number; filesize: number }[] {
	const unique = new Map<string, { url: string; formatId: number; filesize: number }>();
	for (const u of urls) {
		if (!u.url) continue;
		const key = (u.url.split('?')[0] || u.url).replace(/\.f\d+\.mp4/i, '');
		const prev = unique.get(key + u.formatId);
		if (!prev) unique.set(key + String(u.formatId), u);
	}
	return [...unique.values()].sort((a, b) => {
		const aHuge = a.filesize > 80_000_000 ? 1 : 0;
		const bHuge = b.filesize > 80_000_000 ? 1 : 0;
		if (aHuge !== bHuge) return aHuge - bHuge;
		// 偏好 10104 / 10004 一类中等清晰度
		const aMid = a.formatId === 10104 || a.formatId === 10004 ? 1 : 0;
		const bMid = b.formatId === 10104 || b.formatId === 10004 ? 1 : 0;
		if (aMid !== bMid) return bMid - aMid;
		if (a.filesize > 0 && b.filesize > 0) return a.filesize - b.filesize;
		return b.formatId - a.formatId;
	});
}

function pickBestMp4Assets(urls: string[]): WechatVideoAsset[] {
	const groups = new Map<string, { url: string; quality: number; alts: string[] }>();
	for (const rawUrl of urls) {
		if (!rawUrl) continue;
		const withoutQuery = rawUrl.split('?')[0] ?? rawUrl;
		const qualityMatch = withoutQuery.match(/\.f(\d+)\.mp4$/i);
		const groupKey = withoutQuery.replace(/\.f\d+\.mp4$/i, '') || withoutQuery;
		const quality = qualityMatch ? Number(qualityMatch[1]) : 0;
		const prev = groups.get(groupKey);
		if (!prev) {
			groups.set(groupKey, { url: rawUrl, quality, alts: [] });
		} else if (quality > prev.quality) {
			prev.alts.push(prev.url);
			prev.url = rawUrl;
			prev.quality = quality;
		} else {
			prev.alts.push(rawUrl);
		}
	}
	return [...groups.values()].map((v) => ({
		url: v.url,
		altUrls: v.alts,
	}));
}

function extractImagesFromHtml(html: string): string[] {
	if (!html) return [];
	const urls: string[] = [];
	const imgRegex = /<img[^>]+>/gi;
	for (const tag of html.match(imgRegex) || []) {
		const src =
			matchAttr(tag, 'data-src') ||
			matchAttr(tag, 'src') ||
			matchAttr(tag, 'data-original');
		const url = normalizeImageUrl(src || '');
		if (url && !isPlaceholderImage(url)) urls.push(url);
	}
	return urls;
}

function matchAttr(tag: string, name: string): string | undefined {
	const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
	return m?.[1];
}

function isPlaceholderImage(url: string): boolean {
	return /^data:image/i.test(url) || url.length < 24;
}

function normalizeImageUrl(url: string): string {
	return normalizeMediaUrl(url);
}

function normalizeMediaUrl(url: string): string {
	if (!url?.trim()) return '';
	let normalized = decodeHtml(decodeJsString(url.trim()));
	if (normalized.startsWith('//')) normalized = `https:${normalized}`;
	// 微信视频 CDN 在 Obsidian 内用 http 常失败，统一升到 https
	if (normalized.startsWith('http://')) {
		normalized = `https://${normalized.slice('http://'.length)}`;
	}
	normalized = normalized.replace(/&amp;/g, '&');
	return normalized;
}

function dedupeImageUrls(urls: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const url of urls) {
		const key = imageDedupeKey(url);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		result.push(url);
	}
	return result;
}

function imageDedupeKey(url: string): string {
	try {
		const u = new URL(url);
		return u.pathname;
	} catch {
		return url.split('?')[0] || url;
	}
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

function formatVideoEmbed(asset: WechatVideoAsset, withTitle = false): string {
	const titleLine = withTitle && asset.title ? `**${asset.title}**\n\n` : '';
	const altAttr =
		asset.altUrls && asset.altUrls.length > 0
			? ` data-vb-alts="${asset.altUrls.map((u) => u.replace(/"/g, '')).join(' ')}"`
			: '';
	return `${titleLine}<video controls width="100%" src="${asset.url}"${altAttr}></video>`;
}

function convertContentHtml(
	html: string,
	videoById: Map<string, WechatVideoAsset> = new Map(),
	usedVideoIds: Set<string> = new Set(),
): string {
	if (!html) return '';
	let text = html;
	text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
	text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

	// 在原位置替换公众号视频 iframe（必须早于通用去标签）
	text = text.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (tag) => {
		const id = matchAttr(tag, 'data-mpvid') || matchAttr(tag, 'data-vid');
		if (!id) return '\n\n';
		const asset = videoById.get(id);
		if (asset) {
			usedVideoIds.add(id);
			return `\n\n${formatVideoEmbed(asset, false)}\n\n`;
		}
		usedVideoIds.add(id);
		return `\n\n[视频:${id}]\n\n`;
	});
	text = text.replace(/<iframe\b[^>]*\/?>/gi, (tag) => {
		const id = matchAttr(tag, 'data-mpvid') || matchAttr(tag, 'data-vid');
		if (!id) return '\n\n';
		if (usedVideoIds.has(id)) return '\n\n';
		const asset = videoById.get(id);
		if (asset) {
			usedVideoIds.add(id);
			return `\n\n${formatVideoEmbed(asset, false)}\n\n`;
		}
		usedVideoIds.add(id);
		return `\n\n[视频:${id}]\n\n`;
	});

	text = text.replace(/<br\s*\/?>/gi, '\n');
	text = text.replace(/<\/p>/gi, '\n\n');
	text = text.replace(/<\/div>/gi, '\n');
	text = text.replace(/<\/h([1-6])>/gi, '\n\n');
	text = text.replace(/<h([1-6])[^>]*>/gi, (_, level) => `${'#'.repeat(Number(level))} `);
	text = text.replace(/<img[^>]*data-src=["']([^"']+)["'][^>]*>/gi, (_m, src) => `![](${normalizeImageUrl(src)})\n\n`);
	text = text.replace(/<img[^>]*data-original=["']([^"']+)["'][^>]*>/gi, (_m, src) => `![](${normalizeImageUrl(src)})\n\n`);
	text = text.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, src) => {
		if (isPlaceholderImage(src)) return '';
		return `![](${normalizeImageUrl(src)})\n\n`;
	});
	text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
		const clean = label.replace(/<[^>]+>/g, '').trim();
		return `[${clean || href}](${href})`;
	});
	text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
	text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
	// 保留已插入的 <video> 标签，去掉其余 HTML
	const videoHolders: string[] = [];
	text = text.replace(/<video\b[\s\S]*?<\/video>/gi, (block) => {
		const token = `%%VBVIDEO${videoHolders.length}%%`;
		videoHolders.push(block);
		return token;
	});
	text = text.replace(/<[^>]+>/g, '');
	text = decodeHtml(text);
	videoHolders.forEach((block, i) => {
		text = text.replace(`%%VBVIDEO${i}%%`, block);
	});
	text = text.replace(/\n{3,}/g, '\n\n').trim();
	return text;
}
