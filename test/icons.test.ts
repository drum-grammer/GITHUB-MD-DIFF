import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8')) as {
  icons?: Record<string, string>;
  action?: { default_icon?: Record<string, string> };
};

/** PNG 머리(IHDR)에서 너비·높이를 읽는다 */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  if (b.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error(`${path}: PNG 아님`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const entries = [
  ...Object.entries(manifest.icons ?? {}),
  ...Object.entries(manifest.action?.default_icon ?? {}),
];

describe('아이콘', () => {
  it('확장 아이콘은 16·32·48·128, 툴바 아이콘은 16·32', () => {
    expect(Object.keys(manifest.icons ?? {}).sort()).toEqual(['128', '16', '32', '48']);
    expect(Object.keys(manifest.action?.default_icon ?? {}).sort()).toEqual(['16', '32']);
  });

  it.each(entries)('%spx → %s: 파일이 있고 크기가 같다', (size, path) => {
    expect(pngSize(`static/${path}`)).toEqual([Number(size), Number(size)]);
  });
});
