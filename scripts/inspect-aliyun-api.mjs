import fs from 'fs';
import https from 'https';
import http from 'http';

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
          Referer: 'https://developer.aliyun.com/article/1101253',
          Accept: 'application/json,text/plain,*/*',
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
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
  });
}

const html = fs.readFileSync(process.env.TEMP + '/aliyun-article.html', 'utf8');

// find API-like strings
const urls = [...html.matchAll(/https?:\/\/[^"'\\\s]+/g)].map((m) => m[0]);
const interesting = urls.filter((u) => /api|article|content|lark|yq|developer/i.test(u));
console.log('interesting urls sample');
for (const u of [...new Set(interesting)].slice(0, 40)) console.log(u);

// search for articleDetail context
const i = html.indexOf('articleDetail');
console.log('\narticleDetail context:', html.slice(Math.max(0, i - 100), i + 300));

const apis = [
  'https://developer.aliyun.com/developer/api/article/get?articleId=1101253',
  'https://developer.aliyun.com/developer/api/getArticle?articleId=1101253',
  'https://developer.aliyun.com/api/v1/article/1101253',
  'https://developer.aliyun.com/article/api/get?id=1101253',
  'https://yq.aliyun.com/articles/api/get?id=1101253',
  'https://developer.aliyun.com/developer/api/articleDetail?articleId=1101253',
  'https://developer.aliyun.com/developer/api/v1/article/detail?articleId=1101253',
];

for (const api of apis) {
  try {
    const r = await fetchText(api);
    console.log('\nAPI', api, 'status', r.status, 'len', r.text.length, 'sample', r.text.slice(0, 180).replace(/\s+/g, ' '));
  } catch (e) {
    console.log('\nAPI fail', api, e.message);
  }
}
