// GitHub "Files changed" 화면 설정(톱니바퀴 메뉴)을 바꿔 가며 시나리오를 돈다.
// Unified/Split·Hide whitespace는 주소(?diff=·?w=)로 바꾸면 계정 설정이 바뀌지 않는다(2026-10-09 확인).
// Minimize comments·Compact line height는 계정 설정(POST /users/diffview)뿐이라 바꿨다가 반드시 되돌린다 —
// 바꾸기 전 값을 파일에 적어 두고, 중간에 멈춰도 다음 실행이 그 값으로 되돌린다.
import type { Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Layout = 'split' | 'unified' | 'whitespace' | 'minimized' | 'compact';
export const LAYOUTS: Layout[] = ['split', 'unified', 'whitespace', 'minimized', 'compact'];

/** 화면을 여는 주소 뒤에 붙인다 — 계정 설정과 상관없이 그 모양으로 연다 */
export const QUERY: Record<Layout, string> = {
  split: '?diff=split',
  unified: '?diff=unified',
  whitespace: '?diff=split&w=1',
  minimized: '?diff=split',
  compact: '?diff=split',
};

/** 계정 설정으로만 바꿀 수 있는 것 — 메뉴 항목 이름 */
const PREF: Partial<Record<Layout, string>> = { minimized: 'Minimize comments', compact: 'Compact line height' };

export const ORIGINAL_FILE = resolve('.scratch/testbed/layout-original.json');

const menuItems = (page: Page) => page.locator('[role="menuitemcheckbox"], [role="menuitemradio"]');

async function openMenu(page: Page): Promise<void> {
  await page.locator('button:has(svg.octicon-gear)').first().click();
  await menuItems(page).first().waitFor({ timeout: 10_000 });
}

/** 메뉴의 체크 상태 { "Minimize comments": false, ... } */
export async function readPrefs(page: Page): Promise<Record<string, boolean>> {
  await openMenu(page);
  const out = await menuItems(page).evaluateAll((els) =>
    Object.fromEntries(els.map((e) => [(e.textContent ?? '').trim().replace(/i$/, '').trim(), e.getAttribute('aria-checked') === 'true'])),
  );
  await page.keyboard.press('Escape');
  return out;
}

async function setPref(page: Page, label: string, on: boolean): Promise<void> {
  const now = (await readPrefs(page))[label];
  if (now === on) return;
  await openMenu(page);
  await menuItems(page).filter({ hasText: label }).first().click();
  await page.waitForTimeout(1500); // POST /users/diffview가 끝나게
  const after = (await readPrefs(page))[label];
  if (after !== on) throw new Error(`${label}을(를) ${on ? '켜지' : '끄지'} 못했다`);
}

/** 이 layout에 맞게 계정 설정을 바꾼다. 되돌릴 값은 ORIGINAL_FILE에(이미 있으면 그것이 진짜 처음 값이다) */
export async function applyPrefs(page: Page, layout: Layout): Promise<void> {
  const label = PREF[layout];
  if (!label) return;
  const prefs = await readPrefs(page);
  if (!existsSync(ORIGINAL_FILE)) {
    mkdirSync(dirname(ORIGINAL_FILE), { recursive: true });
    writeFileSync(ORIGINAL_FILE, JSON.stringify({ [PREF.minimized!]: prefs[PREF.minimized!], [PREF.compact!]: prefs[PREF.compact!] }) + '\n');
  }
  for (const other of Object.values(PREF)) if (other !== label) await setPref(page, other, false);
  await setPref(page, label, true);
}

/** 적어 둔 처음 값으로 되돌리고 파일을 지운다. 적어 둔 것이 없으면 아무것도 하지 않는다 */
export async function restorePrefs(page: Page): Promise<boolean> {
  if (!existsSync(ORIGINAL_FILE)) return false;
  const original = JSON.parse(readFileSync(ORIGINAL_FILE, 'utf8')) as Record<string, boolean>;
  for (const [label, on] of Object.entries(original)) await setPref(page, label, on);
  rmSync(ORIGINAL_FILE, { force: true });
  return true;
}
