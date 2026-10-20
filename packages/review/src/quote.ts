// 넘기기 형식의 인용 다루기(스펙 §7-4) — 숨은 지시를 드러내는 것이 목적이라 내용을 지우지 않는다
const ALWAYS = /[\u00AD\u061C\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;
const ZWJ = '\u200D';
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
/** 이모지 뒤에 붙어도 이모지의 일부인 것 — 피부색·변형 선택자 */
const MODIFIER = /[\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F]/u;

const marker = (ch: string): string => `⟦U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟧`;

/** 이모지 + (꾸밈) + ZWJ + 이모지 — 가족·직업 이모지를 망가뜨리지 않는다 */
function joinsEmoji(chars: string[], i: number): boolean {
  let p = i - 1;
  while (p >= 0 && MODIFIER.test(chars[p])) p--;
  return p >= 0 && PICTOGRAPH.test(chars[p]) && i + 1 < chars.length && PICTOGRAPH.test(chars[i + 1]);
}

/** HTML 주석은 ⟦HTML comment: …⟧(코드 블록 인용이면 그대로), 폭 없는 문자·양방향 제어 문자·태그 문자는 ⟦U+200B⟧처럼 */
export function sanitizeQuote(text: string, opts: { code?: boolean } = {}): string {
  const shown = opts.code ? text : text.replace(/<!--([\s\S]*?)(?:-->|$)/g, (_all, inner: string) => `⟦HTML comment: ${inner.trim()}⟧`);
  const chars = [...shown];
  let out = '';
  chars.forEach((ch, i) => {
    if (ch === ZWJ) out += joinsEmoji(chars, i) ? ch : marker(ch);
    else out += ALWAYS.test(ch) ? marker(ch) : ch;
  });
  return out;
}

/** 안의 가장 긴 백틱 연속보다 긴 펜스(최소 3) — 확장 suggestionEdit(md-format.ts:100)와 같은 규칙. 인용이 펜스를 닫고 "내 코멘트"를 꾸밀 수 없게 */
export function fenceFor(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

export function fenced(text: string, info = 'text'): string {
  const fence = fenceFor(text);
  return `${fence}${info}\n${text}\n${fence}`;
}

/** 코멘트 글에서 첫 ```suggestion 블록(제안 버튼이 넣는 모양)을 떼어 낸다. 닫히지 않았거나 없으면 그대로 */
export function splitSuggestion(body: string): { body: string; suggestion: string | null } {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})suggestion\s*$/.exec(lines[i]);
    if (!open) continue;
    const close = new RegExp(`^\`{${open[1].length},}\\s*$`);
    for (let j = i + 1; j < lines.length; j++) {
      if (!close.test(lines[j])) continue;
      return { body: [...lines.slice(0, i), ...lines.slice(j + 1)].join('\n').trim(), suggestion: lines.slice(i + 1, j).join('\n') };
    }
    break;
  }
  return { body: body.trim(), suggestion: null };
}
