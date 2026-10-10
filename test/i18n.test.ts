import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMessage, t } from '../src/i18n';
import en from '../static/_locales/en/messages.json';

describe('t', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('확장 밖에서는 키를 돌려준다', () => {
    expect(t('expandAll')).toBe('expandAll');
  });
  it('치환값은 키 뒤에 붙는다', () => {
    expect(t('foldBlocksHeading', [4, '설치'])).toBe('foldBlocksHeading:4|설치');
  });

  it('확장 안에서는 크롬 화면 언어와 상관없이 영어 — GitHub 화면이 영어뿐이라 맞춘다(한국어는 나중에 설정으로)', () => {
    const getMessage = vi.fn().mockReturnValue('한국어 문구');
    vi.stubGlobal('chrome', { i18n: { getMessage } });
    expect(t('reply')).toBe(en.reply.message);
    expect(t('commentOnLine', ['R13'])).toBe('Add a comment on line R13');
    expect(t('foldBlocksHeading', [4, 'Install'])).toBe('Unchanged · 4 blocks · last heading “Install”');
    expect(getMessage).not.toHaveBeenCalled();
    expect(t('noSuchKey')).toBe('noSuchKey');
  });
});

describe('formatMessage — chrome.i18n 형식', () => {
  it('이름 자리표시·$1 치환·$$는 $', () => {
    expect(formatMessage({ message: 'Lines $START$–$END$', placeholders: { start: { content: '$1' }, end: { content: '$2' } } }, ['3', '5'])).toBe('Lines 3–5');
    expect(formatMessage({ message: 'Costs $$5 for $1' }, ['you'])).toBe('Costs $5 for you');
    expect(formatMessage({ message: 'Missing $1' }, [])).toBe('Missing ');
  });
});
