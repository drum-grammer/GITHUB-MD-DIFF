import { describe, expect, it } from 'vitest';
import { SCENARIOS, baseFiles, headFiles } from '../../../testbed/scenarios';
import { check } from './invariants';

// 확장 testbed 시나리오(지어낸 Lantern 문서)의 옛·새 원문 — GitHub에 실제로 올라가 있는 PR과 같은 내용
const base = baseFiles();
const cases = SCENARIOS.filter((s) => s.key === 'review' || s.key === 'followup').flatMap((s) => {
  const head = headFiles(s.key);
  return Object.keys(head)
    .filter((p) => /\.mdx?$/.test(p) && base[p] !== undefined && base[p] !== head[p])
    .map((p) => [`${s.key} ${p}`, base[p], head[p], p] as const);
});

describe('testbed 시나리오 — 불변식', () => {
  it('사례가 있다', () => expect(cases.length).toBeGreaterThan(3));
  it.each(cases)('%s', (_name, oldText, newText, path) => {
    check(oldText, newText, path);
  });

  it('handbook — 바뀐 곳 8(머리말 표·문단·목록·지운 문단+코드·Plans 표·알림·HTML 표·각주)', () => {
    const c = check(base['docs/handbook.md'], headFiles('review')['docs/handbook.md'], 'docs/handbook.md');
    const kinds = c.diff.blocks.filter((b) => b.op !== 'same').map((b) => b.tokenType);
    expect(kinds).toEqual(['front_matter', 'paragraph_open', 'bullet_list_open', 'paragraph_open', 'fence', 'table_open', 'alert_open', 'html_block', 'footnote_block']);
  });
});
