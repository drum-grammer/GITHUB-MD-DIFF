import { describe, expect, it } from 'vitest';
import { fragment } from '../src/dom';
import { wordRows, type Fixture } from '../parity/run';

const fixture = (oldText: string, newText: string): Fixture => ({
  name: 'case',
  meta: { source: 'handmade', captured: '2026-10-17', path: 'a.md', status: 'modified' },
  oldText,
  newText,
  github: '',
});

describe('단어 표시 자료 — GitHub가 통째로 냈는가', () => {
  it('목록 항목을 li.removed + li.added로 바꿔 쓰면 whole(GitHub는 목록 항목에 <ins>를 쓰지 않는다)', () => {
    const github = fragment('<div class="changed"><ul class="rich-diff-level-one"><li class="removed">Run the tests</li><li class="added">Run the full test suite</li></ul></div>');
    const rows = wordRows(fixture('- Run the tests\n', '- Run the full test suite\n'), github);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^\| case \| item \| [0-9.]+ \| whole \|/);
  });

  it('항목 안에 ins·del이 있으면 inline', () => {
    const github = fragment('<div class="changed"><ul class="rich-diff-level-one"><li class="changed">Run the <del>tests</del><ins>suite</ins></li></ul></div>');
    expect(wordRows(fixture('- Run the tests\n', '- Run the suite\n'), github)[0]).toMatch(/\| inline \|/);
  });

  it('통째로 넣은 블록(<ins> 안)은 whole', () => {
    const github = fragment('<del><p>Old words here.</p></del><ins><p>New words here.</p></ins>');
    expect(wordRows(fixture('Old words here.\n', 'New words here.\n'), github)[0]).toMatch(/\| whole \|/);
  });
});
