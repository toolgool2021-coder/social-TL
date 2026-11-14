import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const files = await readdir(root);
let count = 0;
function check(source, name, module = true) {
  const result = spawnSync(process.execPath, module ? ['--check', '--input-type=module'] : ['--check'], { input: source, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`${name}: ${result.stderr}`);
  count++;
}
for (const name of files) {
  const source = await readFile(new URL(name, root), 'utf8').catch(() => null);
  if (name.endsWith('.js')) check(source, name);
  if (name.endsWith('.html')) {
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(match[1])) continue;
      if (match[2].trim()) check(match[2], name, /type\s*=\s*["']module["']/.test(match[1]));
    }
  }
}
check(await readFile(new URL('functions/index.js', root), 'utf8'), 'functions/index.js', false);
for (const name of ['package.json', 'functions/package.json', 'firebase.json', 'firestore.indexes.json']) {
  JSON.parse(await readFile(new URL(name, root), 'utf8'));
}
console.log(`Syntax checks passed (${count} scripts); Firebase/package JSON valid.`);
