/**
 * 修复笔记中带空格的相对图片路径 → Obsidian 维基链接 ![[库根路径]]
 */
import fs from 'fs';
import path from 'path';

const root = 'F:/ObsidianVault/MyKnowledge-1';

function walk(d, acc = []) {
	for (const n of fs.readdirSync(d)) {
		const p = path.join(d, n);
		const st = fs.statSync(p);
		if (st.isDirectory()) {
			if (['.obsidian', 'node_modules'].includes(n)) continue;
			walk(p, acc);
		} else if (
			n.endsWith('.md') &&
			(p.includes('腾讯云') || p.includes('阿里云') || p.includes('小红书'))
		) {
			acc.push(p);
		}
	}
	return acc;
}

function toVaultWikiPath(linkPath) {
	let p = (linkPath || '').trim().replace(/\\/g, '/');
	// 去掉相对前缀 ../
	while (p.startsWith('../')) p = p.slice(3);
	while (p.startsWith('./')) p = p.slice(2);
	p = p.replace(/^\/+/, '');
	return p;
}

let fixedFiles = 0;
let fixedLinks = 0;

for (const file of walk(root)) {
	const raw = fs.readFileSync(file, 'utf8');
	let count = 0;
	const next = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, link) => {
		const href = (link || '').trim();
		// 只修本地相对/媒体目录链接，跳过 http
		if (/^https?:\/\//i.test(href)) return full;
		if (
			!/(腾讯云媒体|阿里云媒体|小红书媒体|微信公众号媒体)/.test(href) &&
			!href.includes('../')
		) {
			return full;
		}
		const vaultPath = toVaultWikiPath(href);
		if (!vaultPath) return full;
		count += 1;
		return `\n![[${vaultPath}]]\n`;
	});
	if (count > 0 && next !== raw) {
		fs.writeFileSync(file, next, 'utf8');
		fixedFiles += 1;
		fixedLinks += count;
		console.log('fixed', path.relative(root, file), count);
	}
}

console.log(`done files=${fixedFiles} links=${fixedLinks}`);
