// 웹스토어 업로드용 ZIP: 빌드 → release/markdown-diff-cat-for-github-<버전>.zip (아이콘 SVG 원본은 뺀다)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
execFileSync('node', ['build.mjs'], { stdio: 'inherit' });
mkdirSync('release', { recursive: true });
const zip = `release/markdown-diff-cat-for-github-${version}.zip`;
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', `../${zip}`, '.', '-x', 'icons/*.svg'], { cwd: 'dist', stdio: 'inherit' });
console.log(zip);
