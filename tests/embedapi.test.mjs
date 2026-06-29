// Embed API 測試 — 驗證 M2：出站 postMessage 的 targetOrigin 不再無條件用 '*'。
// 優先序：已驗證的 host origin > 白名單第一個 > '*'（僅 dev/POC 無白名單退路）。
//
// embedApi.js 依賴瀏覽器的 window/addEventListener，這裡以最小 fake 環境模擬。
// 同樣透過 tests/_vite-env-loader.mjs 改寫 import.meta.env（見 _register-loader.mjs）。
//
// 用法：node --import ./tests/_register-loader.mjs tests/embedapi.test.mjs

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

// ===== 建立可控的 fake window =====
// 每個情境重新 import 模組（用 query 破快取），因為 ALLOWED_ORIGINS 在模組載入期固化。
function makeWindow() {
  const sent = []; // 紀錄 parent.postMessage 的 (msg, targetOrigin)
  let handler = null;
  const win = {
    addEventListener: (type, fn) => { if (type === 'message') handler = fn; },
    removeEventListener: () => { handler = null; },
    parent: { postMessage: (msg, targetOrigin) => sent.push({ msg, targetOrigin }) },
  };
  win.parent.__isParent = true;
  return { win, sent, deliver: (event) => handler && handler(event) };
}

async function loadFresh(env) {
  globalThis.__VITE_ENV__ = env;
  // query 參數確保重新評估模組（讓 ALLOWED_ORIGINS 依新 env 重算）
  const url = join(__dirname, '..', 'src', 'embedApi.js') + `?t=${Math.random()}`;
  return import(url);
}

const origWindow = globalThis.window;

// ===== 情境 1：無白名單（dev/POC）=====
// ready 在任何入站訊息前送出 → 退回 '*'；收到合法 host 訊息後 → 精確回傳該 origin。
{
  console.log('\n--- 情境 1：無白名單 ---');
  const { win, sent, deliver } = makeWindow();
  globalThis.window = win;
  const { initEmbedApi } = await loadFresh({ VITE_ALLOWED_ORIGINS: '' });
  initEmbedApi({ instanceId: 'i1', onSetFiles: () => {}, onGetState: () => ({ files: [] }) });

  // 等待 ready 的 microtask
  await Promise.resolve(); await Promise.resolve();
  const ready = sent.find(s => s.msg.type === 'ready');
  check('ready 已送出', !!ready);
  check("無白名單時 ready 的 targetOrigin 為 '*'", ready && ready.targetOrigin === '*');

  // 模擬 host 送來 getState（合法來源）
  deliver({ origin: 'https://host.example', data: { source: 'streamlit-host', type: 'getState', requestId: 'r1' } });
  const resp = sent.find(s => s.msg.type === 'stateResponse');
  check('stateResponse 已送出', !!resp);
  check('收到 host 訊息後 targetOrigin 變為該 host origin',
    resp && resp.targetOrigin === 'https://host.example');
}

// ===== 情境 2：有白名單，ready 在入站訊息前 =====
// 尚無已驗證 origin → 用白名單第一個（而非 '*'）。
{
  console.log('\n--- 情境 2：有白名單，ready 先行 ---');
  const { win, sent } = makeWindow();
  globalThis.window = win;
  const { initEmbedApi } = await loadFresh({ VITE_ALLOWED_ORIGINS: 'https://a.example,https://b.example' });
  initEmbedApi({ instanceId: 'i2', onSetFiles: () => {}, onGetState: () => ({ files: [] }) });
  await Promise.resolve(); await Promise.resolve();
  const ready = sent.find(s => s.msg.type === 'ready');
  check('ready 已送出', !!ready);
  check('有白名單時 ready 用白名單第一個 origin',
    ready && ready.targetOrigin === 'https://a.example');
}

// ===== 情境 3：有白名單，已驗證 origin 優先 =====
{
  console.log('\n--- 情境 3：已驗證 origin 優先於白名單 ---');
  const { win, sent, deliver } = makeWindow();
  globalThis.window = win;
  const { initEmbedApi } = await loadFresh({ VITE_ALLOWED_ORIGINS: 'https://a.example,https://b.example' });
  initEmbedApi({ instanceId: 'i3', onSetFiles: () => {}, onGetState: () => ({ files: [] }) });
  await Promise.resolve(); await Promise.resolve();

  // host 來自白名單中的 b（非第一個）
  deliver({ origin: 'https://b.example', data: { source: 'streamlit-host', type: 'getState', requestId: 'r2' } });
  const resp = sent.find(s => s.msg.type === 'stateResponse');
  check('回傳到實際送訊的已驗證 origin（b，非白名單第一個 a）',
    resp && resp.targetOrigin === 'https://b.example');
}

// 還原 window
if (origWindow === undefined) delete globalThis.window; else globalThis.window = origWindow;

console.log(`\n結果：${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
