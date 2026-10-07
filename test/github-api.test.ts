import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RequestError,
  commentPayload,
  findRawLines,
  parsePrData,
  postComment,
  prRef,
  replyPayload,
  type ReviewThread,
} from '../src/github-api';

const comment = (id: number, extra: Record<string, unknown> = {}) => ({
  databaseId: id,
  author: { login: 'me' },
  body: `글 ${id}`,
  bodyHTML: `<p>글 ${id}</p>`,
  url: `https://github.com/o/r/pull/1#discussion_r${id}`,
  ...extra,
});

/** 2026-10-08 구조를 줄인 것 */
const route = {
  payload: {
    pullRequestsChangesRoute: {
      comparison: { fullDiff: { baseOid: 'b'.repeat(40), headOid: 'h'.repeat(40) } },
      viewerPendingReview: { id: 'PRR_1', comments: [] },
      diffContents: [{ path: 'docs/new.md', oldTreeEntry: { path: 'docs/old.md' } }],
      diffSummaries: [
        {
          path: 'docs/new.md',
          changeType: 'RENAMED',
          markersMap: {
            R12: { threads: [{ id: 11 }], annotations: [] },
            R20: { threads: [{ id: 12, start: 'R15' }] },
            L4: { threads: [{ id: 13 }] },
            R30: { threads: [{ id: 14 }] },
          },
        },
        { path: 'docs/plain.md', changeType: 'MODIFIED', markersMap: {} },
      ],
      markers: {
        threads: {
          11: { id: 'PRRT_11', subjectType: 'LINE', isResolved: false, viewerCanReply: true, commentsData: { comments: [comment(101)] } },
          12: { id: 'PRRT_12', subjectType: 'LINE', isResolved: true, commentsData: { comments: [comment(102), comment(103, { state: 'pending' })] } },
          13: { id: 'PRRT_13', subjectType: 'LINE', commentsData: { comments: [comment(104)] } },
          14: { id: 'PRRT_14', subjectType: 'FILE', commentsData: { comments: [comment(105)] } },
        },
      },
    },
  },
};

describe('parsePrData', () => {
  it('커밋·보류 중인 리뷰·옛 경로를 읽는다', () => {
    const d = parsePrData(route);
    expect(d.baseOid).toBe('b'.repeat(40));
    expect(d.headOid).toBe('h'.repeat(40));
    expect(d.pendingReviewId).toBe('PRR_1');
    expect(d.files.get('docs/new.md')?.oldPath).toBe('docs/old.md');
    expect(d.files.get('docs/plain.md')?.threads).toEqual([]);
  });

  it('스레드 위치는 markersMap 키에서 — 범위는 start부터, 파일 코멘트는 뺀다', () => {
    const threads = parsePrData(route).files.get('docs/new.md')!.threads;
    expect(threads.map((t) => [t.id, t.side, t.start, t.end, t.resolved])).toEqual([
      ['PRRT_13', 'left', 4, 4, false],
      ['PRRT_11', 'right', 12, 12, false],
      ['PRRT_12', 'right', 15, 20, true],
    ]);
    expect(threads[2].comments.map((c) => [c.id, c.pending])).toEqual([
      ['102', false],
      ['103', true],
    ]);
  });

  it('모양이 다르면 RequestError', () => {
    expect(() => parsePrData({ payload: {} })).toThrow(RequestError);
  });
});

describe('payload', () => {
  const ids = { baseOid: 'B', headOid: 'H' };

  it('한 줄 — 새 파일 쪽은 head 커밋, 바로 올리기는 submitBatch true', () => {
    expect(commentPayload({ path: 'a.md', side: 'right', start: 7, end: 7 }, '글', 'single', ids)).toEqual({
      comparisonStartOid: 'B',
      comparisonEndOid: 'H',
      path: 'a.md',
      line: 7,
      side: 'right',
      submitBatch: true,
      text: '글',
      subjectType: 'line',
      positioning: { type: 'line', baseCommitOid: 'B', headCommitOid: 'H', commitOid: 'H', line: 7, path: 'a.md' },
    });
  });

  it('범위 — 원래 파일 쪽은 base 커밋, 리뷰에 넣기는 submitBatch false', () => {
    const p = commentPayload({ path: 'a.md', side: 'left', start: 3, end: 5 }, '글', 'review', ids);
    expect(p).toMatchObject({ line: 5, startLine: 3, side: 'left', startSide: 'left', submitBatch: false, subjectType: 'multiline' });
    expect(p.positioning).toEqual({
      type: 'multiline',
      baseCommitOid: 'B',
      headCommitOid: 'H',
      startPath: 'a.md',
      startLine: 3,
      startCommitOid: 'B',
      endPath: 'a.md',
      endLine: 5,
      endCommitOid: 'B',
    });
  });

  it('답글은 스레드 첫 코멘트에', () => {
    const thread = { comments: [{ id: '101' }, { id: '102' }] } as ReviewThread;
    expect(replyPayload(thread, 'a.md', '답', 'single', ids)).toEqual({
      text: '답',
      submitBatch: true,
      inReplyTo: 101,
      path: 'a.md',
      comparisonStartOid: 'B',
      comparisonEndOid: 'H',
    });
  });
});

describe('그 밖', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prRef — PR 주소에서 저장소와 번호', () => {
    expect(prRef('https://github.com/o/r/pull/12/changes')).toEqual({ owner: 'o', repo: 'r', number: 12 });
    expect(prRef('https://github.com/o/r/issues/12')).toBeNull();
  });

  it('findRawLines — 깊이 묻힌 rawLines도 찾는다', () => {
    expect(findRawLines({ payload: { a: { rawLines: ['x', 'y'] } } })).toEqual(['x', 'y']);
    expect(findRawLines({ rawLines: [1] })).toBeNull();
  });

  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('postComment — 줄 문제가 아닌 422는 한 번 더, 줄 문제는 바로 오류', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(422, { message: 'Try again' })).mockResolvedValueOnce(reply(200, { thread: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await postComment({ owner: 'o', repo: 'r', number: 1 }, { text: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/o/r/pull/1/page_data/create_review_comment');
    expect(init.credentials).toBe('include');
    expect(init.headers['GitHub-Verified-Fetch']).toBe('true');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(422, { message: 'Line could not be resolved' })));
    const err = await postComment({ owner: 'o', repo: 'r', number: 1 }, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestError);
    expect((err as RequestError).lineNotResolved).toBe(true);
  });
});
