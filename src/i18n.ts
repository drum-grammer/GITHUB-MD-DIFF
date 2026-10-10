import en from '../static/_locales/en/messages.json';

/**
 * 확장 문구 — 지금은 크롬 화면 언어와 상관없이 영어로 통일한다(2026-10-11 관리자 결정: GitHub 화면이 영어뿐이라 상자 문구를 맞춘다).
 * 한국어 문구(_locales/ko)는 그대로 두고, 나중에 설정으로 고르게 한다(ROADMAP). chrome.i18n은 크롬 언어를 따르므로 쓰지 않고
 * 같은 형식의 영어 파일을 직접 읽는다. 확장 밖(테스트)에서는 "키" 또는 "키:값1|값2"를 돌려준다
 */
export interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

const MESSAGES: Record<string, MessageEntry> = en;

/** chrome.i18n과 같은 규칙 — $NAME$은 자리표시의 content로, $1…$9는 치환값으로, $$는 $로 */
export function formatMessage(entry: MessageEntry, subs: string[]): string {
  const named = entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (all, name: string) => entry.placeholders?.[name.toLowerCase()]?.content ?? all);
  return named.replace(/\$(\$|[1-9])/g, (_, c: string) => (c === '$' ? '$' : (subs[Number(c) - 1] ?? '')));
}

export function t(key: string, subs: Array<string | number> = []): string {
  const s = subs.map(String);
  const inExtension = Boolean((globalThis as { chrome?: typeof chrome }).chrome?.i18n);
  const entry = MESSAGES[key];
  const msg = inExtension && entry ? formatMessage(entry, s) : '';
  return msg || (s.length ? `${key}:${s.join('|')}` : key);
}
