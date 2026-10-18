import fs from 'fs';
const html = fs.readFileSync(process.env.TEMP + '/aliyun-article.html', 'utf8');
console.log('has larkContent', html.includes('larkContent'));
const m = html.match(/GLOBAL_CONFIG\s*=\s*(\{[\s\S]*?\});/);
if (m) {
  try {
    const cfg = JSON.parse(m[1].replace(/'/g, '"')); // may fail
    console.log('parsed keys', Object.keys(cfg));
  } catch (e) {
    console.log('json parse fail', e.message);
  }
}
// extract with Function
const m2 = html.match(/var GLOBAL_CONFIG\s*=\s*(\{[\s\S]*?\});/);
if (m2) {
  const cfg = Function('return (' + m2[1] + ')')();
  console.log('keys', Object.keys(cfg));
  console.log('larkContent len', (cfg.larkContent || '').length);
  console.log('authorUccId', cfg.authorUccId);
  console.log('sample', (cfg.larkContent || '').slice(0, 300));
}
