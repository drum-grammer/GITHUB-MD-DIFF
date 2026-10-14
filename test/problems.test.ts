import { describe, expect, it } from 'vitest';
import { problemsFor, structureProblem } from '../src/problems';

describe('problemsFor', () => {
  it('GitHub가 렌더링을 못 만들어 원문으로 되돌린 파일은 문제 아님 — GitHub 화면 변경이 아니다(이슈 #22)', () => {
    expect(problemsFor([{ key: 'a', status: 'fallback' }, { key: 'b', status: 'rich' }]).size).toBe(0);
    expect(problemsFor([{ key: 'a', status: 'fallback' }]).size).toBe(0);
    expect(problemsFor([{ key: 'a', status: 'fallback' }, { key: 'b', status: 'no-button' }]).size).toBe(0);
  });

  it('렌더링이 모르는 모양으로 나오면(timeout) 그 파일은 문제', () => {
    expect(problemsFor([{ key: 'a', status: 'timeout' }, { key: 'b', status: 'rich' }])).toEqual(
      new Map([['a', 'problemNoProseDiff']]),
    );
  });

  it('모든 md 파일에서 버튼을 못 찾으면 문제 — GitHub 화면이 바뀐 것', () => {
    expect(problemsFor([{ key: 'a', status: 'no-button' }, { key: 'b', status: 'no-button' }])).toEqual(
      new Map([['a', 'problemNoRichButton'], ['b', 'problemNoRichButton']]),
    );
  });

  it('다른 md 파일은 버튼이 있으면 문제 아님 — 그 파일만 렌더링 보기가 없는 것(이름만 바뀐 파일 등)', () => {
    expect(problemsFor([{ key: 'a', status: 'no-button' }, { key: 'b', status: 'idle' }]).size).toBe(0);
  });

  it('뼈대(lazy)·안내 글(notice) 파일은 문제 아님 — 뼈대만 있는 PR도', () => {
    expect(problemsFor([{ key: 'a', status: 'lazy' }]).size).toBe(0);
    expect(problemsFor([{ key: 'a', status: 'notice' }, { key: 'b', status: 'no-button' }]).size).toBe(0);
  });

  it('기다리는 중이면 문제 아님', () => {
    expect(problemsFor([{ key: 'a', status: 'pending' }, { key: 'b', status: 'waiting' }]).size).toBe(0);
  });
});

/** 1.5.0은 파일을 하나도 못 찾으면 아무 말 없이 멈췄다(2026-10-14) — 화면에 파일이 있다는 신호가 있는데 못 찾으면 문제다 */
describe('structureProblem', () => {
  it('파일 링크가 있는데 파일 묶음을 하나도 못 찾으면 problemNoFiles', () => {
    expect(structureProblem({ files: 0, named: 0, loading: 0, links: 16 })).toBe('problemNoFiles');
  });

  it('파일은 찾았는데 이름을 하나도 못 읽으면(뼈대가 아닌데) problemNoFiles', () => {
    expect(structureProblem({ files: 3, named: 0, loading: 1, links: 6 })).toBe('problemNoFiles');
  });

  it('모두 뼈대면 아직 문제 아님', () => {
    expect(structureProblem({ files: 3, named: 0, loading: 3, links: 6 })).toBeNull();
  });

  it('파일 링크가 없으면(파일 없는 PR·화면 그리는 중) 문제 아님', () => {
    expect(structureProblem({ files: 0, named: 0, loading: 0, links: 0 })).toBeNull();
  });

  it('하나라도 이름을 읽으면 문제 아님', () => {
    expect(structureProblem({ files: 3, named: 1, loading: 0, links: 6 })).toBeNull();
  });
});
