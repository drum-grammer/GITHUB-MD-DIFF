// 페이지 → 로컬 서버 요청. 쿠키는 쓰지 않는다(포트로 나뉘지 않아 다른 localhost 서버에도 실린다) — 세션 비밀은 그 탭의 sessionStorage에만
export const SESSION_KEY = 'mdc-session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 서버가 껍데기에 넣은 세션 비밀(1회용 코드를 바꾼 것) — 있으면 그 탭에 두고, 없으면(새로고침·원격 이미지 다시 열기) 그 탭에서 읽는다 */
export function sessionSecret(doc: Document, storage: Storage | null): string | null {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="mdc-session"]')?.content;
  if (meta) {
    try {
      storage?.setItem(SESSION_KEY, meta);
    } catch {
      // 저장이 막힌 탭 — 이 페이지에서는 그래도 쓴다
    }
    return meta;
  }
  try {
    return storage?.getItem(SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

export type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

export function createApi(secret: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Api {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl(path, {
      method,
      headers: { 'X-MDC-Session': secret, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
    return data as T;
  };
}
