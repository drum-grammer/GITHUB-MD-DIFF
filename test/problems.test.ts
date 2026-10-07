import { describe, expect, it } from 'vitest';
import { problemsFor } from '../src/problems';

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

  it('기다리는 중이면 문제 아님', () => {
    expect(problemsFor([{ key: 'a', status: 'pending' }, { key: 'b', status: 'waiting' }]).size).toBe(0);
  });
});
