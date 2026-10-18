import fs from 'fs';
const html = fs.readFileSync(process.env.TEMP + '/aliyun-article.html', 'utf8');
const idx = html.indexOf('larkContent');
console.log('idx', idx);
console.log(html.slice(idx, idx + 500));
console.log('---');
// maybe it's split or HTML-escaped
const idx2 = html.indexOf('"larkContent"');
const idx3 = html.indexOf("'larkContent'");
console.log('dq', idx2, 'sq', idx3);
console.log(html.slice(Math.max(0, idx - 50), idx + 200));

// Find doctype lake
console.log('doctype lake', html.includes('doctype lake'));
console.log('Dubbo入门学习 in html', html.includes('Dubbo入门学习'));
console.log('Apache Dubbo', html.includes('Apache Dubbo'));
console.log('ucc.alicdn.com/pic', (html.match(/ucc\.alicdn\.com\/pic/g) || []).length);
