// 무엇을 견주나 — 분기점 보기(스펙 §5-3), 지난 리뷰 이후 보기(§5-4), "파일이 바뀜" 폴링 지문
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { changedMarkdown, listMarkdown, pairRenames, readTextAt, readWorktree, type FileStatus } from './git';
import type { Mark, RenderRecord, Round } from './records';

export interface ViewFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  oldText: string | null;
  newText: string | null;
}

export interface Snapshot {
  /** 렌더 판에 담을 원문 — 분기점과 다른 모든 md(지운 경로·이름 바꾼 옛 경로는 null) */
  files: Record<string, string | null>;
  /** 분기점 보기의 파일 */
  viewFiles: ViewFile[];
  /** 읽지 않은 파일(realpath가 저장소 밖·.git 안) */
  skipped: Array<{ path: string; reason: string }>;
}

/** 지금 분기점과 다른 md 전부 — 옛 쪽은 분기점 원문, 새 쪽은 작업 트리(심링크는 링크 글자) */
export function snapshot(root: string, baseOid: string): Snapshot {
  const files: Record<string, string | null> = {};
  const viewFiles: ViewFile[] = [];
  const skipped: Snapshot['skipped'] = [];
  for (const f of changedMarkdown(root, baseOid)) {
    let newText: string | null = null;
    if (f.status !== 'deleted') {
      const r = readWorktree(root, f.path);
      if (r.kind === 'refused') {
        skipped.push({ path: f.path, reason: r.reason });
        continue;
      }
      newText = r.kind === 'missing' ? null : r.text;
    }
    const oldText = f.status === 'added' ? null : readTextAt(root, baseOid, f.oldPath ?? f.path);
    if (f.status === 'modified' && oldText === newText) continue; // 실행 권한 같은 형식만 바뀜
    if (f.oldPath) files[f.oldPath] = null;
    files[f.path] = newText;
    viewFiles.push({ ...f, oldText, newText });
  }
  return { files, viewFiles, skipped };
}

const statusOf = (oldText: string | null, newText: string | null): FileStatus => (oldText === null ? 'added' : newText === null ? 'deleted' : 'modified');

/**
 * 지난 리뷰 판(from) 이후 — 파일 = (판의 파일) ∪ (지금 분기점과 다른 md). 옛 쪽은 판의 원문(또는 "없음"),
 * 판에 없던 파일은 그때 기준과 같았다는 뜻이므로 판의 기준 OID 원문. 옛·새가 같으면 뺀다.
 * 그래서 판 뒤에 처음 고친 파일도 통째 추가가 아니라 바뀐 만큼만, 라운드가 이어져도 앞에서 안 고친 파일의 옛 변경은 다시 뜨지 않는다
 */
export function sinceLastFiles(root: string, from: RenderRecord, now: Snapshot): ViewFile[] {
  const skipped = new Set(now.skipped.map((s) => s.path));
  const paths = [...new Set([...Object.keys(from.files), ...Object.keys(now.files)])].filter((p) => !skipped.has(p)).sort();
  const byPath = new Map<string, ViewFile>();
  for (const path of paths) {
    const oldText = Object.hasOwn(from.files, path) ? from.files[path] : readTextAt(root, from.baseOid, path);
    let newText: string | null;
    if (Object.hasOwn(now.files, path)) newText = now.files[path];
    else {
      const r = readWorktree(root, path);
      if (r.kind === 'refused') continue;
      newText = r.kind === 'missing' ? null : r.text;
    }
    if (oldText === newText) continue;
    byPath.set(path, { path, status: statusOf(oldText, newText), oldText, newText });
  }
  const listed = [...byPath.values()].map(({ path, status }) => ({ path, status }));
  const text = (side: 'old' | 'new', p: string): string | null => (side === 'old' ? byPath.get(p)?.oldText : byPath.get(p)?.newText) ?? null;
  return pairRenames(listed, () => true, text).map((f) =>
    f.status === 'renamed' ? { path: f.path, oldPath: f.oldPath, status: f.status, oldText: byPath.get(f.oldPath!)!.oldText, newText: byPath.get(f.path)!.newText } : byPath.get(f.path)!,
  );
}

/** "지난 리뷰" 기준 — 마지막으로 보낸 라운드의 판과 마지막 mark한 판 중 나중 것 */
export function latestBaseline(rounds: Round[], marks: Mark[]): { rev: string; at: string; source: 'round' | 'mark' } | null {
  const round = rounds.at(-1);
  const mark = marks.at(-1);
  const candidates = [...(round ? [{ rev: round.rev, at: round.createdAt, source: 'round' as const }] : []), ...(mark ? [{ rev: mark.rev, at: mark.at, source: 'mark' as const }] : [])];
  if (!candidates.length) return null;
  return candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}

/** 작업 트리 md의 지금 모습 — 경로·상태와 각 파일의 크기·mtime·ctime. 폴링이 렌더 때 값과 견준다(내용은 읽지 않는다) */
export function fingerprint(root: string, baseOid: string): string {
  const h = createHash('sha1');
  for (const f of listMarkdown(root, baseOid)) {
    h.update(`${f.status}\0${f.oldPath ?? ''}\0${f.path}\0`);
    try {
      const st = lstatSync(join(root, f.path));
      h.update(`${st.size}:${st.mtimeMs}:${st.ctimeMs}\0`);
    } catch {
      h.update('missing\0');
    }
  }
  return h.digest('hex');
}
