import { describe, expect, it } from 'vitest';
import { problemsFor } from '../src/problems';

describe('problemsFor', () => {
  it('렌더링이 시간 안에 안 나오면 그 파일은 문제', () => {
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

  it('기다리는 중이면 문제 아님', () => {
    expect(problemsFor([{ key: 'a', status: 'pending' }, { key: 'b', status: 'waiting' }]).size).toBe(0);
  });
});
