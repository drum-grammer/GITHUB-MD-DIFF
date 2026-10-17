import { describe, expect, it } from 'vitest';
import { PARITY_CASES } from '../../../testbed/parity-scenarios';
import { check } from './invariants';

describe('패리티 시나리오 — 올리기 전에 엔진 불변식', () => {
  it('이름이 겹치지 않고 파일 이름으로 쓸 수 있다', () => {
    const names = PARITY_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => /^[a-z0-9-]+$/.test(n))).toBe(true);
  });

  it.each(PARITY_CASES.map((c) => [c.name, c] as const))('%s', (name, c) => {
    check(c.old, c.new, `parity/${name}.md`);
  });
});
