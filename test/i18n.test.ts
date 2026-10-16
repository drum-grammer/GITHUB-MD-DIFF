import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('useMessages — 확장 밖(로컬 리뷰 페이지)에서 문구 쓰기', () => {
  // 모듈 안 상태를 바꾸므로 시험마다 새로 읽는다 — 위 시험들이 쓰는 t는 건드리지 않는다
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('부르면 chrome.i18n 없이도 넘긴 표로 문구를 만든다 — 확장 문구와 페이지 문구를 합친 표', async () => {
    const i18n = await import('../src/i18n');
    expect(i18n.t('reply')).toBe('reply');
    i18n.useMessages({ ...en, sendToAgent: { message: 'Send to agent' } });
    expect(i18n.t('reply')).toBe(en.reply.message);
    expect(i18n.t('commentOnLine', ['R13'])).toBe('Add a comment on line R13');
    expect(i18n.t('sendToAgent')).toBe('Send to agent');
  });

  it('표에 없는 키는 지금처럼 키(와 치환값)를 돌려준다', async () => {
    const i18n = await import('../src/i18n');
    i18n.useMessages({ reply: { message: 'Reply' } });
    expect(i18n.t('noSuchKey')).toBe('noSuchKey');
    expect(i18n.t('noSuchKey', [1, 'a'])).toBe('noSuchKey:1|a');
  });

  it('확장 안에서도 넘긴 표가 이긴다', async () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: vi.fn() } });
    const i18n = await import('../src/i18n');
    i18n.useMessages({ reply: { message: 'Respond' } });
    expect(i18n.t('reply')).toBe('Respond');
  });

  it('부르지 않으면 지금과 같다(확장 밖에서는 키)', async () => {
    const i18n = await import('../src/i18n');
    expect(i18n.t('expandAll')).toBe('expandAll');
  });
});
