// 스토어 대시보드에 올릴 것을 한 폴더로: 패키지·아이콘·언어별 그림(번호 붙인 이름) + 칸마다 복사 버튼이 있는 입력 도우미(guide.html)
// 대시보드는 확장(Claude in Chrome 포함)·내장 브라우저가 조작할 수 없다 — 사람이 이 도우미를 보며 붙여 넣는다(2026-10-07)
// 사용: pnpm store:upload  (pnpm package로 ZIP을 먼저 만든다) → release/store-upload/
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
const OUT = 'release/store-upload';
const ZIP = `markdown-diff-cat-for-github-${version}.zip`;
const REPO = 'https://github.com/drum-grammer/GITHUB-MD-DIFF';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. 올릴 파일 — 대시보드에서 넣는 순서대로 이름 붙인다
const files = [[`release/${ZIP}`, `00-패키지-${ZIP}`], ['static/icons/icon128.png', '01-스토어아이콘-128.png']];
for (const lang of ['en', 'ko']) {
  for (let i = 1; i <= 4; i++) files.push([`store/images/${lang}/screenshot-${i}.png`, `${lang}-스크린샷-${i}.png`]);
  files.push([`store/images/${lang}/promo-small-440x280.png`, `${lang}-작은타일-440x280.png`]);
  files.push([`store/images/${lang}/promo-marquee-1400x560.png`, `${lang}-마키-1400x560.png`]);
}
for (const [from, to] of files) copyFileSync(from, join(OUT, to));

// 2. 붙여 넣을 글 — store/*.md가 정본
const md = (name) => readFileSync(`store/${name}`, 'utf8');
const after = (text, marker) => text.split(marker)[1].trim();
const plain = (s) => s.replaceAll('`', '');
const privacy = md('privacy-practices.md');
const reason = (perm) => plain(privacy.split('\n').find((l) => l.startsWith(`| ${perm}`)).split('|')[2].trim());
const D = {
  descEn: after(md('listing.en.md'), '## Description'),
  descKo: after(md('listing.ko.md'), '## 상세 설명'),
  single: after(privacy, '## Single purpose').split('\n## ')[0].trim(),
  storage: reason('`storage`'),
  host: reason('Host permission'),
  // 원격 코드 사유 — privacy-practices.md "## Remote code" 문단에서 굵은 답("No, …")을 뺀 나머지
  remote: plain(after(privacy, '## Remote code').split('\n## ')[0].replace(/^\*\*[^*]+\*\*\s*/, '').trim()),
  privacyUrl: `${REPO}/blob/main/PRIVACY.md`,
  home: REPO,
  support: `${REPO}/issues`,
  // 테스트 안내 — test-instructions.md 첫 줄의 안내 문구 뒤 전부(버전마다 바뀌는 문장을 코드에 박지 않는다)
  tests: plain(after(md('test-instructions.md'), 'Paste into the dashboard → Test instructions.')),
};
for (const [k, v] of Object.entries(D)) if (!v || v.length < 10) throw new Error(`글이 비었다: ${k}`);

// 3. 입력 도우미
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const copy = (key, label, rows) => {
  const v = D[key];
  const r = rows ?? Math.min(18, v.split('\n').length + 1 + Math.floor(v.length / 110));
  return `<div class="field"><div class="fhead"><span>${esc(label)}</span><button data-copy="${key}">복사</button></div><textarea readonly rows="${r}" id="t-${key}">${esc(v)}</textarea></div>`;
};
const list = (...names) => `<ul class="files">${names.map((n) => `<li><code>${esc(n)}</code></li>`).join('')}</ul>`;
const shots = (lang) => list(...[1, 2, 3, 4].map((i) => `${lang}-스크린샷-${i}.png`));
const kv = (...pairs) => `<div class="kv">${pairs.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>`;
const save = '<p class="note"><b>초안 저장</b>.</p>';
const steps = [
  ['계정 확인', '<p>왼쪽 메뉴 <b>계정</b> → <b>연락처 이메일</b>이 인증됐는지 봐요. 인증 전이면 게시가 막혀요. 오른쪽 위 게시자 계정도 확인.</p>'],
  ['새 항목 만들기(처음) · 새 패키지(업데이트)', `<p><b>+ 새 항목</b>(업데이트면 항목 → <b>패키지</b> → <b>새 패키지 업로드</b>) → <code>00-패키지-${esc(ZIP)}</code>를 끌어다 놓기. 이름·요약은 매니페스트에서 자동.</p>`],
  ['스토어 등록정보 — 영어(기본)', `<p>상단 언어가 <b>English</b>인 상태에서:</p>${copy('descEn', '설명')}${kv(['카테고리', '개발자 도구 (Developer Tools)'], ['언어', '영어 (English)'])}<p>스토어 아이콘</p>${list('01-스토어아이콘-128.png')}<p>스크린샷 — 이 순서대로</p>${shots('en')}<p>작은 프로모션 타일(필수) · 마키 프로모션 타일</p>${list('en-작은타일-440x280.png', 'en-마키-1400x560.png')}${copy('home', '홈페이지 URL', 1)}${copy('support', '지원 URL', 1)}<p class="note">성인용 콘텐츠를 물으면 <b>아니요</b>.</p>${save}`],
  ['스토어 등록정보 — 한국어', `<p>상단 언어 선택을 <b>한국어</b>로 (이름·요약은 한국어 매니페스트에서 자동):</p>${copy('descKo', '설명')}<p>스크린샷 — 이 순서대로</p>${shots('ko')}<p>작은 프로모션 타일 · 마키 프로모션 타일</p>${list('ko-작은타일-440x280.png', 'ko-마키-1400x560.png')}<p class="note">언어별 그림 칸이 없으면 설명만 넣어도 돼요(영어 그림이 쓰여요).</p>${save}`],
  ['개인정보 보호 관행', `${copy('single', '단일 목적 설명')}${copy('storage', '권한 사유 — storage')}${copy('host', '권한 사유 — 호스트 권한 (https://github.com/*)')}${kv(['원격 코드 사용', '아니요, 원격 코드를 사용하지 않습니다'])}${copy('remote', '(사유 칸이 나오면)')}<p><b>데이터 사용</b>: 수집 항목은 <b>아무것도 체크하지 않음</b>. 아래 인증 3개는 <b>모두 체크</b>.</p><p class="note">코멘트는 사용자가 쓴 글을 GitHub(지금 쓰는 사이트)로만 보낸다 — 대시보드가 이것도 신고하라고 하면 <b>Website content</b>를 체크(판단 메모: <code>store/privacy-practices.md</code>).</p>${copy('privacyUrl', '개인정보처리방침 URL', 1)}${save}`],
  ['배포', `${kv(['결제', '무료'], ['공개 상태', '공개'], ['배포 지역', '모든 지역'])}${save}`],
  ['테스트 안내', copy('tests', '추가 안내 (사용자 이름·비밀번호 칸은 비워 둠)')],
  ['제출', '<p>오른쪽 위 <b>검토를 위해 제출</b> → 대화상자에서 <b>검토 후 자동으로 게시</b>를 켠 채 제출. 빠진 칸이 있으면 그 탭에 빨간 표시가 떠요. 심사는 보통 며칠, 길면 몇 주.</p>'],
];
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
.kv { display:grid; grid-template-columns:max-content 1fr; gap:4px 14px; margin:8px 0; } .kv span { color:var(--muted); }
.note { color:var(--muted); font-size:14px; }
</style></head><body><main>
<header><h1>Markdown Diff Cat ${esc(version)} — 스토어 등록 도우미</h1>
<p>웹 스토어 대시보드는 확장·자동화 도구가 조작할 수 없어서 직접 입력해요. 칸마다 <b>복사</b> → 붙여넣기. 올릴 파일은 이 파일이 있는 폴더에서 끌어다 놓기. 끝낸 단계는 체크하면 접혀요.</p></header>
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
