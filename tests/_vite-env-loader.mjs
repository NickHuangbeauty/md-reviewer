// 測試用 ESM 載入器：模擬 Vite 的 import.meta.env。
// 在 node 下，import.meta.env 預設為 undefined，會導致 featureFlags.js 載入失敗。
// 此載入器把來源碼中的 `import.meta.env` 改寫為 `globalThis.__VITE_ENV__`，
// 讓測試能以真實模組碼驗證 getFlag/getAllFlags 的優先序邏輯。
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (
    (result.format === 'module') &&
    typeof result.source !== 'undefined' &&
    url.includes('/src/')
  ) {
    const src = result.source.toString();
    if (src.includes('import.meta.env')) {
      result.source = src.replace(/import\.meta\.env/g, '(globalThis.__VITE_ENV__ || {})');
    }
  }
  return result;
}
