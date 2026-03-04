// MD Reviewer — Playwright E2E Smoke Test
// Usage: TARGET_URL=https://... node tests/smoke.mjs
// Requires: npx playwright install chromium

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, 'screenshots');
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:5173/md-reviewer/';
const TIMEOUT = 30_000;

let browser, page;
let failures = 0;
const results = [];

function log(status, name, detail = '') {
  const icon = status === 'PASS' ? '\u2705' : '\u274c';
  console.log(`${icon} ${name}${detail ? ': ' + detail : ''}`);
  results.push({ status, name, detail });
  if (status === 'FAIL') failures++;
}

async function screenshotOnFail(name) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

async function test(name, fn) {
  try {
    await fn();
    log('PASS', name);
  } catch (err) {
    log('FAIL', name, err.message);
    try { await screenshotOnFail(name.replace(/\s+/g, '-')); } catch { /* ignore */ }
  }
}

async function main() {
  console.log(`\n--- MD Reviewer Smoke Test ---`);
  console.log(`Target: ${TARGET_URL}\n`);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Collect canary warnings
  const canaryWarnings = [];
  page.on('console', msg => {
    if (msg.text().includes('[Canary]')) canaryWarnings.push(msg.text());
  });

  // T1: Page loads with HTTP 200
  await test('T1: Page loads', async () => {
    const resp = await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`);
  });

  // T2: React root renders
  await test('T2: React root renders', async () => {
    await page.waitForSelector('#root > *', { timeout: 10_000 });
    const title = await page.textContent('h1');
    if (!title || !title.includes('MD')) throw new Error(`Title not found, got: ${title}`);
  });

  // T3: Key buttons are present
  await test('T3: Key UI elements present', async () => {
    const importBtn = await page.$('button:has-text("匯入")');
    if (!importBtn) throw new Error('Import button not found');
    const formatBtn = await page.$('button:has-text("格式化")');
    if (!formatBtn) throw new Error('Format button not found');
  });

  // T4: Web Worker is available
  await test('T4: Web Worker available', async () => {
    const hasWorker = await page.evaluate(() => typeof Worker !== 'undefined');
    if (!hasWorker) throw new Error('Web Worker API not available');
  });

  // T5: No critical console errors
  await test('T5: No critical console errors', async () => {
    const critical = consoleErrors.filter(e =>
      !e.includes('favicon') && !e.includes('manifest') && !e.includes('DevTools')
    );
    if (critical.length > 0) {
      throw new Error(`${critical.length} error(s): ${critical[0].slice(0, 100)}`);
    }
  });

  // T6: No canary violations
  await test('T6: No canary violations', async () => {
    if (canaryWarnings.length > 0) {
      throw new Error(`${canaryWarnings.length} canary warning(s): ${canaryWarnings[0].slice(0, 100)}`);
    }
  });

  // T7: Check canary banner (only for canary builds)
  await test('T7: Canary banner check', async () => {
    const banner = await page.$('div:has-text("CANARY BUILD")');
    const isCanaryUrl = TARGET_URL.includes('/canary');
    if (isCanaryUrl && !banner) {
      throw new Error('Canary URL but no canary banner found');
    }
    // Production URL without banner is expected — pass
  });

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Passed: ${results.filter(r => r.status === 'PASS').length}`);
  console.log(`Failed: ${results.filter(r => r.status === 'FAIL').length}`);

  await browser.close();

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed!`);
    process.exit(1);
  }
  console.log('\nAll smoke tests passed.\n');
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
