/**
 * 导入阿里云开发者社区文章 → MyKnowledge-1/阿里云开发者社区
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const VAULT = 'F:\\ObsidianVault\\MyKnowledge-1';
const ARTICLE_URL =
	'https://developer.aliyun.com/article/1101253?spm=a2c6h.12873639.article-detail.45.3d814f9fvcYlkL&scm=20140722.ID_community@@article@@1101253._.ID_community@@article@@1101253-OR_rec-V_1-RL_community@@article@@935614';
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function forceHttps(url) {
	if (!url) return '';
	if (url.startsWith('//')) return 'https:' + url;
	if (url.startsWith('http://')) return 'https://' + url.slice(7);
	return url;
}

function sanitizeFileName(value) {
	return value
		.replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
}

function fetchText(url, headers = {}) {
	return new Promise((resolve, reject) => {
		const u = new URL(forceHttps(url));
		const lib = u.protocol === 'https:' ? https : http;
		const req = lib.get(
			u,
			{ headers: { 'User-Agent': UA, ...headers }, timeout: 60000 },
			(res) => {
				if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					res.resume();
					fetchText(res.headers.location, headers).then(resolve, reject);
					return;
				}
				const chunks = [];
				res.on('data', (c) => chunks.push(c));
				res.on('end', () => {
					const buf = Buffer.concat(chunks);
					if (res.statusCode < 200 || res.statusCode >= 300) {
						reject(new Error(`HTTP ${res.statusCode}`));
						return;
					}
					resolve(buf.toString('utf8'));
				});
			},
		);
		req.on('error', reject);
	});
}

function fetchBinary(url, headers = {}) {
	return new Promise((resolve, reject) => {
		const u = new URL(forceHttps(url));
		const lib = u.protocol === 'https:' ? https : http;
		const req = lib.get(
			u,
			{ headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, timeout: 120000 },
			(res) => {
				if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					res.resume();
					fetchBinary(res.headers.location, headers).then(resolve, reject);
					return;
				}
				const chunks = [];
				res.on('data', (c) => chunks.push(c));
				res.on('end', () => {
					const buf = Buffer.concat(chunks);
					if (res.statusCode < 200 || res.statusCode >= 300) {
						reject(new Error(`HTTP ${res.statusCode}`));
						return;
					}
					resolve(buf);
				});
			},
		);
		req.on('error', reject);
	});
}

function decodeJsString(input) {
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

function decodeHtml(input) {
	return input
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function matchGroup(text, re) {
	const m = text.match(re);
	return m?.[1];
}

function matchAttr(tag, name) {
	const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
	return m?.[1];
}

function parseLakeCardValue(value) {
	if (!value) return null;
	let raw = value.trim();
	if (raw.startsWith('data:')) raw = raw.slice(5);
	try {
		return JSON.parse(decodeURIComponent(raw));
	} catch {
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}
}

function convertGenericHtml(html) {
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
		const url = forceHttps(src);
		return url ? `![](${url})\n\n` : '';
	});
	text = text.replace(/<(?:video|source)[^>]*(?:src)=["']([^"']+)["'][^>]*>/gi, (_m, src) => {
		const url = forceHttps(src);
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

function lakeHtmlToMarkdown(html) {
	let text = html;
	text = text.replace(/<!doctype lake>/i, '');
	text = text.replace(/<meta[^>]*>/gi, '');
	text = text.replace(/<card\b([^>]*)>(?:<\/card>)?/gi, (_m, attrs) => {
		const name = matchAttr(attrs, 'name') || '';
		const value = matchAttr(attrs, 'value') || '';
		const data = parseLakeCardValue(value);
		if (!data) return '\n\n';
		if (/^image$/i.test(name)) {
			const src = forceHttps(String(data.src || data.url || ''));
			return src ? `\n\n![](${src})\n\n` : '\n\n';
		}
		if (/^video$/i.test(name)) {
			const src = forceHttps(String(data.src || data.url || data.videoUrl || ''));
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

function extractLarkContent(html) {
	const assign =
		html.match(/GLOBAL_CONFIG\.larkContent\s*=\s*'((?:\\'|[^'])*)'/) ||
		html.match(/GLOBAL_CONFIG\.larkContent\s*=\s*"((?:\\"|[^"])*)"/);
	if (assign?.[1]) return decodeJsString(assign[1]);
	return '';
}

async function localizeMedia(markdown, articleFolder, mediaRoot, titleBase, referer) {
	fs.mkdirSync(path.join(VAULT, mediaRoot, titleBase), { recursive: true });
	let result = markdown;
	const hits = [];
	for (const m of markdown.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)) {
		hits.push({ kind: 'image', full: m[0], alt: m[1] || '', url: m[2], index: m.index });
	}
	for (const m of markdown.matchAll(/<video\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>\s*<\/video>/gi)) {
		hits.push({ kind: 'video', full: m[0], url: m[1], index: m.index });
	}
	hits.sort((a, b) => a.index - b.index);
	let seq = 0;
	for (const hit of hits) {
		seq += 1;
		const label = String(seq).padStart(2, '0');
		try {
			const buf = await fetchBinary(hit.url, { Referer: referer });
			if (!buf || buf.length < 64) {
				seq -= 1;
				continue;
			}
			let ext = '.jpg';
			const lower = hit.url.toLowerCase();
			if (hit.kind === 'video') ext = '.mp4';
			else if (lower.includes('.png')) ext = '.png';
			else if (lower.includes('.webp')) ext = '.webp';
			else if (lower.includes('.gif')) ext = '.gif';
			const fileName = `${titleBase}-${label}${ext}`;
			const vaultRel = `${mediaRoot}/${titleBase}/${fileName}`.replace(/\\/g, '/');
			fs.writeFileSync(path.join(VAULT, mediaRoot, titleBase, fileName), buf);
			if (hit.kind === 'image') {
				const fromParts = articleFolder.split('/').filter(Boolean);
				const ups = fromParts.map(() => '..').join('/');
				const rel = `${ups}/${vaultRel}`.replace(/\\/g, '/');
				result = result.replace(hit.full, `![${hit.alt}](${rel})`);
			} else {
				result = result.replace(hit.full, `\n![[${vaultRel}]]\n`);
			}
			console.log('  media', fileName, buf.length);
		} catch (e) {
			console.warn('  media fail', hit.url, e.message);
			seq -= 1;
		}
	}
	return result;
}

const html = await fetchText(ARTICLE_URL, { Referer: 'https://developer.aliyun.com/' });
const title =
	matchGroup(html, /class="article-title"[^>]*>([\s\S]*?)<\//i)?.replace(/<[^>]+>/g, '').trim() ||
	matchGroup(html, /property="og:title"\s+content="([^"]+)"/i)?.replace(/-阿里云.*$/, '').trim() ||
	'Dubbo的入门学习';
const author =
	matchGroup(html, /href="\/profile\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i)?.replace(/<[^>]+>/g, '').trim() ||
	'收破烂的小熊猫';
const timeText =
	matchGroup(html, /class="article-info-time"[^>]*>([\s\S]*?)<\//i)?.replace(/<[^>]+>/g, '').trim() ||
	'2022-12-05';
const lark = extractLarkContent(html);
if (!lark) throw new Error('no larkContent');
let markdown = lakeHtmlToMarkdown(lark);
console.log('title', title, 'author', author, 'mdLen', markdown.length);

const archive = '阿里云开发者社区';
const mediaRoot = '阿里云媒体';
const titleBase = sanitizeFileName(title).slice(0, 60);
fs.mkdirSync(path.join(VAULT, archive), { recursive: true });
markdown = await localizeMedia(markdown, archive, mediaRoot, titleBase, 'https://developer.aliyun.com/');

const publishedAt = (() => {
	const m = timeText.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
	if (!m) return undefined;
	return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString();
})();

const fm = [
	'---',
	`source_url: ${JSON.stringify(ARTICLE_URL.split('?')[0])}`,
	`title: ${JSON.stringify(title)}`,
	`source: "aliyun"`,
	`account: "阿里云开发者社区"`,
	`author: ${JSON.stringify(author)}`,
	publishedAt ? `published_at: ${JSON.stringify(publishedAt)}` : null,
	`saved_at: ${JSON.stringify(new Date().toISOString())}`,
	`sync_id: ${JSON.stringify('local_aliyun_1101253')}`,
	`parse_status: "ok"`,
	'---',
].filter(Boolean);

const outPath = path.join(VAULT, archive, `${sanitizeFileName(title)}.md`);
fs.writeFileSync(outPath, `${fm.join('\n')}\n\n# ${title}\n\n${markdown.trim()}\n`, 'utf8');
console.log('Wrote', outPath);
