import fs from 'fs';
import https from 'https';
import http from 'http';

const url = 'https://developer.aliyun.com/article/1101253';
const out = process.env.TEMP + '/aliyun-article.html';

function fetchText(u, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(u);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      parsed,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://developer.aliyun.com/',
          Accept: 'text/html,application/xhtml+xml',
          ...headers,
        },
        timeout: 60000,
      },
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
            reject(new Error('HTTP ' + res.statusCode));
            return;
          }
          resolve(buf.toString('utf8'));
        });
      },
    );
    req.on('error', reject);
  });
}

const html = await fetchText(url);
fs.writeFileSync(out, html);
console.log('len', html.length);
const checks = [
  '__NEXT_DATA__',
  'og:title',
  'article-content',
  'markdown-body',
  'content-detail',
  'mp4',
  'video',
  'window.__INITIAL',
  'aliyun',
  'ace-line',
  'prettyprint',
  'article-detail',
  'rich-text',
  'data-spm',
];
for (const c of checks) {
  console.log(c, (html.match(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length);
}
const t = html.match(/<title[^>]*>([^<]+)/i);
console.log('title', t && t[1]);
const og = html.match(/property="og:title"[^>]*content="([^"]+)/i) || html.match(/content="([^"]+)"[^>]*property="og:title"/i);
console.log('og', og && og[1]);
const next = html.indexOf('__NEXT_DATA__');
console.log('NEXT idx', next);
if (next > 0) console.log(html.slice(next, next + 400));
// find main content class candidates
for (const m of html.matchAll(/class="([^"]*(?:article|content|markdown|detail)[^"]*)"/gi)) {
  if (m[1].length < 80) console.log('class', m[1]);
}
