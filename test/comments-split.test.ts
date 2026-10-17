// comments.ts에는 GitHub 백엔드만 남는다 — 화면 동작(마우스·상자 배치·접기 다시 짜기)은 comment-controller.ts 하나에만 있게
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('comments.ts — GitHub 백엔드만', () => {
  it('CommentController에 GitHub 백엔드를 넘기고, 화면 동작 코드는 갖지 않는다', () => {
    const src = readFileSync('src/comments.ts', 'utf8');
    expect(src).toMatch(/class GitHubCommentBackend implements CommentBackend/);
    expect(src).toMatch(/new CommentController\(body, new GitHubCommentBackend\(/);
    for (const screenCode of ["addEventListener('mousemove'", 'placeBox(', 'refold(', 'threadBox(', 'commentForm(']) expect(src, screenCode).not.toContain(screenCode);
  });
});
