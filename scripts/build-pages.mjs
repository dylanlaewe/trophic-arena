import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
mkdirSync(output, {recursive:true});
const html = readFileSync(join(root,'public/index.html'),'utf8');
if (!/<html\b/.test(html)) throw new Error('Missing entry document.');
writeFileSync(join(output,'index.html'),html.replace(/<html\b/,'<html data-mode="solo"'));
for (const name of ['app.js','styles.css','world.js','solo.js','comparison.js']) {
  copyFileSync(join(root,'public',name),join(output,name));
}
for (const name of ['engine.mjs','arena-rules.mjs','model.mjs','data/reference-worlds.json']) {
  copyFileSync(join(root,name),join(output,name.split('/').pop()));
}
writeFileSync(join(output,'.nojekyll'),'');
