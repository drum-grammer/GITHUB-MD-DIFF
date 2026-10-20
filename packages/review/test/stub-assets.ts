// vitest가 virtual:mdc-assets 대신 읽는다 — 빌드 없이 서버·skill을 시험한다
import { readFileSync } from 'node:fs';

const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64');

export default {
  'page.js': { type: 'text/javascript; charset=utf-8', br: false, b64: b64('/* stub page */') },
  'page.css': { type: 'text/css; charset=utf-8', br: false, b64: b64('/* stub css */') },
  'skill.md.tmpl': {
    type: 'text/plain; charset=utf-8',
    br: false,
    b64: b64(readFileSync(new URL('../../../skills/markdown-diff-review/SKILL.md.tmpl', import.meta.url))),
  },
  'licenses.txt': { type: 'text/plain; charset=utf-8', br: false, b64: b64('stub licenses') },
};
