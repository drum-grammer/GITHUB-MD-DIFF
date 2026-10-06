import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`static/_locales/${locale}/messages.json`, 'utf8'));

describe('문구', () => {
  it('ko와 en의 키가 같다', () => {
    expect(Object.keys(load('ko')).sort()).toEqual(Object.keys(load('en')).sort());
  });
});
