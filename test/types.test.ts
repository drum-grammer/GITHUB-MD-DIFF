import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as api from '../src/github-api';
import type * as shared from '../src/types';

// 타입 비교는 pnpm typecheck가 본다(vitest 실행 때는 지나간다). 화면 모듈의 import는 실행 때 본다
describe('공용 타입 — src/types.ts', () => {
  it('github-api.ts가 같은 타입을 다시 내보낸다(기존 import 그대로)', () => {
    expectTypeOf<api.Side>().toEqualTypeOf<shared.Side>();
    expectTypeOf<api.PostMode>().toEqualTypeOf<shared.PostMode>();
    expectTypeOf<api.ReviewComment>().toEqualTypeOf<shared.ReviewComment>();
    expectTypeOf<api.ReviewThread>().toEqualTypeOf<shared.ReviewThread>();
  });

  it('모양은 옮기기 전과 같다', () => {
    expectTypeOf<shared.Side>().toEqualTypeOf<'left' | 'right'>();
    expectTypeOf<shared.PostMode>().toEqualTypeOf<'single' | 'review'>();
    expectTypeOf<keyof shared.ReviewComment>().toEqualTypeOf<'id' | 'author' | 'body' | 'bodyHTML' | 'url' | 'pending' | 'bodyVersion' | 'canEdit' | 'canDelete'>();
    expectTypeOf<keyof shared.ReviewThread>().toEqualTypeOf<'id' | 'subject' | 'side' | 'start' | 'end' | 'resolved' | 'canReply' | 'comments'>();
    expectTypeOf<shared.ReviewThread['subject']>().toEqualTypeOf<'line' | 'file'>();
  });

  it('화면 모듈(comment-ui·dom-blocks)은 타입을 types.ts에서 가져온다 — GitHub 요청 모듈을 모르게', () => {
    for (const m of ['comment-ui', 'dom-blocks']) {
      const src = readFileSync(`src/${m}.ts`, 'utf8');
      expect(src, m).toMatch(/from '\.\/types'/);
      expect(src, m).not.toMatch(/from '\.\/github-api'/);
    }
  });
});
