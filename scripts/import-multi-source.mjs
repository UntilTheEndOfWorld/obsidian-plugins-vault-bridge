/**
 * 一次性导入脚本：腾讯云文章 + 小红书笔记 → MyKnowledge-1
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const VAULT = 'F:\\ObsidianVault\\MyKnowledge-1';
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sanitizeFileName(value) {
	return value
		.replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
}

function forceHttps(url) {
	if (!url) return '';
	if (url.startsWith('//')) return 'https:' + url;
	if (url.startsWith('http://')) return 'https://' + url.slice(7);
	return url;
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
						reject(new Error(`HTTP ${res.statusCode} ${url}`));
						return;
					}
					resolve(buf.toString('utf8'));
				});
			},
		);
		req.on('error', reject);
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('timeout'));
		});
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
		req.on('timeout', () => {
			req.destroy();
			reject(new Error('timeout'));
		});
	});
}

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function draftJsToMarkdown(blocks, entityMap) {
	const lines = [];
	let listBuffer = [];
	let listKind = null;
	let codeBuffer = [];
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
	const styleToken = (style) => {
		const s = (style || '').toUpperCase();
		if (s === 'BOLD') return '**';
		if (s === 'ITALIC') return '*';
		if (s === 'CODE') return '`';
		return '';
	};
	const applyStyles = (text, styles) => {
		if (!text || !styles?.length) return text;
		const marks = [];
		let pri = 0;
		for (const s of styles) {
			const token = styleToken(s.style);
			if (!token) continue;
			marks.push({ i: s.offset, open: true, token, pri: pri++ });
			marks.push({ i: s.offset + s.length, open: false, token, pri: pri++ });
		}
		marks.sort((a, b) => (a.i !== b.i ? a.i - b.i : a.open !== b.open ? (a.open ? 1 : -1) : b.pri - a.pri));
		let out = '';
		let prev = 0;
		for (const m of marks) {
			out += text.slice(prev, m.i) + m.token;
			prev = m.i;
		}
		return out + text.slice(prev);
	};
	const shiftStyles = (styles, start, end) => {
		const out = [];
		for (const s of styles || []) {
			const sEnd = s.offset + s.length;
			if (sEnd <= start || s.offset >= end) continue;
			const ns = Math.max(s.offset, start);
			const ne = Math.min(sEnd, end);
			out.push({ offset: ns - start, length: ne - ns, style: s.style });
		}
		return out;
	};
	const withLinks = (text, styles, entityRanges) => {
		const links = (entityRanges || [])
			.filter((r) => (entityMap[String(r.key)]?.type || '').toUpperCase() === 'LINK')
			.sort((a, b) => a.offset - b.offset);
		if (!links.length) return applyStyles(text, styles);
		const parts = [];
		let cursor = 0;
		for (const r of links) {
			if (r.offset > cursor) {
				parts.push(applyStyles(text.slice(cursor, r.offset), shiftStyles(styles, cursor, r.offset)));
			}
			const ent = entityMap[String(r.key)];
			const href = ent?.data?.url || ent?.data?.href || '';
			const label = applyStyles(text.slice(r.offset, r.offset + r.length), shiftStyles(styles, r.offset, r.offset + r.length));
			parts.push(`[${label}](${href})`);
			cursor = r.offset + r.length;
		}
		if (cursor < text.length) parts.push(applyStyles(text.slice(cursor), shiftStyles(styles, cursor, text.length)));
		return parts.join('');
	};

	for (const block of blocks) {
		const type = block.type || 'unstyled';
		if (type !== 'code-block') flushCode();
		if (type !== 'ordered-list-item' && type !== 'unordered-list-item') flushList();
		if (type === 'code-block') {
			codeBuffer.push(block.text || '');
			continue;
		}
		// atomic / media
		let atomic = null;
		for (const r of block.entityRanges || []) {
			const ent = entityMap[String(r.key)];
			if (!ent) continue;
			const t = (ent.type || '').toUpperCase();
			const d = ent.data || {};
			if (t === 'IMAGE' || t === 'IMG') {
				const url = forceHttps(d.imageUrl || d.url || d.src || '');
				if (url) atomic = `![](${url})`;
			} else if (t.includes('VIDEO')) {
				const url = forceHttps(d.videoUrl || d.url || d.src || '');
				if (url) atomic = `<video controls width="100%" src="${url}"></video>`;
			}
		}
		if (block.type === 'atomic' || atomic) {
			if (atomic) lines.push(atomic);
			continue;
		}
		const text = withLinks(block.text || '', block.inlineStyleRanges || [], block.entityRanges || []);
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

async function localizeMedia(markdown, articleFolder, mediaRoot, titleBase, referer) {
	ensureDir(path.join(VAULT, mediaRoot, titleBase));
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

function formatMd(article) {
	const fm = [
		'---',
		`source_url: ${JSON.stringify(article.sourceUrl)}`,
		`title: ${JSON.stringify(article.title)}`,
		`source: ${JSON.stringify(article.source)}`,
		article.account ? `account: ${JSON.stringify(article.account)}` : null,
		article.author ? `author: ${JSON.stringify(article.author)}` : null,
		article.publishedAt ? `published_at: ${JSON.stringify(article.publishedAt)}` : null,
		`saved_at: ${JSON.stringify(new Date().toISOString())}`,
		`sync_id: ${JSON.stringify(article.id)}`,
		`parse_status: ${JSON.stringify(article.parseStatus || 'ok')}`,
		article.parseError ? `parse_error: ${JSON.stringify(article.parseError)}` : null,
		'---',
	].filter(Boolean);
	return `${fm.join('\n')}\n\n# ${article.title}\n\n${article.markdown.trim()}\n`;
}

async function importTencent() {
	const url =
		'https://cloud.tencent.com/developer/article/2515745?from=15425&frompage=seopage&policyId=20240000&traceId=01jtq974f9pjvb77ts4she09ke';
	console.log('Fetching Tencent article...');
	const html = await fetchText(url, { Referer: 'https://cloud.tencent.com/' });
	const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
	if (!m) throw new Error('no __NEXT_DATA__');
	const data = JSON.parse(m[1]);
	const fb = data.props.pageProps.fallback;
	const key = Object.keys(fb).find((k) => k.includes('/api/article/detail')) || Object.keys(fb)[0];
	const detail = fb[key];
	const info = detail.articleInfo;
	const author = detail.authorInfo?.nickname || '';
	const title = info.title;
	const markdown = draftJsToMarkdown(info.content.blocks, info.content.entityMap || {});
	const publishedAt = detail.publishTime
		? new Date(detail.publishTime * 1000).toISOString()
		: undefined;

	const archive = '腾讯云开发者社区';
	const mediaRoot = '腾讯云媒体';
	const titleBase = sanitizeFileName(title).slice(0, 60);
	ensureDir(path.join(VAULT, archive));
	let body = markdown;
	body = await localizeMedia(body, archive, mediaRoot, titleBase, 'https://cloud.tencent.com/');
	const article = {
		id: `local_tencent_${info.articleId}`,
		title,
		author,
		account: '腾讯云开发者社区',
		sourceUrl: url.split('?')[0],
		source: 'tencent_cloud',
		markdown: body,
		publishedAt,
		parseStatus: 'ok',
	};
	const outPath = path.join(VAULT, archive, `${sanitizeFileName(title)}.md`);
	fs.writeFileSync(outPath, formatMd(article), 'utf8');
	console.log('Wrote', outPath, 'mdLen=', body.length);
}

async function importXhsFromBrowserData() {
	// 浏览器已验证的第一条笔记数据
	const notes = [
		{
			shareText: '怀念飞天遁地的时刻 http://xhslink.cn/o/3JpcpZVMDBg',
			shortUrl: 'http://xhslink.cn/o/3JpcpZVMDBg',
			finalUrl:
				'https://www.xiaohongshu.com/explore/6a1813f40000000008025a9c?xsec_token=CBB0EB1LPSeywYbZPHcFCJ6v-Fd-47pZP3hZpm-WNEOM4%3D',
			title: '怀念飞天遁地的时刻',
			author: '陪你翱翔直到世界尽头',
			desc: '#飞就完事儿了',
			images: [
				'https://sns-webpic-qc.xhscdn.com/202607281636/5130e4fd28f39ab158342897cf619d23/notes_pre_post/1040g3k0320n6l6f96e605nhvd9v0885vjnmq988!nd_dft_wlteh_webp_3',
				'https://sns-webpic-qc.xhscdn.com/202607281636/47118976e4082220c9d1f1ae2f65cced/notes_pre_post/1040g3k0320n6l6f96e6g5nhvd9v0885vjjl59l0!nd_dft_wlteh_webp_3',
			],
		},
		{
			shareText: '近期，国家给深陷网贷泥潭的人，开了一扇窗 http://xhslink.cn/o/3k1uRiOCXkc',
			shortUrl: 'http://xhslink.cn/o/3k1uRiOCXkc',
			finalUrl:
				'https://www.xiaohongshu.com/explore/6a673065000000000100e2a2?xsec_token=CB2ynuM39W5G6KIK-Dty4jUKcEvxPFPKt-ieV_5gLnFoQ%3D',
			title: '近期，国家给深陷网贷泥潭的人，开了一扇窗',
			author: '银渠熊戴维',
			desc: '正在被网贷催收困扰的小伙伴可以对照新规自查，说说你目前最大的还款难题是什么?有没有尝试过和平台协商调整方案?\n\n#网贷新规 #个人征信科普 #协商还款 #普通人理财 #金融知识 #知识科普 #政策 #征信知识分享 #贷款',
			images: [
				'https://sns-webpic-qc.xhscdn.com/202607281641/5c754e17fc026f9e21684e6c02fd43a9/1040g0083234eo9vs7u005q65n4v6bnouc064l30!nd_prv_wlteh_webp_3',
				'https://sns-webpic-qc.xhscdn.com/202607281641/fa899ea401efd26490a92b04de1899f6/1040g0083234eo9vs7u0g5q65n4v6bnoujddolko!nd_prv_wlteh_webp_3',
				'https://sns-webpic-qc.xhscdn.com/202607281641/d435d76b669cfbd4a09d27f0fe523044/1040g0083234eo9vs7u105q65n4v6bnou0uos608!nd_prv_wlteh_webp_3',
				'https://sns-webpic-qc.xhscdn.com/202607281641/c11bb80cac97f69378be784ed80b342a/1040g0083234eo9vs7u1g5q65n4v6bnou0rntni0!nd_prv_wlteh_webp_3',
				'https://sns-webpic-qc.xhscdn.com/202607281641/1d852e5e96e5d86816c070253c069c84/1040g0083234eo9vs7u205q65n4v6bnouligs7e0!nd_prv_wlteh_webp_3',
			],
		},
	];

	const archive = '小红书';
	const mediaRoot = '小红书媒体';
	ensureDir(path.join(VAULT, archive));

	for (const note of notes) {
		const titleBase = sanitizeFileName(note.title).slice(0, 60);
		let mdParts = [];
		if (note.desc) mdParts.push(note.desc);
		for (const img of note.images) mdParts.push(`![](${img})`);
		mdParts.push(`[打开小红书原文](${note.finalUrl || note.shortUrl})`);
		mdParts.push(`\n短链：${note.shortUrl}`);
		let body = mdParts.join('\n\n');
		if (note.images.length) {
			body = await localizeMedia(body, archive, mediaRoot, titleBase, 'https://www.xiaohongshu.com/');
		}
		const article = {
			id: `local_xhs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			title: note.title,
			author: note.author,
			account: '小红书',
			sourceUrl: note.finalUrl || note.shortUrl,
			source: 'xiaohongshu',
			markdown: body,
			parseStatus: note.images.length ? 'ok' : 'partial',
			parseError: note.images.length
				? undefined
				: '小红书反爬/登录墙，未能拉取完整媒体；已保存分享文案与短链',
		};
		const outPath = path.join(VAULT, archive, `${sanitizeFileName(note.title)}.md`);
		fs.writeFileSync(outPath, formatMd(article), 'utf8');
		console.log('Wrote', outPath);
	}
}

async function main() {
	await importTencent();
	await importXhsFromBrowserData();
	console.log('done');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
