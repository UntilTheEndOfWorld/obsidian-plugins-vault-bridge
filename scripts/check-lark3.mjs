import fs from 'fs';
const html = fs.readFileSync(process.env.TEMP + '/aliyun-article.html', 'utf8');
for (const key of ['doctype lake', 'Apache Dubbo', 'Dubbo环境搭建', 'zkServer']) {
  const i = html.indexOf(key);
  console.log('\n', key, 'idx', i);
  if (i >= 0) console.log(html.slice(Math.max(0, i - 100), i + 200).replace(/\s+/g, ' '));
}

// Find all script tags with substantial content mentioning lake or Dubbo
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
for (let i = 0; i < scripts.length; i++) {
  const body = scripts[i][1] || '';
  if (body.includes('doctype lake') || body.includes('Apache Dubbo') || body.includes('lark')) {
    console.log('\nscript', i, 'len', body.length, 'starts', body.slice(0, 120).replace(/\s+/g, ' '));
  }
}

// meta description?
const desc = html.match(/name="description"[^>]*content="([^"]*)"/i) || html.match(/content="([^"]*)"[^>]*name="description"/i);
console.log('\ndesc', desc && desc[1]?.slice(0, 200));
const ogd = html.match(/property="og:description"[^>]*content="([^"]*)"/i);
console.log('ogdesc', ogd && ogd[1]?.slice(0, 200));
