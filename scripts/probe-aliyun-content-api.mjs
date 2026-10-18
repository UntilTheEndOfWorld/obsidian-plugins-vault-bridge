import fs from 'fs';
import https from 'https';
import http from 'http';

function fetchText(u) {
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
          Accept: '*/*',
        },
        timeout: 60000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
  });
}

const apis = [
  'https://developer.aliyun.com/developer/api/article/getRightComponentHtml?articleId=1101253',
  'https://developer.aliyun.com/developer/api/article/getArticleContent?articleId=1101253',
  'https://developer.aliyun.com/developer/api/article/content?articleId=1101253',
  'https://developer.aliyun.com/developer/api/article/detail?articleId=1101253',
  'https://developer.aliyun.com/developer/api/article/getDetail?articleId=1101253',
  'https://developer.aliyun.com/developer/api/v1/article/get?articleId=1101253',
  'https://developer.aliyun.com/developer/api/article/1101253',
];

for (const api of apis) {
  try {
    const r = await fetchText(api);
    console.log('\n', api, r.status, r.text.length);
    console.log(r.text.slice(0, 300).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(api, e.message);
  }
}

// Download articleDetail.js and search for api paths
const jsUrl = 'https://g.alicdn.com/aliyun/developer-aliyun-com-fe/2.8.59/scripts/articleDetail.js';
const js = await fetchText(jsUrl);
fs.writeFileSync(process.env.TEMP + '/aliyun-articleDetail.js', js.text);
const paths = [...js.text.matchAll(/[\"'`](\/developer\/api\/[^\"'`]+)[\"'`]/g)].map((m) => m[1]);
console.log('\nAPI paths in articleDetail.js:');
console.log([...new Set(paths)].join('\n'));
const keywords = [...js.text.matchAll(/article[A-Za-z]*|getContent|lark|yuque|markdown/g)].map((m) => m[0]);
console.log('keyword sample', [...new Set(keywords)].slice(0, 40));
