import fs from 'fs';
import https from 'https';
import http from 'http';

function fetchText(u, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(u.startsWith('http') ? u : 'https:' + u);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(
      parsed,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://developer.aliyun.com/article/1101253',
          Accept: '*/*',
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
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
  });
}

const files = [
  'https://g.alicdn.com/aliyun/developer-aliyun-com-fe/2.8.59/scripts/articleDetail.js',
  'https://g.alicdn.com/aliyun/developer-aliyun-com-fe/2.8.59/scripts/yuqueDocViewer.js',
];

for (const f of files) {
  const r = await fetchText(f);
  const name = f.split('/').pop();
  fs.writeFileSync(process.env.TEMP + '/' + name, r.text);
  console.log('\n==', name, r.text.length);
  const paths = [...r.text.matchAll(/["'`](\/developer\/api\/[^"'`]+)["'`]/g)].map((m) => m[1]);
  console.log('api paths', [...new Set(paths)]);
  // find larkContent usages
  const idx = r.text.indexOf('larkContent');
  console.log('larkContent idx', idx);
  if (idx >= 0) console.log(r.text.slice(Math.max(0, idx - 200), idx + 400));
  const idx2 = r.text.indexOf('getContent');
  if (idx2 >= 0) console.log('getContent ctx', r.text.slice(Math.max(0, idx2 - 100), idx2 + 300));
  // search for fetch/ajax patterns near article
  for (const key of ['articleContent', 'getArticle', 'contentUrl', 'docx', 'lake', 'initYuQue', 'YuqueViewer']) {
    if (r.text.includes(key)) console.log('has', key);
  }
}
