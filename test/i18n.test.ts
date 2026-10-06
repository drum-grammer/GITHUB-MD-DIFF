import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';

describe('t', () => {
  it('확장 밖에서는 키를 돌려준다', () => {
    expect(t('expandAll')).toBe('expandAll');
  });
  it('치환값은 키 뒤에 붙는다', () => {
    expect(t('foldBlocksHeading', [4, '설치'])).toBe('foldBlocksHeading:4|설치');
  });
});
