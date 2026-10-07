import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`static/_locales/${locale}/messages.json`, 'utf8'));

describe('문구', () => {
  it('ko와 en의 키가 같다', () => {
    expect(Object.keys(load('ko')).sort()).toEqual(Object.keys(load('en')).sort());
  });
});

describe('웹스토어 길이 제한', () => {
  it.each(['en', 'ko'])('%s: 이름 75자·설명 132자 이하', (locale) => {
    const m = load(locale) as Record<string, { message: string }>;
    expect(m.extName.message.length).toBeLessThanOrEqual(75);
    expect(m.extDescription.message.length).toBeLessThanOrEqual(132);
  });
  it('1개일 때 쓰는 문구가 있다', () => {
    const m = load('en') as Record<string, { message: string }>;
    expect(m.foldBlockOne.message).toBe('Unchanged · 1 block');
    expect(m.foldRowOne.message).toBe('1 unchanged row');
  });
});
