import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ImageIssuer, normalizeRepoPath } from '../src/images';
import { tempDir, tempRepo, type TempRepo } from './helpers/git-repo';

const made: TempRepo[] = [];
afterEach(() => {
  for (const r of made.splice(0)) r.cleanup();
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('normalizeRepoPath', () => {
  it('저장소 상대 경로만 — 탈출·절대·.git(대소문자 우회 포함)은 null', () => {
    expect(normalizeRepoPath('docs/img/a.png')).toBe('docs/img/a.png');
    expect(normalizeRepoPath('./docs/./img/a.png')).toBe('docs/img/a.png');
    expect(normalizeRepoPath('docs/../a.png')).toBe('a.png');
    expect(normalizeRepoPath('../outside.png')).toBeNull();
    expect(normalizeRepoPath('/etc/passwd')).toBeNull();
    expect(normalizeRepoPath('C:/x.png')).toBeNull();
    expect(normalizeRepoPath('.GIT/config')).toBeNull();
    expect(normalizeRepoPath('a/.Git/HEAD')).toBeNull();
  });
});

describe('ImageIssuer', () => {
  it('작업 트리·git 객체 이미지를 id로 읽는다 — 같은 판·경로는 같은 id', () => {
    const r = tempRepo();
    made.push(r);
    r.write('docs/a.png', PNG);
    const oid = r.commit();
    r.write('docs/a.png', Buffer.concat([PNG, Buffer.from('new')]));
    const images = new ImageIssuer(r.dir);
    const now = images.issue('r00001', { kind: 'worktree', path: 'docs/a.png' })!;
    const old = images.issue('r00001', { kind: 'git', oid, path: 'docs/a.png' })!;
    expect(now).toMatch(/^[0-9a-f]{32}$/);
    expect(images.issue('r00001', { kind: 'worktree', path: 'docs/a.png' })).toBe(now);
    expect(images.load(now)).toEqual({ body: Buffer.concat([PNG, Buffer.from('new')]), type: 'image/png' });
    expect(images.load(old)).toEqual({ body: PNG, type: 'image/png' });
  });
  it('발급하지 않은 id·모양이 다른 id는 null, 저장소 밖 경로는 발급하지 않는다', () => {
    const images = new ImageIssuer(tempDir());
    expect(images.load('0'.repeat(32))).toBeNull();
    expect(images.load('../../etc/passwd')).toBeNull();
    expect(images.issue('r00001', { kind: 'worktree', path: '../x.png' })).toBeNull();
  });
  it('밖을 가리키는 심링크 이미지는 읽지 않는다', () => {
    const r = tempRepo();
    made.push(r);
    const outside = join(tempDir(), 'secret.png');
    writeFileSync(outside, PNG);
    symlinkSync(outside, join(r.dir, 'leak.png'));
    const images = new ImageIssuer(r.dir);
    expect(images.load(images.issue('r00001', { kind: 'worktree', path: 'leak.png' })!)).toBeNull();
  });
  it('forgetExcept는 남길 판의 id만 둔다', () => {
    const r = tempRepo();
    made.push(r);
    r.write('a.png', PNG);
    const images = new ImageIssuer(r.dir);
    const a = images.issue('r00001', { kind: 'worktree', path: 'a.png' })!;
    const b = images.issue('r00002', { kind: 'worktree', path: 'a.png' })!;
    images.forgetExcept(['r00002']);
    expect(images.load(a)).toBeNull();
    expect(images.load(b)).not.toBeNull();
  });
});
