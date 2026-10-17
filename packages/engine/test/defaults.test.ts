import { describe, expect, it } from 'vitest';
import { DEFAULT_WHOLE_BLOCK_RATIO } from '../src/index';
import { ENGINE_GAP_CELLS, ENGINE_MAX_CELLS } from '../src/pair';

describe('M1 끝에 정한 기본값 — 스펙 §11-2 결정 기록과 같아야 한다', () => {
  it('단어 표시 기준 비율·짝짓기 한도', () => {
    expect(DEFAULT_WHOLE_BLOCK_RATIO).toBe(0.45);
    expect(ENGINE_GAP_CELLS).toBe(250_000);
    expect(ENGINE_MAX_CELLS).toBe(4_000_000);
  });
});
