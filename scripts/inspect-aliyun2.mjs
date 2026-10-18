import fs from 'fs';

const html = fs.readFileSync(process.env.TEMP + '/aliyun-article.html', 'utf8');

function matchGroup(text, re) {
  const m = text.match(re);
  return m?.[1];
}

const title =
  matchGroup(html, /class="article-title"[^>]*>([\s\S]*?)<\//i)?.replace(/<[^>]+>/g, '').trim() ||
  matchGroup(html, /property="og:title"[^>]*content="([^"]+)/i)?.replace(/-阿里云.*$/, '').trim();

const author =
  matchGroup(html, /class="[^"]*username[^"]*"[^>]*>([\s\S]*?)<\//i)?.replace(/<[^>]+>/g, '').trim() ||
  matchGroup(html, /class="[^"]*author[^"]*"[^>]*>([\s\S]*?)<\//i)?.replace(/<[^>]+>/g, '').trim();

const time = matchGroup(html, /class="article-info-time"[^>]*>([\s\S]*?)<\//i)?.replace(/<[^>]+>/g, '').trim();

console.log({ title, author, time });

// extract article-content block
const idx = html.indexOf('class="article-content"');
console.log('content idx', idx);
let contentHtml = '';
if (idx > 0) {
  // find opening tag end
  const start = html.indexOf('>', idx) + 1;
  // naive: find matching by looking for article-inner or close before article-comment
  const endMarkers = ['class="article-comment"', 'class="article-copyright"', 'id="article-comment"'];
  let end = html.length;
  for (const m of endMarkers) {
    const i = html.indexOf(m, start);
    if (i > start && i < end) end = i;
  }
  contentHtml = html.slice(start, end);
  // trim trailing wrappers roughly
  console.log('contentHtml len', contentHtml.length);
  console.log('sample', contentHtml.slice(0, 500));
  console.log('img count', (contentHtml.match(/<img/gi) || []).length);
  console.log('pre count', (contentHtml.match(/<pre/gi) || []).length);
  console.log('h2 count', (contentHtml.match(/<h2/gi) || []).length);
  const imgs = [...contentHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 10);
  console.log('imgs', imgs);
}

// also check for JSON embedded
for (const key of ['articleDetail', 'articleInfo', 'contentHtml', 'markdown']) {
  console.log(key, html.includes(key));
}

// look for script with article data
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
console.log('scripts', scripts.length);
for (const s of scripts.slice(0, 20)) {
  const body = s[1] || '';
  if (/article|content|title/i.test(body) && body.length > 200 && body.length < 50000) {
    console.log('script sample len', body.length, body.slice(0, 200).replace(/\s+/g, ' '));
  }
}
