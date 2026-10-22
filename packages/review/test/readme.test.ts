import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync('README.md', 'utf8');

describe('npm README', () => {
  it('요구 사항·명령·에이전트 설정·개인정보를 다 적는다', () => {
    expect(readme).toContain('Node.js 22.19 or newer');
    for (const cmd of ['review [--base <ref>] [--since-last] [--open]', 'review --reopen', 'comments [--json] [--round N]', '`wait`', 'mark --rev <id>', 'show --rev <id> [--side old\\|new] <path>', 'stop [--clean]', 'skill install']) expect(readme).toContain(cmd);
    expect(readme).toContain('## Privacy and security');
    expect(readme).toContain('Nothing leaves your machine by default.');
    expect(readme).toContain('only through the GitHub CLI');
  });
  it('PR 모드 — 명령·gh·보류 중 리뷰만·받은 ref·제출은 사람', () => {
    expect(readme).toContain('## Review a pull request');
    expect(readme).toContain('review --pr <number|URL>');
    expect(readme).toContain('gh auth login');
    expect(readme).toContain('Add to pending review');
    expect(readme).toContain('You submit the review on GitHub');
    expect(readme).toContain('refs/markdown-diff-cat/');
    expect(readme).not.toContain('A pull request mode is planned');
  });
  it('개인 홈 경로를 싣지 않는다(공개 패키지)', () => {
    expect(readme).not.toMatch(/\/Users\/[a-z]|\/home\/[a-z]/);
  });
});
