// static/icons/icon.svg → icon16/32/48/128.png, icon-off.svg → icon16/32-off.png (투명 배경). 그림을 바꾼 뒤 `pnpm icons`로 다시 굽고 PNG도 커밋한다
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

// 툴바·확장 목록용은 그림을 꽉 채우고, 128은 크롬 웹스토어 안내대로 그림 96px + 사방 16px 투명 여백
const SIZES = [
  { size: 16, art: 16 },
  { size: 32, art: 32 },
  { size: 48, art: 48 },
  { size: 128, art: 96 },
];

// 꺼짐(회색) 툴바 아이콘 — background가 확장을 끄면 이것으로 바꾼다
const OFF_SIZES = [16, 32];

const dataUrl = (path) => `data:image/svg+xml;base64,${readFileSync(path).toString('base64')}`;
const jobs = [
  ...SIZES.map(({ size, art }) => ({ src: dataUrl('static/icons/icon.svg'), size, art, out: `static/icons/icon${size}.png` })),
  ...OFF_SIZES.map((size) => ({ src: dataUrl('static/icons/icon-off.svg'), size, art: size, out: `static/icons/icon${size}-off.png` })),
];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { src, size, art, out } of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center"><img src="${src}" width="${art}" height="${art}"></div></body>`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  writeFileSync(out, await page.screenshot({ omitBackground: true }));
  console.log(out);
}
await browser.close();
