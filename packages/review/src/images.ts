// 이미지 /file/<id> — <img>는 헤더를 실을 수 없어 id(128비트) 자체가 권한이다. 발급하지 않은 경로는 열 수 없다(스펙 §5-5)
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { insideRepo, readAt } from './git';

export type ImageSource = { kind: 'git'; oid: string; path: string } | { kind: 'worktree'; path: string };

export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};
const MAX_IMAGE = 50 * 1024 * 1024;

/** 저장소 상대 경로로 정리 — 절대 경로·드라이브·..·.git(대소문자 접어서)은 null */
export function normalizeRepoPath(p: string): string | null {
  if (!p || p.includes('\0') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
  const n = posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (n === '.' || n === '' || n.split('/').some((seg) => seg === '..' || seg.toLowerCase() === '.git')) return null;
  return n;
}

export class ImageIssuer {
  private readonly byId = new Map<string, { rev: string; source: ImageSource }>();
  private readonly byKey = new Map<string, string>();

  constructor(private readonly root: string) {}

  /** 그 판·쪽·경로에 id를 준다(같은 것은 같은 id). 저장소 밖·.git이면 null — 엔진이 그 이미지를 막는다 */
  issue(rev: string, source: ImageSource): string | null {
    const path = normalizeRepoPath(source.path);
    if (!path) return null;
    const src: ImageSource = source.kind === 'git' ? { kind: 'git', oid: source.oid, path } : { kind: 'worktree', path };
    const key = `${rev}\0${src.kind}\0${src.kind === 'git' ? src.oid : ''}\0${path}`;
    const hit = this.byKey.get(key);
    if (hit) return hit;
    const id = randomBytes(16).toString('hex');
    this.byId.set(id, { rev, source: src });
    this.byKey.set(key, id);
    return id;
  }

  /** 지금 판(과 바로 앞 판)의 id만 남긴다 */
  forgetExcept(revs: string[]): void {
    const keep = new Set(revs);
    for (const [id, v] of this.byId) if (!keep.has(v.rev)) this.byId.delete(id);
    for (const [key, id] of this.byKey) if (!this.byId.has(id)) this.byKey.delete(key);
  }

  /** 옛 쪽은 git 객체에서, 작업 트리는 lstat·realpath 검사 뒤(.git 안·저장소 밖·밖을 가리키는 링크는 거부) */
  load(id: string): { body: Buffer; type: string } | null {
    if (!/^[0-9a-f]{32}$/.test(id)) return null;
    const hit = this.byId.get(id);
    if (!hit) return null;
    const { source } = hit;
    const type = IMAGE_TYPES[extname(source.path).toLowerCase()] ?? 'application/octet-stream';
    if (source.kind === 'git') {
      const body = readAt(this.root, source.oid, source.path);
      return body && body.length <= MAX_IMAGE ? { body, type } : null;
    }
    const abs = join(this.root, source.path);
    try {
      const st = lstatSync(abs);
      if (!st.isFile() && !st.isSymbolicLink()) return null;
      if (insideRepo(this.root, abs) !== 'inside') return null;
      const body = readFileSync(abs);
      return body.length <= MAX_IMAGE ? { body, type } : null;
    } catch {
      return null;
    }
  }
}
