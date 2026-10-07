// static/icons/icon.svg → icon16/32/48/128.png (투명 배경). 그림을 바꾼 뒤 `pnpm icons`로 다시 굽고 PNG도 커밋한다
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

// 툴바·확장 목록용은 그림을 꽉 채우고, 128은 크롬 웹스토어 안내대로 그림 96px + 사방 16px 투명 여백
const SIZES = [
  { size: 16, art: 16 },
  { size: 32, art: 32 },
  { size: 48, art: 48 },
  { size: 128, art: 96 },
];

const svg = readFileSync('static/icons/icon.svg');
const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { size, art } of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center"><img src="${src}" width="${art}" height="${art}"></div></body>`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  const out = `static/icons/icon${size}.png`;
  writeFileSync(out, await page.screenshot({ omitBackground: true }));
  console.log(out);
}
await browser.close();
