import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const review = JSON.parse(readFileSync('locales/en.json', 'utf8')) as Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const extension = JSON.parse(readFileSync('../../static/_locales/en/messages.json', 'utf8')) as Record<string, unknown>;
const pageSource = readdirSync('src/page')
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join('src/page', f), 'utf8'))
  .join('\n');
// 알림 키는 서버(session.ts, Task 9)가 내고 페이지는 그대로 t(key, subs)로 그린다
const serverSource = readFileSync('src/session.ts', 'utf8');

describe('페이지 문구', () => {
  it('키는 review로 시작하고 확장 문구와 겹치지 않는다', () => {
    for (const key of Object.keys(review)) {
      expect(key.startsWith('review')).toBe(true);
      expect(extension).not.toHaveProperty(key);
    }
  });
  it('자리표시 $NAME$마다 placeholders가 있다', () => {
    for (const [key, entry] of Object.entries(review)) {
      for (const [, name] of entry.message.matchAll(/\$([A-Z]+)\$/g)) expect(entry.placeholders?.[name.toLowerCase()], `${key} ${name}`).toBeDefined();
    }
  });
  it('페이지 코드와 서버 알림이 쓰는 review 키는 모두 있다', () => {
    const used = new Set([...`${pageSource}\n${serverSource}`.matchAll(/'(review[A-Za-z]+)'/g)].map((m) => m[1]));
    expect(used).toContain('reviewNoticeBaselineMissing');
    for (const key of used) expect(review, key).toHaveProperty(key);
  });
});
