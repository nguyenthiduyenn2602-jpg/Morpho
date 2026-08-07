import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const indexPath = resolve('dist/index.html');
const html = await readFile(indexPath, 'utf8');
const rootAssetRef = /(?:src|href)=["']\/assets\//i;

if (rootAssetRef.test(html)) {
  throw new Error('GitHub Pages build contains root /assets references; use pnpm build:pages.');
}

const entry = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1];
if (!entry?.startsWith('./assets/')) {
  throw new Error(`GitHub Pages entry must be relative (./assets/...), received: ${entry || 'missing'}`);
}

console.log(`✓ GitHub Pages asset base verified: ${entry}`);
