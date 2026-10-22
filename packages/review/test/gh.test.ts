import { describe, expect, it } from 'vitest';
import { Gh, GhError, repoPath, type GhRunner } from '../src/gh';

interface Call {
  args: string[];
  cwd: string;
  input?: string;
}

/** 받은 호출을 적고, 정해 둔 답을 차례로 낸다 */
function fake(...answers: Array<{ code?: number; stdout?: string; stderr?: string }>): { run: GhRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: GhRunner = async (args, opts) => {
    calls.push({ args, cwd: opts.cwd, input: opts.input });
    const a = answers.shift() ?? {};
    return { code: a.code ?? 0, stdout: a.stdout ?? '{}', stderr: a.stderr ?? '' };
  };
  return { run, calls };
}

const PR_JSON = JSON.stringify({ url: 'https://github.com/acme/docs/pull/7', number: 7, title: 'Docs', baseRefName: 'main', baseRefOid: 'b'.repeat(40), headRefOid: 'h'.repeat(40) });

describe('Gh', () => {
  it('본문은 stdin JSON으로만 — @·{repo}로 시작해도 글자 그대로', async () => {
    const { run, calls } = fake({ stdout: '{"data":{"x":1}}' });
    const gh = new Gh(run, '/repo');
    expect(await gh.graphql('mutation($b:String!){x(body:$b)}', { b: '@.env {repo} @octocat' })).toEqual({ x: 1 });
    expect(calls[0].args).toEqual(['api', 'graphql', '--input', '-']);
    expect(calls[0].cwd).toBe('/repo');
    expect(JSON.parse(calls[0].input!)).toEqual({ query: 'mutation($b:String!){x(body:$b)}', variables: { b: '@.env {repo} @octocat' } });
  });

  it('rest — 메서드·경로·--input -, 페이지 넘김은 --paginate --slurp로 받아 하나로 편다', async () => {
    const { run, calls } = fake({ stdout: '{"node_id":"PRR_1"}' }, { stdout: '[[{"filename":"a.md"}],[{"filename":"b.md"}]]' });
    const gh = new Gh(run, '/repo');
    expect(await gh.rest('POST', repoPath('acme', 'docs', 'pulls/7/reviews'), { commit_id: 'abc' })).toEqual({ node_id: 'PRR_1' });
    expect(calls[0].args).toEqual(['api', '--method', 'POST', 'repos/acme/docs/pulls/7/reviews', '--input', '-']);
    expect(JSON.parse(calls[0].input!)).toEqual({ commit_id: 'abc' });
    expect(await gh.rest('GET', repoPath('acme', 'docs', 'pulls/7/files?per_page=100'), undefined, { paginate: true })).toEqual([{ filename: 'a.md' }, { filename: 'b.md' }]);
    expect(calls[1].args).toEqual(['api', '--method', 'GET', 'repos/acme/docs/pulls/7/files?per_page=100', '--paginate', '--slurp']);
    expect(calls[1].input).toBeUndefined();
  });

  it('이름 검사 — owner/repo에 / · 공백 · {owner}는 던진다', () => {
    expect(repoPath('acme', 'docs.site', 'pulls/7')).toBe('repos/acme/docs.site/pulls/7');
    expect(() => repoPath('ac me', 'docs', 'x')).toThrow(GhError);
    expect(() => repoPath('{owner}', 'docs', 'x')).toThrow(GhError);
    expect(() => repoPath('acme', 'a/b', 'x')).toThrow(GhError);
  });

  it('prView — url에서 owner·repo·번호를 확정하고 github.com 밖은 거부', async () => {
    const { run, calls } = fake({ stdout: PR_JSON }, { stdout: PR_JSON.replace('https://github.com', 'https://ghe.example.com') });
    const gh = new Gh(run, '/repo');
    expect(await gh.prView('7')).toEqual({ owner: 'acme', repo: 'docs', number: 7, url: 'https://github.com/acme/docs/pull/7', title: 'Docs', baseRefName: 'main', baseRefOid: 'b'.repeat(40), headRefOid: 'h'.repeat(40) });
    expect(calls[0].args).toEqual(['pr', 'view', '7', '--json', 'url,number,title,baseRefName,baseRefOid,headRefOid']);
    await expect(gh.prView('7')).rejects.toThrow(/github\.com/);
  });

  it('실패 — gh 없음은 missing, 종료 코드≠0은 stderr를 담은 failed, 200이어도 GraphQL errors면 failed', async () => {
    const gh = (a: { code?: number; stdout?: string; stderr?: string }) => new Gh(fake(a).run, '/repo');
    await expect(gh({ code: 127 }).graphql('q', {})).rejects.toMatchObject({ kind: 'missing', message: 'PR mode needs the GitHub CLI (gh): https://cli.github.com' });
    await expect(gh({ code: 1, stderr: 'HTTP 422: Unprocessable Entity\n' }).rest('POST', 'repos/a/b/x', {})).rejects.toMatchObject({ kind: 'failed', message: 'gh api: HTTP 422: Unprocessable Entity' });
    await expect(gh({ stdout: '{"data":null,"errors":[{"message":"one"},{"message":"two"}]}' }).graphql('q', {})).rejects.toMatchObject({ kind: 'failed', message: 'GitHub GraphQL: one; two' });
  });

  it('checkAuth — gh auth status가 실패하면 auth, 메시지에 그 출력', async () => {
    const ok = fake({ stdout: 'Logged in' });
    await new Gh(ok.run, '/repo').checkAuth();
    expect(ok.calls[0].args).toEqual(['auth', 'status', '--hostname', 'github.com']);
    const bad = fake({ code: 1, stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n' });
    await expect(new Gh(bad.run, '/repo').checkAuth()).rejects.toMatchObject({ kind: 'auth', message: 'PR mode needs gh signed in to github.com:\nYou are not logged into any GitHub hosts. To log in, run: gh auth login' });
  });
});
