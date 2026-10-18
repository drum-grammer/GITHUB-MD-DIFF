// skill 설치(스펙 §7-1) — Agent Skills 표준 SKILL.md를 템플릿에서 만들고 실행 명령 한 줄을 모든 단계에 박는다
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Io } from './cli';

export const SKILL_NAME = 'markdown-diff-review';

export function renderSkill(template: string, command: string): string {
  const out = template.replaceAll('{{COMMAND}}', command);
  const left = out.match(/\{\{[^}]*\}\}/g);
  if (left) throw new Error(`the skill template has unfilled placeholders: ${[...new Set(left)].join(', ')}`);
  return out;
}

/** npm으로 받은 실행인가 — npx 캐시(~/.npm/_npx/<해시>/node_modules/…)·전역·로컬 설치 모두 실제 경로에 이 조각이 있다 */
export function isNpmInstall(selfPath: string): boolean {
  return /[\\/]node_modules[\\/]markdown-diff-cat[\\/]/.test(selfPath);
}

/** 셸에 그대로 붙여도 되는 인용 — 보통은 큰따옴표, $·`·"·\·줄바꿈이 있으면 홑따옴표 */
function shellQuote(p: string): string {
  return /[$`"\\\n]/.test(p) || p.includes("'") ? `'${p.replace(/'/g, `'\\''`)}'` : `"${p}"`;
}

/** npx로 받은 실행이면 npx -y markdown-diff-cat@<버전>(npx는 bin을 PATH에 깔지 않으므로 단계마다 전체 명령), 파일이면 node "<절대 경로>" */
export function chooseCommand(o: { selfPath: string; version: string; override?: string }): string {
  if (o.override) return o.override;
  if (isNpmInstall(o.selfPath)) return `npx -y markdown-diff-cat@${o.version}`;
  return `node ${shellQuote(o.selfPath)}`;
}

export interface InstallPlan {
  scope: 'user' | 'project';
  home: string;
  projectRoot?: string;
}

/** 실제 폴더(.agents/skills — Codex·Cursor·VS Code)와 거울(.claude/skills — Claude Code는 .agents를 읽지 않는다) */
export function skillLocations(plan: InstallPlan): { real: string; mirror: string } {
  const base = plan.scope === 'user' ? plan.home : plan.projectRoot!;
  return { real: join(base, '.agents', 'skills', SKILL_NAME), mirror: join(base, '.claude', 'skills', SKILL_NAME) };
}

export function installSkill(content: string, plan: InstallPlan): { written: string[]; linked: string[]; notes: string[] } {
  const { real, mirror } = skillLocations(plan);
  const out = { written: [] as string[], linked: [] as string[], notes: [] as string[] };
  const write = (dir: string): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), content);
    out.written.push(join(dir, 'SKILL.md'));
  };
  write(real);
  if (plan.scope === 'project') {
    write(mirror);
    out.notes.push('Commit both copies. git turns committed symlinks into plain files where core.symlinks=false, so the project scope uses copies. Check them later with: markdown-diff-cat skill install --project --check');
    return out;
  }
  let st: Stats | null = null;
  try {
    st = lstatSync(mirror);
  } catch {
    st = null;
  }
  const target = relative(dirname(mirror), real);
  if (st?.isSymbolicLink()) {
    if (readlinkSync(mirror) === target) return out;
    unlinkSync(mirror);
  } else if (st) {
    write(mirror);
    out.notes.push(`${mirror} is a folder, not a link; wrote a copy there instead of replacing it.`);
    return out;
  }
  mkdirSync(dirname(mirror), { recursive: true });
  symlinkSync(target, mirror, 'dir');
  out.linked.push(`${mirror} → ${target}`);
  return out;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** 설치본이 이 판(같은 실행 명령)과 같은지 해시로 */
export function checkSkill(content: string, plan: InstallPlan): Array<{ path: string; state: 'same' | 'differs' | 'missing' }> {
  const want = sha256(content);
  const { real, mirror } = skillLocations(plan);
  return [real, mirror].map((dir) => {
    const path = join(dir, 'SKILL.md');
    try {
      return { path, state: sha256(readFileSync(path, 'utf8')) === want ? ('same' as const) : ('differs' as const) };
    } catch {
      return { path, state: 'missing' as const };
    }
  });
}

/** markdown-diff-cat skill install [--user|--project] [--check] [--command "<명령>"] */
export function skillCommand(
  rest: string[],
  flags: Map<string, string | true>,
  io: Pick<Io, 'out' | 'err' | 'home' | 'selfPath'>,
  deps: { template: string; version: string; repoRoot(): string },
): number {
  if (rest[0] !== 'install' || rest.length !== 1) {
    io.err('usage: markdown-diff-cat skill install [--user|--project] [--check] [--command "<command>"]');
    return 2;
  }
  if (flags.has('user') && flags.has('project')) {
    io.err('choose one of --user or --project');
    return 2;
  }
  const scope = flags.has('project') ? 'project' : 'user';
  const override = typeof flags.get('command') === 'string' ? (flags.get('command') as string) : undefined;
  const command = chooseCommand({ selfPath: io.selfPath, version: deps.version, override });
  const content = renderSkill(deps.template, command);
  const plan = (s: 'user' | 'project'): InstallPlan => (s === 'user' ? { scope: s, home: io.home } : { scope: s, home: io.home, projectRoot: deps.repoRoot() });
  // 다른 범위에 같은 이름이 있으면 판을 비교해 경고한다 — Codex는 같은 이름을 합치지 않아 둘 다 뜬다
  const warnOther = (): void => {
    const other = scope === 'user' ? 'project' : 'user';
    let states: ReturnType<typeof checkSkill>;
    try {
      states = checkSkill(content, plan(other));
    } catch {
      return; // 저장소 밖에서 --user — 프로젝트 범위는 없다
    }
    for (const s of states) if (s.state === 'differs') io.out(`Warning: ${s.path} has a different ${SKILL_NAME} skill. Codex shows both; update it with: markdown-diff-cat skill install --${other}`);
  };
  if (flags.has('check')) {
    const states = checkSkill(content, plan(scope));
    for (const s of states) io.out(`${s.state.padEnd(7)} ${s.path}`);
    warnOther();
    return states.every((s) => s.state === 'same') ? 0 : 1;
  }
  const result = installSkill(content, plan(scope));
  for (const p of result.written) io.out(`wrote  ${p}`);
  for (const p of result.linked) io.out(`linked ${p}`);
  for (const n of result.notes) io.out(n);
  io.out(`Skill command: ${command}`);
  warnOther();
  return 0;
}
