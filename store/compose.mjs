// 스토어 이미지 만들기: 캡처(store/build/capture/<lang>/)를 넣은 스크린샷 1280×800 4장, 홍보 타일 440×280·1400×560, README용 GIF
// 사용: node store/compose.mjs [en|ko]  (먼저 node store/capture.mjs <lang>)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LANG = process.argv[2] ?? 'en';
const CAP = resolve(`store/build/capture/${LANG}`);
const OUT = resolve(`store/build/${LANG}`);
const FRAMES = join(OUT, 'gif-frames');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const png = (name) => `data:image/png;base64,${readFileSync(join(CAP, name)).toString('base64')}`;
const icon = `data:image/svg+xml;base64,${readFileSync('static/icons/icon.svg').toString('base64')}`;
const iconOff = `data:image/svg+xml;base64,${readFileSync('static/icons/icon-off.svg').toString('base64')}`;
// 캡처는 deviceScaleFactor 2 — CSS 크기는 이미지 픽셀의 절반
const size = (name) => {
  const b = readFileSync(join(CAP, name));
  return { w: b.readUInt32BE(16) / 2, h: b.readUInt32BE(20) / 2 };
};

const T = {
  en: {
    heroTitle: 'Long Markdown docs in pull requests?<br>See only what changed.',
    heroSub: "AI writes long design docs. GitHub's rich diff opens the whole file, and the source diff is buried in syntax. Markdown Diff Cat renders the document and folds everything that didn't change.",
    before: 'Before · rich diff shows the whole file',
    after: 'After · only the changes',
    scroll: (b, a) => `${b.toLocaleString('en-US')} px → ${a.toLocaleString('en-US')} px of scrolling`,
    foldTitle: 'Unchanged sections fold away',
    foldSub: 'Each bar shows how many blocks it hides and the last heading inside. Click a bar to peek, or expand the whole file.',
    tableTitle: 'Tables show only the rows that changed',
    tableSub: 'GitHub shows the whole old table and the whole new table. Here you see changed cells as old → new, plus added and removed rows.',
    merged: 'Markdown Diff Cat',
    original: 'GitHub rich diff',
    wayTitle: 'Stays out of your way',
    way: [
      'Opens the rendered view for you on every Markdown file',
      'Click <code>&lt;&gt;</code> to leave a comment — it will not switch that file back',
      'Files with review comments stay in the source view',
      'Color icon = on, gray icon = off. One click to switch',
      'No data collected. No network requests. Only github.com pages',
    ],
    on: 'On', off: 'Off',
    tagline: 'See only what changed in Markdown pull requests',
    unofficial: 'Unofficial. Not affiliated with GitHub.',
    gif: [
      "GitHub's rich diff: the whole document",
      'Markdown Diff Cat: unchanged sections folded',
      'Click a bar to peek inside',
      'Tables: only the rows that changed',
      'Original tables are one click away',
    ],
  },
  ko: {
    heroTitle: 'PR 속 긴 마크다운 문서,<br>바뀐 부분만 보세요',
    heroSub: 'AI가 쓴 설계 문서는 길어요. 렌더링 보기는 파일 전체가 펼쳐지고, 원문 보기는 문법 기호에 묻혀 읽기 어렵죠. Markdown Diff Cat은 문서를 렌더링한 채 바뀌지 않은 곳을 접어 줍니다.',
    before: '전 · 렌더링 보기는 파일 전체',
    after: '후 · 바뀐 부분만',
    scroll: (b, a) => `스크롤 ${b.toLocaleString('ko-KR')}px → ${a.toLocaleString('ko-KR')}px`,
    foldTitle: '바뀌지 않은 구간은 접혀요',
    foldSub: '막대마다 숨긴 블록 수와 마지막 제목이 보여요. 누르면 그 자리만 펼치고, 파일 전체를 한 번에 펼칠 수도 있어요.',
    tableTitle: '표는 바뀐 행만',
    tableSub: 'GitHub는 옛 표 전체와 새 표 전체를 따로 보여 줘요. 여기서는 바뀐 칸을 이전 → 이후로, 추가·삭제된 행은 색으로 보여 줍니다.',
    merged: 'Markdown Diff Cat',
    original: 'GitHub 렌더링 보기',
    wayTitle: '방해하지 않아요',
    way: [
      '마크다운 파일은 열자마자 렌더링 보기로',
      '코멘트를 달려고 <code>&lt;&gt;</code>를 누르면 그 파일은 되돌리지 않아요',
      '리뷰 코멘트가 있는 파일은 원문 보기 그대로',
      '컬러 아이콘 = 켜짐, 회색 아이콘 = 꺼짐. 한 번에 전환',
      '수집하는 데이터도, 네트워크 요청도 없어요. github.com 화면에서만 동작',
    ],
    on: '켜짐', off: '꺼짐',
    tagline: '마크다운 PR, 바뀐 부분만 보기',
    unofficial: 'GitHub와 관련 없는 비공식 도구입니다.',
    gif: [
      'GitHub 렌더링 보기: 문서 전체가 펼쳐짐',
      'Markdown Diff Cat: 바뀌지 않은 구간을 접음',
      '막대를 누르면 그 자리만 펼쳐요',
      '표는 바뀐 행만',
      '원래 표도 한 번에',
    ],
  },
}[LANG];

const FONT = LANG === 'ko' ? '"Apple SD Gothic Neo", "Pretendard", system-ui, sans-serif' : '-apple-system, "Segoe UI", system-ui, sans-serif';
const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: ${FONT}; color: #f0f4ff; background: #0d1b3e; -webkit-font-smoothing: antialiased; }
  .accent { color: #f6a04d; }
  .shot { overflow: hidden; border-radius: 12px; border: 1px solid #2c3e6b; background: #0d1117; box-shadow: 0 12px 40px rgba(0,0,0,.35); position: relative; }
  .shot img { display: block; }
  .fade::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 90px; background: linear-gradient(transparent, #0d1117); }
  .label { font-size: 15px; font-weight: 600; color: #c9d6ff; margin-bottom: 10px; }
  code { font-family: ui-monospace, Menlo, monospace; background: #22305a; padding: 1px 6px; border-radius: 4px; }
`;
// 캡처의 (offsetY부터 height만큼) 구간을 width 폭으로 보여 준다
const crop = (name, { width, height, offsetY = 0, fade = false }) => {
  const { w } = size(name);
  const k = width / w;
  return `<div class="shot ${fade ? 'fade' : ''}" style="width:${width}px;height:${height}px"><img src="${png(name)}" style="width:${width}px;margin-top:${-offsetY * k}px"></div>`;
};

const pages = [];
const beforeH = Math.round(size('before.png').h);
const afterH = Math.round(size('after.png').h);

pages.push(['screenshot-1.png', 1280, 800, `
  <div style="padding:44px 56px;display:flex;flex-direction:column;height:100%">
    <div style="display:flex;gap:22px;align-items:center">
      <img src="${icon}" width="84" height="84">
      <div>
        <div style="font-size:36px;font-weight:800;line-height:1.2">${T.heroTitle}</div>
      </div>
    </div>
    <div style="font-size:17px;line-height:1.55;color:#c9d6ff;margin:16px 0 22px;max-width:1080px">${T.heroSub}</div>
    <div style="display:flex;gap:28px">
      <div><div class="label">${T.before}</div>${crop('before.png', { width: 570, height: 470, offsetY: 30, fade: true })}</div>
      <div><div class="label"><span class="accent">${T.after}</span></div>${crop('after.png', { width: 570, height: 470, offsetY: 30, fade: true })}</div>
    </div>
    <div style="margin-top:14px;font-size:15px;color:#f6a04d;font-weight:600">${T.scroll(beforeH, afterH)}</div>
  </div>`]);

pages.push(['screenshot-2.png', 1280, 800, `
  <div style="padding:48px 56px">
    <div style="font-size:38px;font-weight:800">${T.foldTitle}</div>
    <div style="font-size:18px;line-height:1.55;color:#c9d6ff;margin:12px 0 26px;max-width:1080px">${T.foldSub}</div>
    ${crop('after.png', { width: 1168, height: 560, offsetY: 380 })}
  </div>`]);

const tbl = size('table.png');
const tblO = size('table-original.png');
pages.push(['screenshot-3.png', 1280, 800, `
  <div style="padding:48px 56px">
    <div style="font-size:38px;font-weight:800">${T.tableTitle}</div>
    <div style="font-size:18px;line-height:1.55;color:#c9d6ff;margin:12px 0 30px;max-width:1080px">${T.tableSub}</div>
    <div style="display:flex;gap:40px;align-items:flex-start">
      <div><div class="label"><span class="accent">${T.merged}</span></div>${crop('table.png', { width: 560, height: Math.round((560 / tbl.w) * tbl.h) })}</div>
      <div><div class="label">${T.original}</div>${crop('table-original.png', { width: Math.round(Math.min(560, (480 / tblO.h) * tblO.w)), height: Math.round(Math.min(480, (560 / tblO.w) * tblO.h)) })}</div>
    </div>
  </div>`]);

pages.push(['screenshot-4.png', 1280, 800, `
  <div style="padding:60px 64px;display:flex;gap:56px;align-items:center;height:100%">
    <div style="flex:1">
      <div style="font-size:40px;font-weight:800;margin-bottom:30px">${T.wayTitle}</div>
      <ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:20px;font-size:21px;line-height:1.45">
        ${T.way.map((w) => `<li style="display:flex;gap:14px"><span class="accent" style="font-weight:800">✓</span><span>${w}</span></li>`).join('')}
      </ul>
    </div>
    <div style="width:330px;display:flex;flex-direction:column;gap:28px;align-items:center">
      <div style="display:flex;gap:36px">
        <div style="text-align:center"><img src="${icon}" width="128" height="128"><div style="margin-top:10px;font-size:18px">${T.on}</div></div>
        <div style="text-align:center"><img src="${iconOff}" width="128" height="128"><div style="margin-top:10px;font-size:18px;color:#9aa6c4">${T.off}</div></div>
      </div>
      <div style="display:flex;gap:14px;background:#35363a;border-radius:12px;padding:14px 18px;align-items:center">
        <span style="width:24px;height:24px;border-radius:50%;background:#9aa0a6;opacity:.5"></span>
        <img src="${icon}" width="32" height="32">
        <span style="width:24px;height:24px;border-radius:5px;background:#9aa0a6;opacity:.5"></span>
      </div>
      <div style="font-size:14px;color:#9aa6c4;text-align:center">${T.unofficial}</div>
    </div>
  </div>`]);

pages.push(['promo-small-440x280.png', 440, 280, `
  <div style="height:100%;display:flex;align-items:center;gap:18px;padding:0 26px">
    <img src="${icon}" width="124" height="124">
    <div>
      <div style="font-size:27px;font-weight:800;line-height:1.1">Markdown<br>Diff Cat</div>
      <div style="font-size:14px;color:#9aa6c4;margin-top:4px">for GitHub</div>
      <div style="font-size:14px;color:#f6a04d;margin-top:12px;line-height:1.35;font-weight:600">${T.tagline}</div>
    </div>
  </div>`]);

pages.push(['promo-marquee-1400x560.png', 1400, 560, `
  <div style="height:100%;display:flex;align-items:center;gap:48px;padding:0 64px;overflow:hidden">
    <div style="width:470px;flex:none">
      <img src="${icon}" width="120" height="120">
      <div style="font-size:48px;font-weight:800;line-height:1.1;margin-top:18px">Markdown Diff Cat</div>
      <div style="font-size:20px;color:#9aa6c4;margin-top:6px">for GitHub</div>
      <div style="font-size:22px;color:#f6a04d;margin-top:20px;font-weight:700;line-height:1.35">${T.tagline}</div>
    </div>
    ${crop('after.png', { width: 760, height: 470, offsetY: 360 })}
  </div>`]);

// GIF 장면: 960×600, 위에 설명 한 줄
const gifShots = [
  ['before.png', 60],
  ['after.png', 60],
  ['after-expanded.png', 380],
  ['table.png', 0],
  ['table-original.png', 0],
];
gifShots.forEach(([name, offsetY], i) => {
  const s = size(name);
  const isTable = name.startsWith('table');
  const width = isTable ? Math.min(820, s.w) : 900;
  const height = isTable ? Math.min(470, Math.round((width / s.w) * s.h)) : 480;
  pages.push([`gif-frames/${i}.png`, 960, 600, `
    <div style="padding:26px 30px;height:100%">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:18px">
        <img src="${icon}" width="40" height="40">
        <div style="font-size:24px;font-weight:700">${T.gif[i]}</div>
      </div>
      <div style="display:flex;justify-content:center">${crop(name, { width, height, offsetY })}</div>
    </div>`]);
});

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

// GIF: 장면마다 2.2초, 0.5초 겹쳐 사라지기
const n = gifShots.length;
const hold = 2.2;
const fade = 0.5;
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
  '-filter_complex', `${chain}[v]fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
  gif,
]);
console.log(gif);

// 최종본을 저장소에 둔다: 스토어 이미지 → store/images/<lang>/, GIF → docs/
const FINAL = resolve(`store/images/${LANG}`);
mkdirSync(FINAL, { recursive: true });
for (const [file] of pages) if (!file.startsWith('gif-frames/')) copyFileSync(join(OUT, file), join(FINAL, file));
copyFileSync(gif, resolve(LANG === 'en' ? 'docs/demo.gif' : `docs/demo-${LANG}.gif`));
console.log(`최종본 → ${FINAL}`);
