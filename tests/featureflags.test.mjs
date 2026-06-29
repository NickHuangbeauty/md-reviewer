// Feature Flags 測試 — 驗證 getFlag / getAllFlags 的優先序邏輯。
// 優先序：遠端旗標(_remoteFlags) > Canary(全 true) > 預設(全 false)。
//
// 注意：src/featureFlags.js 使用 import.meta.env（Vite 編譯期變數），
// 在純 node 下為 undefined 會載入失敗。本測試透過 tests/_vite-env-loader.mjs
// 這個 ESM 載入器，把 import.meta.env 改寫為 globalThis.__VITE_ENV__，
// 以便用「真實模組碼」驗證邏輯。
//
// 用法：node --import ./tests/_register-loader.mjs tests/featureflags.test.mjs
//   （見 _register-loader.mjs；它先設定 __VITE_ENV__ 再註冊載入器）

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

// 確保非 canary 環境（VITE_CANARY 未設定）
globalThis.__VITE_ENV__ = globalThis.__VITE_ENV__ || {};

const mod = await import(join(__dirname, '..', 'src', 'featureFlags.js'));
const { getFlag, getAllFlags, fetchRemoteFlags, isCanary } = mod;

console.log('\n--- 預設（非 canary、無遠端旗標）：全部 false ---');
check('isCanary 為 false', isCanary === false);
check("getFlag('dark-mode') 預設 false", getFlag('dark-mode') === false);
check("getFlag('new-diff-engine') 預設 false", getFlag('new-diff-engine') === false);
check("getFlag('embed-api') 預設 false", getFlag('embed-api') === false);
check('未知旗標回傳 false', getFlag('does-not-exist') === false);

console.log('\n--- getAllFlags 形狀與預設值 ---');
const all = getAllFlags();
const expectedKeys = ['new-diff-engine', 'dark-mode', 'dashboard', 'diff-fold', 'embed-api'];
check('getAllFlags 含全部已知旗標鍵', expectedKeys.every(k => k in all));
check('getAllFlags 預設全 false', Object.values(all).every(v => v === false));

console.log('\n--- 遠端旗標覆寫（優先於預設）---');
// fetchRemoteFlags 透過 fetch 寫入 _remoteFlags。以 stub fetch 注入測試資料。
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ 'dark-mode': true, 'new-diff-engine': false }),
});
await fetchRemoteFlags();
globalThis.fetch = realFetch;

check("遠端設 dark-mode=true 後 getFlag 為 true", getFlag('dark-mode') === true);
check("遠端設 new-diff-engine=false 仍為 false", getFlag('new-diff-engine') === false);
check('未被遠端覆寫的旗標維持預設 false', getFlag('dashboard') === false);
check('getAllFlags 反映遠端覆寫', getAllFlags()['dark-mode'] === true);

console.log(`\n結果：${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
