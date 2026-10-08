// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NOTES_DRAFT_MARK,
  checkGate,
  compareVersions,
  finishGate,
  latestVersionTag,
  notesDraft,
  notesProblem,
  parseArgs,
  releaseDir,
  releaseNotesPath,
  submitGate,
  tagPlan,
  treeProblems,
  uploadGate,
  versionProblems,
} from '../scripts/release-lib.mjs';

const record = { version: '1.1.1', commit: 'a'.repeat(40), zip: 'release/x.zip', sha256: 'f'.repeat(64), e2e: true, listingChanged: false, checkedAt: '' };

describe('버전', () => {
  it('SemVer를 숫자로 비교한다', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.1.1', '1.1.1')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
    expect(() => compareVersions('1.0', '1.0.0')).toThrow('SemVer');
  });
  it('가장 높은 vX.Y.Z 태그를 고르고 다른 태그는 무시한다', () => {
    expect(latestVersionTag(['v1.9.0', 'v1.10.0', 'demo', 'v2.0'])).toBe('v1.10.0');
    expect(latestVersionTag([])).toBeNull();
  });
  it('매니페스트·package.json이 같고 태그·게시 버전보다 높아야 한다', () => {
    expect(versionProblems({ manifest: '1.1.1', pkg: '1.1.1', latestTag: 'v1.0.0', published: '1.0.0' })).toEqual([]);
    expect(versionProblems({ manifest: '1.1.1', pkg: '1.1.0', latestTag: null, published: null })[0]).toContain('package.json 1.1.0');
    expect(versionProblems({ manifest: '1.0.0', pkg: '1.0.0', latestTag: 'v1.0.0', published: null })[0]).toContain('v1.0.0보다 높아야');
    expect(versionProblems({ manifest: '1.1.1', pkg: '1.1.1', latestTag: 'v1.0.0', published: '1.1.1' })[0]).toContain('게시 버전 1.1.1');
  });
});

describe('관문', () => {
  it('check는 origin/main의 깨끗한 트리에서만', () => {
    expect(treeProblems({ head: 'a', originMain: 'a', porcelain: '' })).toEqual([]);
    expect(treeProblems({ head: 'a', originMain: 'b', porcelain: '' })[0]).toContain('origin/main');
    expect(treeProblems({ head: 'a', originMain: 'a', porcelain: '?? x' })[0]).toContain('깨끗하지 않다');
  });
  it('check는 이미 스토어에 올린 기록을 --redo 없이 덮지 않는다', () => {
    expect(checkGate(null, { redo: false })).toBeNull();
    expect(checkGate(record, { redo: false })).toBeNull();
    const uploaded = { ...record, upload: { version: '1.1.1', sha256: record.sha256, state: 'SUCCEEDED', at: '' } };
    expect(checkGate(uploaded, { redo: false })).toContain('--redo');
    expect(checkGate(uploaded, { redo: true })).toBeNull();
  });
  it('upload는 기록의 zip일 때만, 제출한 뒤에는 하지 않는다', () => {
    expect(uploadGate(null, { zipSha: 'f' })).toContain('release check');
    expect(uploadGate(record, { zipSha: '0' })).toContain('zip이 기록과 다르다');
    expect(uploadGate({ ...record, submit: { state: 'PENDING_REVIEW', at: '' } }, { zipSha: record.sha256 })).toContain('이미 제출');
    expect(uploadGate(record, { zipSha: record.sha256 })).toBeNull();
  });
  it('submit은 버전을 직접 적고, 그 zip을 올렸고, 바뀐 등록정보는 넣었다고 할 때만, 한 번만', () => {
    const uploaded = { ...record, upload: { version: '1.1.1', sha256: record.sha256, state: 'SUCCEEDED', at: '' } };
    const ok = { confirm: '1.1.1', listingDone: false, zipSha: record.sha256 };
    expect(submitGate(uploaded, { ...ok, confirm: undefined })).toContain('--confirm 1.1.1');
    expect(submitGate(uploaded, { ...ok, confirm: '1.1.0' })).toContain('--confirm 1.1.1');
    expect(submitGate(record, ok)).toContain('release upload');
    expect(submitGate({ ...uploaded, upload: { ...uploaded.upload, sha256: '0' } }, ok)).toContain('release upload');
    expect(submitGate(uploaded, { ...ok, zipSha: '0' })).toContain('zip이 스토어에 올린 것과 다르다');
    expect(submitGate({ ...uploaded, submit: { state: 'PENDING_REVIEW', at: '' } }, ok)).toContain('이미 제출');
    expect(submitGate({ ...uploaded, listingChanged: true }, ok)).toContain('--listing-done');
    expect(submitGate({ ...uploaded, listingChanged: true }, { ...ok, listingDone: true })).toBeNull();
    expect(submitGate(uploaded, ok)).toBeNull();
  });
  it('finish는 제출한 그 zip이 게시된 뒤에만', () => {
    const submitted = {
      ...record,
      upload: { version: '1.1.1', sha256: record.sha256, state: 'SUCCEEDED', at: '' },
      submit: { state: 'PENDING_REVIEW', at: '' },
    };
    const ok = { confirm: '1.1.1', published: '1.1.1', zipSha: record.sha256 };
    expect(finishGate(null, ok)).toContain('기록이 없다');
    expect(finishGate(submitted, { ...ok, confirm: '1.1' })).toContain('--confirm 1.1.1');
    expect(finishGate(record, ok)).toContain('제출 기록이 없다');
    expect(finishGate(submitted, { ...ok, zipSha: '0' })).toContain('zip이 스토어에 올린 것과 다르다');
    expect(finishGate(submitted, { ...ok, published: '1.0.0' })).toContain('게시 버전이 1.0.0');
    expect(finishGate(submitted, { ...ok, published: null })).toContain('없음');
    expect(finishGate(submitted, ok)).toBeNull();
  });
  it('태그는 없으면 만들고, 같은 커밋이면 이어 쓰고, 다른 커밋이면 멈춘다', () => {
    expect(tagPlan({ existingTagCommit: null, recordCommit: 'a' })).toEqual({ action: 'create' });
    expect(tagPlan({ existingTagCommit: 'a', recordCommit: 'a' })).toEqual({ action: 'reuse' });
    expect(tagPlan({ existingTagCommit: 'b'.repeat(40), recordCommit: 'a' }).problem).toContain('다른 커밋(bbbbbbb)');
  });
});

describe('기록 폴더', () => {
  it('GMD_RELEASE_DIR가 있으면 그 아래, 없으면 ~/.local/share 아래 버전별', () => {
    expect(releaseDir({}, '/home/me', '1.1.1')).toBe('/home/me/.local/share/github-md-diff/releases/1.1.1');
    expect(releaseDir({ GMD_RELEASE_DIR: '/r/' }, '/home/me', '1.1.1')).toBe('/r/1.1.1');
  });
});

describe('릴리스 노트', () => {
  it('노트는 저장소 docs/releases/vX.Y.Z.md에 둔다', () => {
    expect(releaseNotesPath('1.1.1')).toBe('docs/releases/v1.1.1.md');
  });
  it('뼈대는 표시·설치 링크·커밋·SHA를 담고, 표시가 남았거나 SHA가 없으면 막는다', () => {
    const draft = notesDraft({ version: '1.2.0', commit: 'abcdef0123456789', sha256: 'f'.repeat(64) });
    expect(draft.startsWith(NOTES_DRAFT_MARK)).toBe(true);
    expect(draft).toContain('chromewebstore.google.com/detail/');
    expect(draft).toContain('`markdown-diff-cat-for-github-1.2.0.zip`');
    expect(draft).toContain('built from `abcdef0`');
    expect(notesProblem(draft, 'f'.repeat(64))).toContain('초안');
    expect(notesProblem(draft.replace(NOTES_DRAFT_MARK, ''), '0'.repeat(64))).toContain('SHA-256');
    expect(notesProblem(draft.replace(NOTES_DRAFT_MARK, ''), 'f'.repeat(64))).toBeNull();
  });
  it('저장소에 있는 v1.1.1 노트는 최종본이다(표시 없음, 자기 패키지 SHA를 담음)', () => {
    const notes = readFileSync('docs/releases/v1.1.1.md', 'utf8');
    const sha = /SHA-256: `([0-9a-f]{64})`/.exec(notes)?.[1] ?? '';
    expect(sha).toHaveLength(64);
    expect(notesProblem(notes, sha)).toBeNull();
  });
});

describe('인자', () => {
  it('단계·확인 버전·플래그', () => {
    expect(parseArgs(['submit', '--confirm', '1.1.1', '--listing-done'])).toEqual({ step: 'submit', confirm: '1.1.1', listingDone: true, e2e: true, redo: false });
    expect(parseArgs(['check', '--no-e2e', '--redo'])).toEqual({ step: 'check', confirm: undefined, listingDone: false, e2e: false, redo: true });
  });
});
