import { describe, expect, it } from 'vitest';
import { fragment } from '../src/dom';
import { wordDiff } from '../src/words';

const el = (html: string): HTMLElement => fragment(html).firstElementChild as HTMLElement;
const html = (a: string, b: string, kind: 'paragraph' | 'item' = 'paragraph') => wordDiff(el(a), el(b), kind)!.html;

describe('wordDiff — 단어 비교', () => {
  it('바뀐 낱말만 del·ins, 겹 공백 없이', () => {
    expect(html('<p>Value is 3 items.</p>', '<p>Value is 4 items.</p>')).toBe('Value is <del>3</del><ins>4</ins> items.');
  });

  it('이어진 낱말은 한 표시로', () => {
    expect(html('<p>keep this old phrase here</p>', '<p>keep this here</p>')).toBe('keep this <del>old phrase</del> here');
  });

  it('문장부호·기호·이모지도 한 단위', () => {
    expect(html('<p>Wait 300ms, then</p>', '<p>Wait 300ms. then</p>')).toBe('Wait 300ms<del>,</del><ins>.</ins> then');
    expect(html('<p>✅ Done</p>', '<p>❌ Done</p>')).toBe('<del>✅</del><ins>❌</ins> Done');
  });

  it('띄어쓰기 없는 글은 Intl.Segmenter 낱말 경계로', () => {
    expect(html('<p>我们今天去北京大学</p>', '<p>我们明天去北京大学</p>')).toBe('我们<del>今天</del><ins>明天</ins>去北京大学');
  });

  it('지운 낱말은 옛 쪽 서식 태그 안, ins·del은 태그 경계를 넘지 않는다', () => {
    expect(html('<p>run <code>npm test</code> now</p>', '<p>run <code>npm ci</code> now</p>')).toBe('run <code>npm <del>test</del><ins>ci</ins></code> now');
    expect(html('<p>see <a href="x">old docs</a></p>', '<p>see new docs</p>')).toBe('see <a href="x"><del>old docs</del></a><ins>new docs</ins>');
  });

  it('원자 요소(KaTeX·이미지·체크 상자·각주 참조·br)는 쪼개지 않는다', () => {
    const out = html('<p>a<br>b <img src="1.png"></p>', '<p>a b <img src="2.png"></p>');
    expect(out).toBe('a<del><br></del> b <del><img src="1.png"></del><ins><img src="2.png"></ins>');
  });

  it('목록 항목은 자기 글만 — 안쪽 목록은 비교하지 않는다', () => {
    expect(html('<li>top <ul><li>inner</li></ul></li>', '<li>top changed<ul><li>other</li></ul></li>', 'item')).toBe('top <ins>changed</ins>');
  });

  it('바뀐 비율 — 바뀐 단위 / 양쪽 단위', () => {
    expect(wordDiff(el('<p>a b c d</p>'), el('<p>a b c e</p>'), 'paragraph')!.ratio).toBeCloseTo(2 / 8);
    expect(wordDiff(el('<p>a b</p>'), el('<p>x y</p>'), 'paragraph')!.ratio).toBe(1);
  });

  it('모델 조각 — 서식 태그 없이 글과 원자 요소만', () => {
    expect(wordDiff(el('<p>a <em>b</em></p>'), el('<p>a <em>c</em></p>'), 'paragraph')!.ops).toEqual([
      { op: 'same', html: 'a' },
      { op: 'del', html: ' b' },
      { op: 'ins', html: ' c' },
    ]);
  });
});
