// 스토어 이미지 만들기: 캡처(store/build/capture/<lang>/)를 넣은 스크린샷 1280×800 4장, 홍보 타일 440×280·1400×560, README용 GIF
// 사용: node store/compose.mjs [en|ko]  (먼저 node store/capture.mjs <lang>)
// 스토어 캐러셀은 1280×800을 절반 가까이로 줄여 보여 준다 — 캡처 글자는 1배 이상으로 키우고, 막대는 강조 상자와 글씨 딱지로 짚는다
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LANG = process.argv[2] ?? 'en';
const CAP = resolve(`store/build/capture/${LANG}`);
const OUT = resolve(`store/build/${LANG}`);
const FRAMES = join(OUT, 'gif-frames');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const png = (name) => `data:image/png;base64,${readFileSync(join(CAP, `${name}.png`)).toString('base64')}`;
const icon = `data:image/svg+xml;base64,${readFileSync('static/icons/icon.svg').toString('base64')}`;
const iconOff = `data:image/svg+xml;base64,${readFileSync('static/icons/icon-off.svg').toString('base64')}`;
// 캡처는 deviceScaleFactor 2 — CSS 크기는 이미지 픽셀의 절반
const size = (name) => {
  const b = readFileSync(join(CAP, `${name}.png`));
  return { w: b.readUInt32BE(16) / 2, h: b.readUInt32BE(20) / 2 };
};
// capture.mjs가 적은 위치(파일 요소 기준 CSS px): 본문·바뀐 블록·접기 막대
const data = (name) => JSON.parse(readFileSync(join(CAP, `${name}.json`), 'utf8'));
const before = data('before');
const after = data('after');
const expanded = data('after-expanded');
const blocksOf = (fold) => Number(fold.label.match(/\d+/)[0]);
const rows = data('table');
// 확대 화면은 첫 막대 바로 아래(2. Goals)부터 — 위 가장자리에 막대 조각이 걸리지 않게
const START = after.folds[0].y + after.folds[0].h + 8;
// 확장 없는 화면에서 같은 자리: 두 번째 바뀐 블록(2. Goals 목록)으로 맞춘다
const START_BEFORE = START - (after.changes[1].y - before.changes[1].y);

const T = {
  en: {
    heroTitle: 'Long Markdown docs in pull requests?<br>See only what changed.',
    heroSub: 'Rich diff shows the whole file. Source diff buries changes in syntax. Markdown Diff Cat shows only what changed — rendered.',
    github: 'GitHub',
    cat: 'Diff Cat',
    sameScale: 'Same document,<br>same scale',
    legendChange: 'Changed',
    legendFold: 'Folded',
    rows: (a, b) => `${a} rows → ${b}`,
    rowsSub: 'Two tables become one',
    px: (n) => `${Math.round(n).toLocaleString('en-US')} px`,
    pillFold: (n) => `${n} unchanged blocks → 1 line`,
    pillClick: 'Click to expand just this part',
    foldTitle: 'Unchanged sections fold into one line',
    foldSub: 'Each bar shows how many blocks it hides and the last heading inside. Click a bar to peek, or Expand all to open the whole file.',
    tableTitle: 'Tables show only the rows that changed',
    tableSub: 'One changed row used to mean two full tables. Now it is one table: changed cells as old → new, added and removed rows in color.',
    tableGitHub: 'GitHub rich diff · old table + new table',
    tableOurs: 'Markdown Diff Cat · only what changed',
    commentTitle: 'Comment right on the rendered document',
    commentSub: 'Hover over a block and click +, or drag across blocks for a range. The box works like GitHub\'s own and posts an ordinary review comment on the right source line.',
    commentFormTitle: 'Suggest the exact wording',
    commentFormText: 'The first toolbar button adds a suggestion with the original lines. The author applies it in one click',
    commentThreadTitle: 'Threads stay under their block',
    commentThreadText: 'Reply and resolve without leaving the rendered view',
    wayTitle: 'Stays out of your way',
    way: [
      'Opens the rendered view for you on every Markdown file',
      'Press <code>]</code> <code>[</code> to jump between changes, <code>}</code> <code>{</code> between threads',
      'Click <code>&lt;&gt;</code> for the source diff — it will not switch that file back',
      'Color icon = on, gray icon = off. One click to switch',
      'No data collected. Talks only to GitHub, with your own session',
    ],
    on: 'On',
    off: 'Off',
    tagline: 'See only what changed in Markdown pull requests',
    // 큰 홍보 타일 — 줄은 직접 나눈다(자동 줄바꿈은 낱말 중간·어색한 자리에서 끊긴다)
    taglineLong: 'Reviewing Markdown in a PR?<br>See only the changes, rendered,<br>and review right there',
    unofficial: 'Unofficial. Not affiliated with GitHub.',
    gif: [
      (px) => `GitHub rich diff: the whole document · ${px}`,
      (px) => `Markdown Diff Cat: only the changes · ${px}`,
      () => 'Click a bar to expand just that part',
      () => 'GitHub: one changed row, two full tables',
      () => 'Markdown Diff Cat: only the rows that changed',
    ],
  },
  ko: {
    heroTitle: 'PR 속 긴 마크다운 문서,<br>바뀐 부분만 보세요',
    heroSub: '렌더링 보기는 파일 전체가 펼쳐지고, 원문 보기는 문법 기호에 묻혀 읽기 어려워요. Markdown Diff Cat은 렌더링된 채로 바뀌지 않은 곳을 접어 줍니다.',
    github: 'GitHub',
    cat: 'Diff Cat',
    sameScale: '같은 문서,<br>같은 축척',
    legendChange: '바뀐 곳',
    legendFold: '접힌 곳',
    rows: (a, b) => `${a}행 → ${b}행`,
    rowsSub: '표 두 개가 하나로',
    px: (n) => `${Math.round(n).toLocaleString('ko-KR')}px`,
    pillFold: (n) => `바뀌지 않은 블록 ${n}개 → 한 줄`,
    pillClick: '누르면 그 자리만 펼쳐져요',
    foldTitle: '바뀌지 않은 구간은 한 줄로 접혀요',
    foldSub: '막대에 숨긴 블록 수와 마지막 제목이 보여요. 누르면 그 자리만, 모두 펼치기를 누르면 파일 전체가 펼쳐져요.',
    tableTitle: '표는 바뀐 행만 보여 줘요',
    tableSub: '행 하나만 바뀌어도 GitHub는 표 두 개를 통째로 보여 줘요. 여기서는 표 하나에 바뀐 칸은 이전 → 이후로, 추가·삭제된 행은 색으로.',
    tableGitHub: 'GitHub 렌더링 보기 · 옛 표 + 새 표',
    tableOurs: 'Markdown Diff Cat · 바뀐 것만',
    commentTitle: '렌더링된 문서에 바로 코멘트',
    commentSub: '블록에 마우스를 올리고 +를 누르거나, 여러 블록을 끌어 범위로 달아요. GitHub 상자와 같은 상자로, 맞는 원문 줄에 보통의 리뷰 코멘트를 올려요.',
    commentFormTitle: '고칠 문장을 제안으로',
    commentFormText: '도구 막대 첫 버튼이 원래 줄을 담은 제안을 넣어요. 작성자는 한 번에 반영해요',
    commentThreadTitle: '스레드는 그 블록 아래에',
    commentThreadText: '렌더링 보기에서 바로 답글·해결',
    wayTitle: '방해하지 않아요',
    way: [
      '마크다운 파일은 열자마자 렌더링 보기로',
      '<code>]</code> <code>[</code>로 바뀐 곳, <code>}</code> <code>{</code>로 스레드 사이를 이동',
      '<code>&lt;&gt;</code>로 원문 보기를 고르면 그 파일은 되돌리지 않아요',
      '컬러 아이콘 = 켜짐, 회색 아이콘 = 꺼짐. 한 번에 전환',
      '수집하는 데이터가 없어요. GitHub하고만, 내 로그인 세션으로 통신해요',
    ],
    on: '켜짐',
    off: '꺼짐',
    tagline: '마크다운 PR, 바뀐 부분만 보기',
    taglineLong: 'PR 마크다운 리뷰할 때<br>변경된 부분만 렌더링해서 보고<br>바로 리뷰하기',
    unofficial: 'GitHub와 관련 없는 비공식 도구입니다.',
    gif: [
      (px) => `GitHub 렌더링 보기: 문서 전체 · ${px}`,
      (px) => `Markdown Diff Cat: 바뀐 곳만 · ${px}`,
      () => '막대를 누르면 그 자리만 펼쳐요',
      () => 'GitHub: 한 행이 바뀌어도 표 두 개를 통째로',
      () => 'Markdown Diff Cat: 바뀐 행만 한 표로',
    ],
  },
}[LANG];

const ORANGE = '#f6a04d';
const FONT = LANG === 'ko' ? '"Apple SD Gothic Neo", "Pretendard", system-ui, sans-serif' : '-apple-system, "Segoe UI", system-ui, sans-serif';
const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: ${FONT}; color: #f0f4ff; background: #0d1b3e; -webkit-font-smoothing: antialiased; position: relative;${LANG === 'ko' ? ' word-break: keep-all;' : ''} }
  .abs { position: absolute; }
  .accent { color: ${ORANGE}; }
  .muted { color: #9aa6c4; }
  .title { font-weight: 800; line-height: 1.2; letter-spacing: -0.01em; }
  .sub { color: #c9d6ff; line-height: 1.5; }
  .shot { overflow: hidden; border-radius: 12px; border: 1px solid #2c3e6b; background: #0d1117; box-shadow: 0 12px 40px rgba(0,0,0,.35); position: absolute; }
  .shot > img { position: absolute; display: block; }
  .mark { position: absolute; border: 3px solid ${ORANGE}; border-radius: 8px; box-shadow: 0 0 0 5px rgba(246,160,77,.22); }
  .mark.dashed { border-style: dashed; box-shadow: none; background: rgba(246,160,77,.06); }
  .pill { position: absolute; background: ${ORANGE}; color: #2b1600; font-weight: 800; padding: .3em .8em; border-radius: 999px; white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,.4); }
  .label { font-size: 18px; font-weight: 700; color: #c9d6ff; }
  .strip { position: absolute; border-radius: 4px; overflow: visible; background: #0d1117; outline: 1px solid #2c3e6b; }
  .strip > img { display: block; opacity: .9; }
  .tick { position: absolute; left: 0; right: 0; }
  code { font-family: ui-monospace, Menlo, monospace; background: #22305a; padding: 1px 6px; border-radius: 4px; }
`;

// 본문 글자 칸(좌우 여백 제외) — 확대해도 잘리지 않게 이 폭으로 자른다
const COL = { x: after.body.x + 8, w: after.body.w - 16 };

// 캡처의 CSS 영역(x, y, w, h)을 scale배로 left·top 자리에 보여 준다
// marks: 강조 상자 [{x, y, w, h, dashed}] · pills: 글씨 딱지 [{x, y, text, align}] — 모두 캡처 CSS 좌표
function view(name, { left, top, x = COL.x, y, w = COL.w, h, scale, marks = [], pills = [], pillSize = 18 }) {
  const fw = size(name).w;
  const at = (cx, cy) => [(cx - x) * scale, (cy - y) * scale];
  const m = marks
    .map((r) => {
      const [l, t] = at(r.x, r.y);
      return `<div class="mark ${r.dashed ? 'dashed' : ''}" style="left:${l - 5}px;top:${t - 5}px;width:${r.w * scale + 10}px;height:${r.h * scale + 10}px"></div>`;
    })
    .join('');
  const p = pills
    .map((q) => {
      const [l, t] = at(q.x, q.y);
      const tx = q.align === 'right' ? '-100%' : '0';
      return `<div class="pill" style="left:${l}px;top:${t}px;font-size:${pillSize}px;transform:translate(${tx},-50%)">${q.text}</div>`;
    })
    .join('');
  return `<div class="shot" style="left:${left}px;top:${top}px;width:${w * scale}px;height:${h * scale}px"><img src="${png(name)}" style="left:${-x * scale}px;top:${-y * scale}px;width:${fw * scale}px">${m}${p}</div>`;
}

// 파일 전체를 k배로 줄인 띠: 초록 = 바뀐 블록, 주황 = 접기 막대, 흰 테 = 지금 보이는 곳
function strip(name, m, { left, top, k, box }) {
  const s = size(name);
  const tick = (r, color) => `<div class="tick" style="top:${r.y * k}px;height:${Math.max(3, r.h * k)}px;background:${color}"></div>`;
  const ticks = [...m.changes.map((r) => tick(r, 'rgba(63,185,80,.85)')), ...m.folds.map((r) => tick(r, ORANGE))].join('');
  const b = box ? `<div class="abs" style="left:-4px;right:-4px;top:${box.y * k - 2}px;height:${box.h * k + 4}px;border:2px solid #fff;border-radius:3px"></div>` : '';
  return `<div class="strip" style="left:${left}px;top:${top}px;width:${s.w * k}px;height:${s.h * k}px"><img src="${png(name)}" style="width:${s.w * k}px;height:${s.h * k}px">${ticks}${b}</div>`;
}

// 접기 막대 오른쪽 끝에 딱지
const foldPill = (f, text) => ({ x: f.x + f.w - 12, y: f.y + f.h / 2, text, align: 'right' });
const inRange = (r, y, h) => r.y >= y && r.y + r.h <= y + h;

const pages = [];

// 1. 첫 장: 같은 축척의 문서 띠(전·후) + 확대해 본 모습
{
  const top = 268;
  const k = (760 - top) / size('before').h;
  const a = size('before');
  const b = size('after');
  const colA = 116;
  const colB = 246;
  const lens = { left: 340, top: 222, w: 884, h: 538 };
  const scale = lens.w / COL.w;
  const region = { y: START, h: lens.h / scale };
  const folds = after.folds.filter((f) => inRange(f, region.y, region.h));
  const bRight = colB + (b.w * k) / 2;
  const y1 = top + region.y * k;
  const y2 = top + (region.y + region.h) * k;
  pages.push(['screenshot-1.png', 1280, 800, `
    <img class="abs" src="${icon}" style="left:56px;top:40px;width:76px;height:76px">
    <div class="abs title" style="left:152px;top:38px;font-size:38px">${T.heroTitle}</div>
    <div class="abs sub" style="left:56px;top:144px;width:1168px;font-size:19px">${T.heroSub}</div>
    <div class="abs" style="left:${colA - 60}px;top:214px;width:120px;text-align:center"><div class="muted" style="font-size:15px;font-weight:600">${T.github}</div><div style="font-size:20px;font-weight:800">${T.px(a.h)}</div></div>
    <div class="abs accent" style="left:${colB - 60}px;top:214px;width:120px;text-align:center"><div style="font-size:15px;font-weight:600">${T.cat}</div><div style="font-size:20px;font-weight:800">${T.px(b.h)}</div></div>
    ${strip('before', before, { left: colA - (a.w * k) / 2, top, k })}
    ${strip('after', after, { left: colB - (b.w * k) / 2, top, k, box: region })}
    <div class="abs muted" style="left:${colB - 70}px;top:${top + b.h * k + 14}px;width:140px;text-align:center;font-size:13px;line-height:1.35">${T.sameScale}</div>
    <div class="abs muted" style="left:${colB - 60}px;top:${top + b.h * k + 70}px;width:120px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:13px">
      ${[['#3fb950', T.legendChange], [ORANGE, T.legendFold]].map(([c, t]) => `<div style="display:flex;align-items:center;gap:6px;width:76px"><i style="width:12px;height:12px;border-radius:2px;background:${c}"></i>${t}</div>`).join('')}
    </div>
    <svg class="abs" style="left:0;top:0" width="1280" height="800"><polygon points="${bRight + 4},${y1} ${lens.left},${lens.top + 12} ${lens.left},${lens.top + lens.h - 12} ${bRight + 4},${y2}" fill="rgba(246,160,77,.10)" stroke="rgba(246,160,77,.55)" stroke-width="1.5"/></svg>
    ${view('after', { left: lens.left, top: lens.top, y: region.y, h: region.h, scale, marks: folds, pills: folds.filter((f) => blocksOf(f) > 1).map((f) => foldPill(f, T.pillFold(blocksOf(f)))), pillSize: 17 })}
  `]);
}

// 3. 접기: 막대 두 개가 보이는 곳을 크게
{
  const scale = 1168 / COL.w;
  const h = 584 / scale;
  const [f2, f3] = after.folds.filter((f) => blocksOf(f) > 1);
  const y = f2.y - 12;
  pages.push(['screenshot-3.png', 1280, 800, `
    <div class="abs title" style="left:56px;top:46px;font-size:38px">${T.foldTitle}</div>
    <div class="abs sub" style="left:56px;top:104px;width:1168px;font-size:19px">${T.foldSub}</div>
    ${view('after', { left: 56, top: 176, y, h, scale, marks: [f2, f3].filter((f) => inRange(f, y, h)), pills: [foldPill(f2, T.pillFold(blocksOf(f2))), foldPill(f3, T.pillClick)].filter((q) => q.y < y + h), pillSize: 20 })}
  `]);
}

// 4. 표: GitHub(왼쪽) → Markdown Diff Cat(오른쪽)
{
  const o = size('table-original');
  const t = size('table');
  const s = Math.min(1.25, 470 / o.h, (1168 - 70) / (o.w + t.w));
  const leftW = o.w * s;
  const rightL = 56 + leftW + 70;
  const shot = (name, left, top, w, h) => `<div class="shot" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px"><img src="${png(name)}" style="left:0;top:0;width:${w}px"></div>`;
  pages.push(['screenshot-4.png', 1280, 800, `
    <div class="abs title" style="left:56px;top:46px;font-size:38px">${T.tableTitle}</div>
    <div class="abs sub" style="left:56px;top:104px;width:1168px;font-size:19px">${T.tableSub}</div>
    <div class="abs label" style="left:56px;top:206px">${T.tableGitHub}</div>
    ${shot('table-original', 56, 240, leftW, o.h * s)}
    <div class="abs accent" style="left:${56 + leftW + 14}px;top:${240 + (t.h * s) / 2 - 24}px;font-size:40px;font-weight:800">→</div>
    <div class="abs label accent" style="left:${rightL}px;top:206px">${T.tableOurs}</div>
    ${shot('table', rightL, 240, t.w * s, t.h * s)}
    <div class="abs" style="left:${rightL}px;top:${240 + t.h * s + 48}px">
      <div class="accent" style="font-size:46px;font-weight:800;letter-spacing:-0.01em">${T.rows(rows.original, rows.merged)}</div>
      <div class="sub" style="font-size:19px;margin-top:4px">${T.rowsSub}</div>
    </div>
  `]);
}

// 2. 렌더링 보기에서 코멘트: 큰 화면 한 장(위 문단의 스레드 + 아래 문단에 쓰는 중인 입력 상자) + 오른쪽 설명
{
  const c = size('comment');
  const m = data('comment');
  const k = Math.min(860 / c.w, 590 / c.h);
  const left = 56;
  const top = 178;
  const box = (r) => `<div class="mark" style="left:${left + r.x * k - 6}px;top:${top + r.y * k - 6}px;width:${r.w * k + 12}px;height:${r.h * k + 12}px"></div>`;
  const note = (r, title, text) => `<div class="abs" style="left:${left + c.w * k + 40}px;width:${1280 - (left + c.w * k + 40) - 40}px;top:${top + (r.y + r.h / 2) * k - 40}px"><div class="accent" style="font-size:22px;font-weight:800;line-height:1.25">${title}</div><div class="sub" style="font-size:16px;margin-top:6px">${text}</div></div>`;
  pages.push(['screenshot-2.png', 1280, 800, `
    <div class="abs title" style="left:56px;top:40px;font-size:38px">${T.commentTitle}</div>
    <div class="abs sub" style="left:56px;top:98px;width:1168px;font-size:19px">${T.commentSub}</div>
    <div class="shot" style="left:${left}px;top:${top}px;width:${c.w * k}px;height:${c.h * k}px"><img src="${png('comment')}" style="left:0;top:0;width:${c.w * k}px"></div>
    ${box(m.thread)}${box(m.form)}
    ${note(m.thread, T.commentThreadTitle, T.commentThreadText)}
    ${note(m.form, T.commentFormTitle, T.commentFormText)}
  `]);
}

// 5. 방해하지 않아요 + 켜짐·꺼짐 아이콘
pages.push(['screenshot-5.png', 1280, 800, `
  <div style="padding:60px 64px;display:flex;gap:56px;align-items:center;height:100%">
    <div style="flex:1">
      <div class="title" style="font-size:42px;margin-bottom:32px">${T.wayTitle}</div>
      <ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:22px;font-size:23px;line-height:1.4">
        ${T.way.map((w) => `<li style="display:flex;gap:14px"><span class="accent" style="font-weight:800">✓</span><span>${w}</span></li>`).join('')}
      </ul>
    </div>
    <div style="width:330px;display:flex;flex-direction:column;gap:28px;align-items:center">
      <div style="display:flex;gap:36px">
        <div style="text-align:center"><img src="${icon}" width="128" height="128"><div style="margin-top:10px;font-size:20px;font-weight:700">${T.on}</div></div>
        <div style="text-align:center"><img src="${iconOff}" width="128" height="128"><div class="muted" style="margin-top:10px;font-size:20px;font-weight:700">${T.off}</div></div>
      </div>
      <div style="display:flex;gap:14px;background:#35363a;border-radius:12px;padding:14px 18px;align-items:center">
        <span style="width:24px;height:24px;border-radius:50%;background:#9aa0a6;opacity:.5"></span>
        <img src="${icon}" width="32" height="32">
        <span style="width:24px;height:24px;border-radius:5px;background:#9aa0a6;opacity:.5"></span>
      </div>
      <div class="muted" style="font-size:15px;text-align:center">${T.unofficial}</div>
    </div>
  </div>`]);

// 작은 홍보 타일: 아이콘과 이름이 주인공, 글은 짧게
pages.push(['promo-small-440x280.png', 440, 280, `
  <div style="height:100%;display:flex;align-items:center;gap:20px;padding:0 24px">
    <img src="${icon}" width="128" height="128">
    <div>
      <div class="title" style="font-size:30px;line-height:1.05">Markdown<br>Diff Cat</div>
      <div class="muted" style="font-size:15px;margin-top:4px">for GitHub</div>
      <div class="accent" style="font-size:17px;margin-top:12px;line-height:1.3;font-weight:700">${T.tagline}</div>
    </div>
  </div>`]);

// 큰 홍보 타일: 이름 + 막대를 짚은 확대 화면
{
  const scale = 750 / COL.w;
  const h = 430 / scale;
  const y = START;
  const folds = after.folds.filter((f) => inRange(f, y, h));
  pages.push(['promo-marquee-1400x560.png', 1400, 560, `
    <img class="abs" src="${icon}" style="left:64px;top:96px;width:120px;height:120px">
    <div class="abs title" style="left:64px;top:236px;font-size:50px">Markdown Diff Cat</div>
    <div class="abs muted" style="left:66px;top:302px;font-size:21px">for GitHub</div>
    <div class="abs accent" style="left:64px;top:350px;width:470px;font-size:24px;font-weight:700;line-height:1.35">${T.taglineLong}</div>
    ${view('after', { left: 590, top: 65, y, h, scale, marks: folds, pills: folds.filter((f) => blocksOf(f) > 1).map((f) => foldPill(f, T.pillFold(blocksOf(f)))), pillSize: 16 })}
  `]);
}

// README용 GIF 장면 840×525: 위에 설명 한 줄, 가운데 1배 화면, 오른쪽에 문서 길이 띠
const G = { w: 840, h: 525, top: 66, left: 20, viewW: 740, viewH: 439 };
const gifScenes = [];
const kMini = G.viewH / size('before').h;
const scene = (caption, body) => gifScenes.push(`
  <img class="abs" src="${icon}" style="left:20px;top:15px;width:36px;height:36px">
  <div class="abs" style="left:66px;top:17px;font-size:22px;font-weight:700">${caption}</div>
  ${body}`);
const docScene = (name, m, caption, y, marks = [], pills = []) =>
  scene(caption, `
    ${view(name, { left: G.left, top: G.top, y, h: G.viewH * (COL.w / G.viewW), scale: G.viewW / COL.w, marks, pills, pillSize: 15 })}
    ${strip(name, m, { left: 788 - (size(name).w * kMini) / 2 + 10, top: G.top, k: kMini, box: { y, h: G.viewH * (COL.w / G.viewW) } })}`);
const tableScene = (name, caption) => {
  const s = size(name);
  const k = Math.min(1.15, (G.h - G.top - 24) / s.h);
  return scene(caption, `<div class="shot" style="left:${(G.w - s.w * k) / 2}px;top:${G.top + 6}px;width:${s.w * k}px;height:${s.h * k}px"><img src="${png(name)}" style="left:0;top:0;width:${s.w * k}px"></div>`);
};
{
  const y = START;
  const h = G.viewH * (COL.w / G.viewW);
  const shown = after.folds.filter((f) => inRange(f, y, h));
  docScene('before', before, T.gif[0](T.px(size('before').h)), START_BEFORE);
  docScene('after', after, T.gif[1](T.px(size('after').h)), y, shown, shown.filter((f) => blocksOf(f) > 1).map((f) => foldPill(f, T.pillFold(blocksOf(f)))));
  const open = expanded.folds.find((f) => f.expanded);
  const next = [...expanded.changes, ...expanded.folds].filter((r) => r.y > open.y).sort((p, q) => p.y - q.y)[0];
  const ey = open.y - 12;
  docScene('after-expanded', expanded, T.gif[2](), ey, [open, { x: open.x, y: open.y + open.h + 8, w: open.w, h: Math.min(next.y - 8, ey + h - 6) - (open.y + open.h + 8), dashed: true }]);
  tableScene('table-original', T.gif[3]());
  tableScene('table', T.gif[4]());
}
gifScenes.forEach((body, i) => pages.push([`gif-frames/${i}.png`, G.w, G.h, body]));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, w, h, body] of pages) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS} html,body{width:${w}px;height:${h}px;overflow:hidden}</style></head><body>${body}</body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode().catch(() => {}))));
  await page.screenshot({ path: join(OUT, file) });
  console.log(join(OUT, file));
}
await browser.close();

// GIF: 장면마다 2.6초, 0.2초 겹쳐 사라지기(겹치는 프레임이 용량을 거의 다 먹는다). 10fps·128색·바뀐 사각형만 다시 그려 가볍게
const n = gifScenes.length;
const hold = 2.6;
const fade = 0.2;
const inputs = [];
for (let i = 0; i < n; i++) inputs.push('-loop', '1', '-t', String(hold + fade), '-i', join(FRAMES, `${i}.png`));
let chain = '';
let last = '[0:v]';
for (let i = 1; i < n; i++) {
  const out = i === n - 1 ? '[v]' : `[x${i}]`;
  chain += `${last}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${(hold * i).toFixed(2)}${out};`;
  last = out;
}
const gif = join(OUT, 'demo.gif');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', ...inputs,
  '-filter_complex', `${chain}[v]fps=10,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
  gif,
]);
console.log(`${gif} ${(statSync(gif).size / 1024).toFixed(0)} KB`);

// 최종본을 저장소에 둔다: 스토어 이미지 → store/images/<lang>/, GIF → docs/
const FINAL = resolve(`store/images/${LANG}`);
mkdirSync(FINAL, { recursive: true });
for (const [file] of pages) if (!file.startsWith('gif-frames/')) copyFileSync(join(OUT, file), join(FINAL, file));
copyFileSync(gif, resolve(LANG === 'en' ? 'docs/demo.gif' : `docs/demo-${LANG}.gif`));
console.log(`최종본 → ${FINAL}`);
