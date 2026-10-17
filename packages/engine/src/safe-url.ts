/** 링크·이미지 주소 규칙 — http·https·mailto와 상대 주소만(확장 comment-ui의 safeUrl과 같은 규칙, 탭·줄바꿈이 낀 javascript:도 URL로 풀어 본다) */
export function safeUrl(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value, 'https://github.com/').protocol);
  } catch {
    return false;
  }
}

/** http(s) 또는 `//`로 시작하는 바깥 주소인가 */
export function isRemote(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src.trim());
}

/**
 * md 파일 기준 상대 이미지 주소 → 저장소 경로. `/`로 시작하면 저장소 루트 기준. 저장소 밖으로 나가거나 스킴이 있으면 null.
 * 쿼리·조각(`?…`·`#…`)은 떼고, 퍼센트 인코딩은 푼다
 */
export function repoImagePath(mdPath: string, src: string): string | null {
  const clean = src.trim().split(/[?#]/)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  if (!decoded || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//')) return null;
  const out = decoded.startsWith('/') ? [] : mdPath.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.length ? out.join('/') : null;
}
