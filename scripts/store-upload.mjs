// 스토어 대시보드에 올릴 것을 한 폴더로: 패키지·아이콘·언어별 그림(번호 붙인 이름) + 칸마다 복사 버튼이 있는 입력 도우미(guide.html)
// 대시보드는 확장(Claude in Chrome 포함)·내장 브라우저가 조작할 수 없다 — 사람이 이 도우미를 보며 붙여 넣는다(2026-10-07)
// 사용: pnpm store:upload  (pnpm package로 ZIP을 먼저 만든다) → release/store-upload/
//   지난 릴리스 태그(vX.Y.Z)가 있으면 업데이트 화면 — 기존 항목에서 바꿀 칸만 보여 준다. 처음 등록 화면은 `node scripts/store-upload.mjs --first`
//   대시보드 초안에 이미 다른 커밋의 등록정보가 들어 있으면(심사를 취소하고 다시 내는 경우) `--since <그 커밋>`으로 그것과 비교한다
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
const OUT = 'release/store-upload';
const ZIP = `markdown-diff-cat-for-github-${version}.zip`;
const REPO = 'https://github.com/drum-grammer/GITHUB-MD-DIFF';
// 개발자 대시보드(게시자 홈)와 공개 스토어 페이지 — 2026-10-08 확인. 계정 번호(/u/N/)는 브라우저마다 달라 넣지 않는다
const DASHBOARD = 'https://chrome.google.com/webstore/devconsole/1679ec25-b84c-44d3-8b31-357020b6b255?hl=ko';
const LISTING = 'https://chromewebstore.google.com/detail/kabekbbeoajhpbcppidepmcbbjjochlj';
const link = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. 올릴 파일 — 대시보드에서 넣는 순서대로 이름 붙인다. 스크린샷은 언어마다 SHOTS장(스토어 최대 5장)
const SHOTS = 5;
// 프로모션 타일은 언어별로 올릴 수 없다 — 하나가 모든 언어에 쓰인다(기본 언어 영어판을 쓴다).
// "The small tile and Marquee promo tile cannot be localized." https://developer.chrome.com/docs/webstore/cws-dashboard-listing (2026-10-08 확인)
const TILES = [['store/images/en/promo-small-440x280.png', '공통-작은타일-440x280.png'], ['store/images/en/promo-marquee-1400x560.png', '공통-마키-1400x560.png']];
const files = [[`release/${ZIP}`, `00-패키지-${ZIP}`], ['static/icons/icon128.png', '01-스토어아이콘-128.png']];
for (const lang of ['en', 'ko']) {
  for (let i = 1; i <= SHOTS; i++) files.push([`store/images/${lang}/screenshot-${i}.png`, `${lang}-스크린샷-${i}.png`]);
}
files.push(...TILES);
for (const [from, to] of files) copyFileSync(from, join(OUT, to));

// 2. 붙여 넣을 글 — store/*.md·_locales가 정본. 같은 함수로 지난 릴리스 태그의 글도 만들어 바뀐 칸을 찾는다
const after = (text, marker) => text.split(marker)[1].trim();
const plain = (s) => s.replaceAll('`', '');
function textsFrom(read) {
  const md = (name) => read(`store/${name}`);
  const privacy = md('privacy-practices.md');
  const reason = (perm) => plain(privacy.split('\n').find((l) => l.startsWith(`| ${perm}`)).split('|')[2].trim());
  const summary = (lang) => JSON.parse(read(`static/_locales/${lang}/messages.json`)).extDescription.message;
  return {
    sumEn: summary('en'),
    sumKo: summary('ko'),
    descEn: after(md('listing.en.md'), '## Description'),
    descKo: after(md('listing.ko.md'), '## 상세 설명'),
    single: after(privacy, '## Single purpose').split('\n## ')[0].trim(),
    storage: reason('`storage`'),
    host: reason('Host permission'),
    // 원격 코드 사유 — privacy-practices.md "## Remote code" 문단에서 굵은 답("No, …")을 뺀 나머지
    remote: plain(after(privacy, '## Remote code').split('\n## ')[0].replace(/^\*\*[^*]+\*\*\s*/, '').trim()),
    // 테스트 안내 — test-instructions.md 첫 줄의 안내 문구 뒤 전부(버전마다 바뀌는 문장을 코드에 박지 않는다)
    tests: plain(after(md('test-instructions.md'), 'Paste into the dashboard → Test instructions.')),
  };
}
const D = {
  ...textsFrom((path) => readFileSync(path, 'utf8')),
  privacyUrl: `${REPO}/blob/main/PRIVACY.md`,
  home: REPO,
  support: `${REPO}/issues`,
};
for (const [k, v] of Object.entries(D)) if (!v || v.length < 10) throw new Error(`글이 비었다: ${k}`);

// 처음 등록인가 업데이트인가 — 이 버전보다 앞선 릴리스 태그가 있으면 업데이트. `--first`면 처음 등록 화면
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
let prevTag = null;
const sinceAt = process.argv.indexOf('--since');
const since = sinceAt >= 0 ? process.argv[sinceAt + 1] : null;
if (since) {
  git('rev-parse', '--verify', `${since}^{commit}`); // 없는 커밋이면 여기서 멈춘다
  prevTag = since;
} else if (!process.argv.includes('--first')) {
  try {
    prevTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD');
    if (prevTag === `v${version}`) prevTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${prevTag}^`);
  } catch {
    prevTag = null;
  }
}
const UPDATE = prevTag !== null;
/** 화면에 보이는 비교 기준 — 태그, 또는 --since로 준 대시보드 초안의 커밋 */
const BASE = since ? `대시보드 초안(${since})` : prevTag;
const changed = new Set(Object.keys(D));
let imagesChanged = true;
if (UPDATE) {
  try {
    const prev = textsFrom((path) => git('show', `${prevTag}:${path}`));
    for (const k of Object.keys(prev)) if (prev[k] === D[k]) changed.delete(k);
    for (const k of ['privacyUrl', 'home', 'support']) changed.delete(k);
  } catch {
    // 지난 태그의 글 모양이 달라 못 읽으면 전부 바뀐 것으로 본다
  }
  try {
    execFileSync('git', ['diff', '--quiet', prevTag, '--', 'store/images', 'static/icons/icon128.png'], { stdio: 'ignore' });
    imagesChanged = false;
  } catch {
    imagesChanged = true;
  }
}

// 3. 입력 도우미
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tag = (key) => (UPDATE ? (changed.has(key) ? '<span class="tag new">바꿀 것</span>' : '<span class="tag same">그대로</span>') : '');
const copy = (key, label, rows) => {
  const v = D[key];
  if (UPDATE && !changed.has(key)) return `<p class="same-field">${tag(key)} ${esc(label)}</p>`;
  const r = rows ?? Math.min(18, v.split('\n').length + 1 + Math.floor(v.length / 110));
  return `<div class="field"><div class="fhead"><span>${tag(key)} ${esc(label)}</span><button data-copy="${key}">복사</button></div><textarea readonly rows="${r}" id="t-${key}">${esc(v)}</textarea></div>`;
};
const list = (...names) => `<ul class="files">${names.map((n) => `<li><code>${esc(n)}</code></li>`).join('')}</ul>`;
const shots = (lang) => list(...Array.from({ length: SHOTS }, (_, i) => `${lang}-스크린샷-${i + 1}.png`));
const kv = (...pairs) => `<div class="kv">${pairs.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>`;
const save = '<p class="note"><b>초안 저장</b>.</p>';
const images = (lang) =>
  UPDATE && !imagesChanged
    ? `<p class="same-field"><span class="tag same">그대로</span> 아이콘·스크린샷·프로모션 타일 — 다시 올리지 않아요(${esc(BASE)}와 같음)</p>`
    : lang === 'en'
      ? `<p>스토어 아이콘</p>${list('01-스토어아이콘-128.png')}<p>스크린샷 — 이 순서대로</p>${shots('en')}<p>작은 프로모션 타일(필수) · 마키 프로모션 타일 — <b>모든 언어 공통</b>(언어별로 못 올려요)</p>${list(...TILES.map(([, to]) => to))}`
      : `<p>스크린샷 — 이 순서대로</p>${shots(lang)}<p class="note">프로모션 타일(작은 타일·마키)은 언어별 칸이 없어요 — 영어 탭에 올린 <code>공통-…</code> 타일이 모든 언어에 쓰여요.</p>`;
const summaryNote = (lang) =>
  `<p class="note">요약은 패키지 매니페스트에서 자동으로 들어가요${UPDATE ? (changed.has(lang === 'en' ? 'sumEn' : 'sumKo') ? ' — <b>이번에 바뀜</b>' : ' — 그대로') : ''}: “${esc(lang === 'en' ? D.sumEn : D.sumKo)}”</p>`;
const privacyStep = `${copy('single', '단일 목적 설명')}${copy('storage', '권한 사유 — storage')}${copy('host', '권한 사유 — 호스트 권한 (https://github.com/*)')}${kv(['원격 코드 사용', '아니요, 원격 코드를 사용하지 않습니다'])}${copy('remote', '원격 코드 사유(칸이 나오면)')}<p><b>데이터 사용</b>: 수집 항목은 <b>아무것도 체크하지 않음</b>. 아래 인증 3개는 <b>모두 체크</b>.</p><p class="note">코멘트는 사용자가 쓴 글을 GitHub(지금 쓰는 사이트)로만 보낸다 — 대시보드가 이것도 신고하라고 하면 <b>Website content</b>를 체크(판단 메모: <code>store/privacy-practices.md</code>).</p>${copy('privacyUrl', '개인정보처리방침 URL', 1)}${save}`;
const submit = ['제출', '<p>오른쪽 위 <b>검토를 위해 제출</b> → 대화상자에서 <b>검토 후 자동으로 게시</b>를 켠 채 제출. 빠진 칸이 있으면 그 탭에 빨간 표시가 떠요. 심사는 보통 며칠, 길면 몇 주.</p>'];
const steps = UPDATE
  ? [
      ['항목 열고 새 패키지 올리기', `<p>${link(DASHBOARD, '개발자 대시보드')} → 항목 목록에서 <b>Markdown Diff Cat for GitHub</b>를 누른다 → 왼쪽 메뉴 <b>패키지</b> → <b>새 패키지 업로드</b> → <code>00-패키지-${esc(ZIP)}</code>를 끌어다 놓기 → 업로드가 끝나면 버전이 <b>${esc(version)}</b>인지 확인.</p><p class="note"><b>+ 새 항목</b>은 누르지 않아요 — 처음 등록할 때만 써요.</p>${summaryNote('en')}${summaryNote('ko')}`],
      ['스토어 등록정보 — 영어(기본)', `<p>왼쪽 메뉴 <b>스토어 등록정보</b>, 상단 언어가 <b>English</b>인 상태에서:</p>${copy('descEn', '설명')}${images('en')}<p class="same-field"><span class="tag same">그대로</span> 카테고리·언어·홈페이지·지원 URL</p>${save}`],
      ['스토어 등록정보 — 한국어', `<p>상단 언어 선택을 <b>한국어</b>로:</p>${copy('descKo', '설명')}${images('ko')}${save}`],
      ['개인정보 보호 관행', `<p>왼쪽 메뉴 <b>개인정보 보호 관행</b>:</p>${privacyStep}`],
      ['테스트 안내', copy('tests', '추가 안내 (사용자 이름·비밀번호 칸은 비워 둠)')],
      submit,
    ]
  : [
      ['계정 확인', '<p>왼쪽 메뉴 <b>계정</b> → <b>연락처 이메일</b>이 인증됐는지 봐요. 인증 전이면 게시가 막혀요. 오른쪽 위 게시자 계정도 확인.</p>'],
      ['새 항목 만들기', `<p>${link(DASHBOARD, '개발자 대시보드')}에서 <b>+ 새 항목</b> → <code>00-패키지-${esc(ZIP)}</code>를 끌어다 놓기. 이름·요약은 매니페스트에서 자동.</p>`],
      ['스토어 등록정보 — 영어(기본)', `<p>상단 언어가 <b>English</b>인 상태에서:</p>${copy('descEn', '설명')}${kv(['카테고리', '개발자 도구 (Developer Tools)'], ['언어', '영어 (English)'])}${images('en')}${copy('home', '홈페이지 URL', 1)}${copy('support', '지원 URL', 1)}<p class="note">성인용 콘텐츠를 물으면 <b>아니요</b>.</p>${save}`],
      ['스토어 등록정보 — 한국어', `<p>상단 언어 선택을 <b>한국어</b>로 (이름·요약은 한국어 매니페스트에서 자동):</p>${copy('descKo', '설명')}${images('ko')}${save}`],
      ['개인정보 보호 관행', privacyStep],
      ['배포', `${kv(['결제', '무료'], ['공개 상태', '공개'], ['배포 지역', '모든 지역'])}${save}`],
      ['테스트 안내', copy('tests', '추가 안내 (사용자 이름·비밀번호 칸은 비워 둠)')],
      submit,
    ];
const LABELS = { sumEn: '요약(영어, 자동)', sumKo: '요약(한국어, 자동)', descEn: '설명(영어)', descKo: '설명(한국어)', single: '단일 목적', storage: 'storage 사유', host: '호스트 권한 사유', remote: '원격 코드 사유', tests: '테스트 안내' };
const updateBanner = UPDATE
  ? `<div class="banner"><b>업데이트 ${esc(BASE)} → v${esc(version)}</b> — 기존 항목을 고쳐요(새 항목 아님). 바꿀 칸: ${[...changed].filter((k) => LABELS[k]).map((k) => LABELS[k]).join(' · ') || '없음'}${imagesChanged ? ' · 그림' : ''}. 나머지는 그대로 두면 돼요.</div>`
  : '';
const body = steps
  .map(([title, content], i) => `<section><label class="step"><input type="checkbox" data-step="${i}"><span class="n">${i + 1}</span><h2>${esc(title)}</h2></label><div class="content">${content}</div></section>`)
  .join('\n');
const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>스토어 등록 도우미</title>
<style>
:root { --bg:#f6f7fb; --card:#fff; --fg:#1d2433; --muted:#5c6780; --line:#dde2ee; --accent:#e8833a; --code:#eef1f7; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1b3e; --card:#13254f; --fg:#eef2ff; --muted:#9fb0d6; --line:#2a3f73; --accent:#f6a04d; --code:#1c3163; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system,"Apple SD Gothic Neo",system-ui,sans-serif; }
main { max-width:860px; margin:0 auto; padding:28px 16px 80px; }
header h1 { font-size:24px; margin:0 0 6px; } header p { color:var(--muted); margin:0 0 18px; }
section { background:var(--card); border:1px solid var(--line); border-radius:12px; margin:12px 0; padding:14px 16px; }
.step { display:flex; align-items:center; gap:10px; cursor:pointer; }
.step h2 { font-size:17px; margin:0; }
.step .n { width:26px; height:26px; border-radius:50%; background:var(--accent); color:#1b0f00; font-weight:800; display:grid; place-items:center; font-size:13px; flex:none; }
.step input { width:18px; height:18px; accent-color:var(--accent); }
section.done { opacity:.55; } section.done .content { display:none; }
.content { margin-top:10px; } .content p { margin:8px 0; }
.field { margin:10px 0; }
.fhead { display:flex; justify-content:space-between; align-items:center; font-weight:700; font-size:13px; color:var(--muted); margin-bottom:4px; }
textarea { width:100%; resize:vertical; background:var(--code); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font:13px/1.5 ui-monospace,Menlo,monospace; }
button { background:var(--accent); color:#1b0f00; border:0; border-radius:999px; padding:4px 14px; font-weight:800; cursor:pointer; }
button.ok { background:#3fb950; }
code { background:var(--code); padding:1px 6px; border-radius:4px; font-size:13px; }
.files { margin:4px 0 8px; padding-left:20px; }
.banner { background:var(--card); border:2px solid var(--accent); border-radius:12px; padding:12px 16px; margin:12px 0; }
.tag { display:inline-block; border-radius:999px; padding:0 8px; font-size:12px; font-weight:800; margin-right:4px; }
.tag.new { background:var(--accent); color:#1b0f00; } .tag.same { border:1px solid var(--line); color:var(--muted); }
.same-field { color:var(--muted); font-size:14px; }
.kv { display:grid; grid-template-columns:max-content 1fr; gap:4px 14px; margin:8px 0; } .kv span { color:var(--muted); }
.note { color:var(--muted); font-size:14px; }
a { color:var(--accent); font-weight:700; }
.links { display:flex; flex-wrap:wrap; gap:10px; margin:10px 0 4px; }
.links a { border:1px solid var(--accent); border-radius:999px; padding:6px 14px; text-decoration:none; }
</style></head><body><main>
<header><h1>Markdown Diff Cat ${esc(version)} — 스토어 등록 도우미</h1>
<p>웹 스토어 대시보드는 확장·자동화 도구가 조작할 수 없어서 직접 입력해요. 칸마다 <b>복사</b> → 붙여넣기. 올릴 파일은 이 파일이 있는 폴더에서 끌어다 놓기. 끝낸 단계는 체크하면 접혀요.</p>
<p class="links">${link(DASHBOARD, '개발자 대시보드 열기 ↗')}${link(LISTING, '스토어 페이지 ↗')}</p>
<p class="note">대시보드가 다른 Google 계정으로 열리면 오른쪽 위 프로필에서 게시자 계정으로 바꾸세요.</p></header>
${updateBanner}
${body}
</main>
<script>
const D = ${JSON.stringify(D)};
document.querySelectorAll('button[data-copy]').forEach((b) => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(D[b.dataset.copy]); } catch { const t = document.getElementById('t-' + b.dataset.copy); t.select(); document.execCommand('copy'); }
  b.textContent = '복사됨'; b.classList.add('ok'); setTimeout(() => { b.textContent = '복사'; b.classList.remove('ok'); }, 1500);
}));
const KEY = 'mdc-store-steps-${esc(version)}';
let done = []; try { done = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
document.querySelectorAll('input[data-step]').forEach((c) => {
  const sec = c.closest('section');
  c.checked = done.includes(c.dataset.step); sec.classList.toggle('done', c.checked);
  c.addEventListener('change', () => {
    sec.classList.toggle('done', c.checked);
    done = [...document.querySelectorAll('input[data-step]:checked')].map((x) => x.dataset.step);
    try { localStorage.setItem(KEY, JSON.stringify(done)); } catch {}
  });
});
</script></body></html>`;
writeFileSync(join(OUT, 'guide.html'), page);
console.log(`${OUT}/ — 파일 ${files.length}개 + guide.html`);
console.log(`열기: open -R "${join(OUT, files[0][1])}" && open ${join(OUT, 'guide.html')}`);
