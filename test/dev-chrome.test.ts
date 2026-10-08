// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_FILE, DEV_NAME, devBuildId, devDir, devDirProblem, devManifest, syncDir } from '../scripts/dev-chrome-lib.mjs';

describe('써 보기 하네스', () => {
  it('고정 폴더는 GMD_CHROME_DEV_DIR이 있으면 그것, 없으면 ~/.local/share 아래', () => {
    expect(devDir({ GMD_CHROME_DEV_DIR: '/x' }, '/home/me')).toBe('/x');
    expect(devDir({}, '/home/me')).toBe('/home/me/.local/share/github-md-diff/chrome-dev');
  });

  it('고정 폴더는 끝 슬래시를 떼어 스테이징 폴더가 그 안에 생기지 않게 한다', () => {
    expect(devDir({ GMD_CHROME_DEV_DIR: '/x/dev/' }, '/home/me')).toBe('/x/dev');
  });

  it('비어 있지 않은 남의 폴더에는 반영하지 않는다', () => {
    const root = mkdtempSync(join(tmpdir(), 'gmd-guard-'));
    expect(devDirProblem(join(root, 'none'))).toBeNull();
    expect(devDirProblem(root)).toBeNull();
    writeFileSync(join(root, 'photo.jpg'), 'x');
    expect(devDirProblem(root)).toContain('개발 빌드 폴더가 아니다');
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ name: DEV_NAME }));
    expect(devDirProblem(root)).toBeNull();
    const built = mkdtempSync(join(tmpdir(), 'gmd-guard-'));
    writeFileSync(join(built, BUILD_FILE), '{}');
    expect(devDirProblem(built)).toBeNull();
  });

  it('빌드 번호는 버전·커밋·dirty를 담고, 같은 커밋이라도 1ms만 달라도 다르다', () => {
    const a = devBuildId({ version: '1.1.1', sha: 'd406b5b', dirty: false, now: new Date(1000) });
    expect(a).toMatch(/^1\.1\.1\+d406b5b\.[0-9a-z]+$/);
    expect(devBuildId({ version: '1.1.1', sha: 'd406b5b', dirty: true, now: new Date(1000) })).toMatch(/^1\.1\.1\+d406b5b\.dirty\./);
    expect(devBuildId({ version: '1.1.1', sha: 'd406b5b', dirty: false, now: new Date(1001) })).not.toBe(a);
  });

  it('개발 매니페스트는 이름·version_name만 바꾸고 권한·매치는 그대로', () => {
    const store = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
    const dev = devManifest(store, { sha: 'd406b5b', dirty: true });
    expect(dev.name).toBe(DEV_NAME);
    expect(dev.action.default_title).toBe(DEV_NAME);
    expect(dev.version_name).toBe(`${store.version} dev d406b5b dirty`);
    expect(dev.version).toBe(store.version);
    expect(dev.permissions).toEqual(store.permissions);
    expect(dev.host_permissions).toEqual(store.host_permissions);
    expect(dev.content_scripts).toEqual(store.content_scripts);
  });

  it('고정 폴더 반영은 새 파일로 덮고 옛 파일을 지우고 빌드 번호 파일을 맨 마지막에 쓴다', () => {
    const root = mkdtempSync(join(tmpdir(), 'gmd-sync-'));
    const from = join(root, 'from');
    const to = join(root, 'to');
    mkdirSync(join(from, 'icons'), { recursive: true });
    mkdirSync(join(to, 'old'), { recursive: true });
    writeFileSync(join(from, BUILD_FILE), '{"build":"b"}');
    writeFileSync(join(from, 'content.js'), 'new');
    writeFileSync(join(from, 'icons', 'a.png'), 'png');
    writeFileSync(join(to, 'content.js'), 'old');
    writeFileSync(join(to, 'old', 'gone.js'), 'x');
    writeFileSync(join(to, 'stale.js'), 'x');
    writeFileSync(join(to, BUILD_FILE), '{"build":"a"}');
    const order: string[] = [];
    const buildFileDuringCopy: boolean[] = [];
    syncDir(from, to, (rel: string) => {
      order.push(rel);
      if (rel !== BUILD_FILE) buildFileDuringCopy.push(existsSync(join(to, BUILD_FILE)));
    });
    expect(buildFileDuringCopy.every((present) => !present), '복사하는 동안 빌드 번호 파일이 없다').toBe(true);
    expect(order.at(-1)).toBe(BUILD_FILE);
    expect(readFileSync(join(to, 'content.js'), 'utf8')).toBe('new');
    expect(existsSync(join(to, 'icons', 'a.png'))).toBe(true);
    expect(existsSync(join(to, 'stale.js'))).toBe(false);
    expect(existsSync(join(to, 'old'))).toBe(false);
  });
});
