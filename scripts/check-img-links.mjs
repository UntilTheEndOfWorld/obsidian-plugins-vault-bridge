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

const files = walk(root);
console.log('files:', files.length);
for (const f of files) {
	console.log('FILE', path.relative(root, f));
	const t = fs.readFileSync(f, 'utf8');
	const m = t.match(/!\[[^\]]*\]\(([^)]+)\)/);
	if (m) console.log('  MDIMG', m[1].slice(0, 200));
	const imgs = [...t.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
	console.log('  md image count', imgs.length);
}

// list media dirs
for (const d of ['腾讯云媒体', '阿里云媒体', '小红书媒体']) {
	const p = path.join(root, d);
	if (!fs.existsSync(p)) {
		console.log('MISSING media root', d);
		continue;
	}
	console.log('MEDIA', d, fs.readdirSync(p));
}
