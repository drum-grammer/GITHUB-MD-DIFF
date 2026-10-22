// 앱 동작 — 서버(server.ts)가 관문을 통과시킨 요청을 세션에 잇는다
import type { DraftInput } from './api-types';
import { HttpError } from './errors';
import { GitError } from './git';
import { FILE_CSP } from './security';
import type { AppHandlers, Reply } from './server';
import type { ReviewSession } from './session';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function need(cond: unknown, message: string): asserts cond {
  if (!cond) throw new HttpError(400, message);
}

const isView = (v: unknown): v is 'merge-base' | 'since-last' => v === 'merge-base' || v === 'since-last';
const DRAFT = /^\/api\/drafts\/(d[0-9a-f]{8})$/;

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function route(s: ReviewSession, method: string, path: string, url: URL, body: unknown): unknown {
  const key = `${method} ${path}`;
  if (key === 'GET /api/view') return s.view();
  if (key === 'POST /api/redraw') return s.apiRedraw();
  if (key === 'POST /api/base') {
    need(isObject(body) && isView(body.view), 'view must be merge-base or since-last');
    return s.setView(body.view);
  }
  if (key === 'GET /api/threads') {
    const p = url.searchParams.get('path');
    need(p, 'path is required');
    return s.apiThreads(p);
  }
  if (key === 'GET /api/summary') return { drafts: s.draftCount() };
  if (key === 'GET /api/poll') {
    const rev = url.searchParams.get('rev');
    need(rev, 'rev is required');
    return s.poll(rev);
  }
  if (key === 'POST /api/preview') {
    need(isObject(body) && typeof body.text === 'string', 'text is required');
    return { html: s.preview(body.text) };
  }
  if (key === 'POST /api/send') {
    need(isObject(body) && typeof body.rev === 'string', 'rev is required');
    need(body.include === undefined || isStrings(body.include), 'include must be a list of thread ids');
    return s.apiSend(body.rev, body.include ?? []);
  }
  if (key === 'POST /api/review') {
    need(isObject(body) && typeof body.rev === 'string', 'rev is required');
    return s.apiPush(body.rev);
  }
  if (key === 'POST /api/drafts') {
    need(
      isObject(body) &&
        typeof body.rev === 'string' &&
        typeof body.path === 'string' &&
        (body.side === 'left' || body.side === 'right') &&
        typeof body.start === 'number' &&
        typeof body.end === 'number' &&
        typeof body.body === 'string' &&
        (body.replyTo === undefined || typeof body.replyTo === 'string'),
      'rev, path, side, start, end and body are required',
    );
    return s.addDraft(body as unknown as DraftInput);
  }
  const draft = DRAFT.exec(path);
  if (draft && method === 'PATCH') {
    need(isObject(body) && typeof body.body === 'string', 'body is required');
    return s.editDraft(draft[1], body.body);
  }
  if (draft && method === 'DELETE') {
    s.deleteDraft(draft[1]);
    return { ok: true };
  }
  throw new HttpError(404, `no route for ${key}`);
}

export function appHandlers(session: ReviewSession): AppHandlers {
  return {
    async api(method, path, url, body): Promise<Reply> {
      try {
        return { status: 200, json: await route(session, method, path, url, body) };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, json: { error: e.message } };
        if (e instanceof GitError) return { status: 409, json: { error: e.message } }; // 기준 브랜치가 사라짐 등
        throw e;
      }
    },
    file(id): Reply {
      const img = session.images.load(id);
      if (!img) return { status: 404, body: 'Not found' };
      return { status: 200, body: img.body, type: img.type, headers: { 'Content-Security-Policy': FILE_CSP, 'Content-Disposition': 'attachment' } };
    },
    controlBase(body): void {
      need(isObject(body) && isView(body.view), 'view must be merge-base or since-last');
      need(body.base === undefined || body.base === null || typeof body.base === 'string', 'base must be a string or null');
      try {
        session.setView(body.view, body.base as string | null | undefined);
      } catch (e) {
        // 없는 --base 등(사용자 입력) — 400이면 CLI가 종료 코드 2로 끝난다. 세션은 앞의 기준을 그대로 둔다(setView)
        if (e instanceof GitError && e.code !== 'git-failed') throw new HttpError(400, e.message);
        throw e;
      }
    },
  };
}
