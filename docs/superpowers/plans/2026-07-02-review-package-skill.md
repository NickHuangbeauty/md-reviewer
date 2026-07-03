# 審核包 + 交付審定 skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** md-reviewer 加一顆「下載審核包」按鈕，純前端打包一個含 4 檔（審核後.md + 完整協議 + 單檔 checklist + README）的 ZIP，讓 BU 拿到自己的 codex/VSCode 裡做 source-vs-MD 交付審定。

**Architecture:** 三份 skill 文件存為真 `.md`（`src/review-assets/`），用 Vite `?raw` 匯入成字串（避開協議內反引號會炸 JS 字串的問題）。打包邏輯抽成純函式 `assembleReviewPackage`（`src/reviewGuide.js`，node 可測）；`?raw` import 與 `buildAnnotatedMd` 呼叫在 MdReviewer.jsx 做（glue，不進 node 測試）。ZIP 用既有 `createZip`。

**Tech Stack:** React 18 + Vite 4；純模組 ES modules + node 內建執行 golden；Playwright BDD；既有 `createZip`/`safeDownloadBlob`/`buildAnnotatedMd`。

**Spec:** `docs/superpowers/specs/2026-07-02-review-package-skill-design.md`

---

## File Structure

- `src/review-assets/審核協議-完整.md`（新）— 使用者協議 verbatim
- `src/review-assets/審核checklist-單檔.md`（新）— md-reviewer 單檔版
- `src/review-assets/README.md`（新）— 使用說明
- `src/reviewGuide.js`（新）— 純函式 `assembleReviewPackage`（node 可測）
- `tests/reviewGuide.test.mjs`（新）— golden
- `src/MdReviewer.jsx`（改）— `?raw` import 三檔 + `buildReviewPackage` glue + 「下載審核包」按鈕
- `src/releases.js`（改）— v1.5.0 一筆
- `package.json`（改）— version 1.5.0

---

## Task 1: 三份 skill 文件（真 .md）

**Files:**
- Create: `src/review-assets/審核協議-完整.md`
- Create: `src/review-assets/審核checklist-單檔.md`
- Create: `src/review-assets/README.md`

- [ ] **Step 1: 建 `src/review-assets/審核協議-完整.md`（verbatim，一字不改）**

```
請依照「全量 source-vs-MD 交付審定協議」執行。

本任務的目標不是產出 MD、不是確認 viewer 可開、不是抽查幾頁，而是要完成可交付審定：

1. 先盤點全部來源文件、頁數/source units、目前 MD、rendered MD、viewer、manifest、zip 對應關係。
2. 對每一份文件、每一頁或每個 source unit 建立 ledger。
3. 每一列 ledger 都必須逐一比對：
   - 左側原始文件
   - 右側 rendered MD
   - 目前 corrected MD
4. 比對項目包含：
   - 文字是否遺漏或新增
   - 表格欄列是否正確
   - 合併儲存格/rowspan/colspan 是否正確
   - 符號、編號、註腳、標題、段落是否正確
   - 頁序、跨頁延續、分節標題是否正確
   - 圖片、流程圖、Mermaid 判斷是否合理
   - 是否出現原始文件不存在的符號或內容，例如 `|||`
5. 每頁狀態只能是：
   - CLEAN：已比對，無需修
   - FIXED：有問題，已修完整 MD
   - SOURCE_LIMITED：來源不可辨識，不猜測
   - BLOCKED：無法交付，需明確原因
   - NEEDS_REPAIR：發現問題但尚未修完，不能交付
   - UNREVIEWED：尚未審，不能交付
6. 發現問題時，不准只回報問題；必須修正該份「完整 MD」，不是只給片段 patch。
7. 修正後必須重建：
   - corrected MD
   - rendered MD
   - reviewer frontend
   - manifest
   - hash
   - report
   - zip
8. 最後必須跑 delivery gate，且 gate 需確認：
   - ledger_rows == source_units
   - UNREVIEWED = 0
   - NEEDS_REPAIR = 0
   - BLOCKED = 0
   - viewer missing refs = 0
   - viewer stale hashes = 0
   - zip 內只有最終 MD
   - zip 不含中間檔、bak、舊版、raw leak
   - hash 與 manifest 一致
9. 沒有完成全量 ledger 前，不准宣稱完成。
10. viewer 可開、zip 可解壓、測試通過，都只能算必要條件，不能當內容正確證明。

嚴格禁止：
- 不准抽查後宣稱全量完成。
- 不准只跑 parser 就說可交付。
- 不准只檢查 viewer/zip/hash 就說內容正確。
- 不准只修局部頁面就說整份完成。
- 不准把有 NEEDS_REPAIR / BLOCKED / UNREVIEWED 的文件放進可交付 zip。
- 不准口頭說「我看過」，必須留下 ledger、證據、截圖或 log。
- 不准把記憶或舊結論當最新事實，必須重新驗證目前檔案。

完成輸出必須包含：
1. 全量 ledger
2. 每份完整 corrected MD
3. before/after 修正證據
4. viewer 連結
5. manifest/hash
6. delivery gate 結果
7. 最終 zip 路徑
8. 尚未完成或不能交付清單；若沒有，明確寫 BLOCKED=0 / NEEDS_REPAIR=0 / UNREVIEWED=0

如果你沒有真的逐頁比對完，請直接說「未完成」，不要用其他 gate 或摘要代替。

────────── 短口令版 ──────────
請用「全量 source-vs-MD 交付審定協議」處理。
沒有逐頁 ledger，不准說完成。
有問題要修完整 MD。
修完要重建 viewer/manifest/hash/zip。
gate PASS 前不准宣稱可交付。
```

- [ ] **Step 2: 建 `src/review-assets/審核checklist-單檔.md`**

```
# 審核 checklist —— md-reviewer 單檔版（source-vs-MD 交付審定 · 單文件）

適用：只有這個審核包（審核後.md +（選配）來源 PDF），不需完整 viewer/manifest/hash 管線。
定位：本文件相當於完整協議裡「一份文件」；這份 MD 的每個頁/段 = 一個 source unit。

## 步驟
1. 讀 審核後.md。審核後.md 內的 <!-- [審核問題 #n] --> 是 BU 的既有標記（輸入），要逐一查證。
   若資料夾內有來源 PDF/圖，以它為左側「原始文件」；沒有則就 MD 內文判斷明顯瑕疵。
2. 依頁錨（## p.N）或標題/段落切成 source units，對每個 unit 建一列 ledger：
   | # | unit(頁/段·引文) | 狀態 | 比對發現 | 修正動作 |
3. 逐 unit 比對：
   - 文字是否遺漏或多出
   - 表格欄列、合併儲存格（rowspan/colspan）是否正確
   - 符號/編號/註腳/標題/段落/頁序/跨頁延續是否正確
   - 圖片/流程圖/Mermaid 判斷是否合理
   - 是否出現來源不存在的內容：`|||`（long_pipe）、亂碼／替換字（replacement_chars）、
     raw JSON 殘留（raw_json）、壞掉的圖片引用（broken_img_refs）、頁首頁尾殘留
   - 既有 <!-- [審核問題 #n] --> 是否成立，補說明與修正
4. 每個 unit 狀態（對齊真實 verdict）：
   ADJUDICATED_CLEAN（已比對無需修）
   ADJUDICATED_FIXED（有問題，已修完整 MD；可加後綴如 _RENDERER_TABLE / _MERMAID_PRESERVED）
   ADJUDICATED_CLEAN_SOURCE_LIMITED（來源不可辨識，不猜測、保留並註明）
   NEEDS_REPAIR（發現問題但尚未修完 → 不可交付）
   UNREVIEWED（尚未審 → 不可交付）
   BLOCKED（無法交付，需明確原因）
5. 發現問題：修「完整 MD」，不是片段。修完輸出乾淨的 corrected MD
   —— 移除所有 <!-- [審核問題 #n] --> 與工具/reviewer 補充註解；審定結果只放在下方 report，不留在 MD 內。

## 單檔 gate（PASS 才算可交付）
- ledger 列數 == source units 數（每頁/段都有一列）
- UNREVIEWED = 0、NEEDS_REPAIR = 0、BLOCKED = 0
- long_pipe(`|||`) = 0、replacement_chars = 0、raw_json_artifacts = 0、broken_img_refs = 0
- 每個既有標記都已查證（成立/不成立都要寫）
- 最終 corrected MD 內無任何 <!-- --> 註解殘留

## 嚴禁
- 抽查幾段就說整份完成
- 只回報問題卻不修完整 MD
- 口頭「我看過」而無 ledger／證據
- 把含 UNREVIEWED / NEEDS_REPAIR / BLOCKED 的內容當可交付

## 輸出（對齊真實 report 結構）
1. 審定報告（markdown）：
   - metadata：產生時間 / 協議 / source units / ledger rows / delivery status
   - Gate 摘要：逐項 PASS/FAIL（ledger_rows_equal_units、long_pipe_zero、replacement_chars_zero…）
   - Ledger 狀態：UNREVIEWED / NEEDS_REPAIR / BLOCKED 各幾列
   - 全量 unit ledger 表（# / unit / 狀態 / 發現 / 修正）
2. 修正後的乾淨完整 corrected MD（無 <!-- --> 註解）
3. before/after 證據（改了哪些 unit、原→修）
4. gate 結果（UNREVIEWED=0 / NEEDS_REPAIR=0 / BLOCKED=0）
5. 未完成/不可交付清單；若無，明確寫 0
```

- [ ] **Step 3: 建 `src/review-assets/README.md`**

```
# 審核包 —— 使用說明

這個資料夾是 md-reviewer 匯出的審核起點。目的：讓你的 codex / AI 幫你把「解析後 MD」對照原始文件逐一比對、找出漏掉的、修到完整，而不是人工一行行看。

## 內容
- 審核後.md            你在 md-reviewer 編輯+標記後的版本（🚩 已寫成 <!-- [審核問題 #n] --> 註解）
- 審核協議-完整.md      嚴格交付審定協議（給有完整管線：真來源/viewer/manifest/hash 的情境）
- 審核checklist-單檔.md 這包自己就能跑的精簡版（只需這份 MD +（選配）來源 PDF）
- README.md            本說明

## 怎麼用（VSCode + codex / 任一 AI IDE）
1. 用 VSCode 開這個資料夾。
2. （建議）把「真正的來源文件」（原始 PDF）也拖進這個資料夾 —— AI 才能做完整 source-vs-MD 比對。
3. 對 codex/AI 說：
   - 有放來源 PDF、要嚴格交付 → 「依 審核協議-完整.md 審這份」
   - 只想快速在這包跑   → 「依 審核checklist-單檔.md 審 審核後.md」
4. AI 逐段比對、找出你可能漏掉的、修成完整 MD，並給 gate 結果。
5. 看 AI 的清單，確認後採用修正版，或回 md-reviewer 補標。

## AI 產出約定（重要）
- 最終 corrected MD 必須乾淨：移除所有 <!-- [審核問題 #n] --> 與工具註解；審定結果放在「審定報告」，不留在 MD 內。
- 這一份審核包 = 你完整交付管線裡的「一份文件」。完整管線（00_gate.json / 00_report.md / final_corrected_md / manifest / hash / viewer）由「審核協議-完整.md」規範。

## 注意
- 沒放來源 PDF 時，AI 只能就 MD 本身找明顯瑕疵（亂碼/表格錯位/|||/截斷），無法保證抓到所有與原文的差異。
- gate PASS（UNREVIEWED=0 / NEEDS_REPAIR=0 / BLOCKED=0）前，不要當作已交付。
```

- [ ] **Step 4: Commit**

```bash
git add src/review-assets/
git commit -m "docs(review-assets): 交付審定協議 + 單檔 checklist + README (skill files)"
```

---

## Task 2: `src/reviewGuide.js` + golden test

**Files:**
- Create: `src/reviewGuide.js`
- Create: `tests/reviewGuide.test.mjs`

- [ ] **Step 1: 寫失敗測試 `tests/reviewGuide.test.mjs`**

```js
import { assembleReviewPackage } from '../src/reviewGuide.js';
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

console.log('assembleReviewPackage:');
{
  const pkg = assembleReviewPackage({ fileName: 'x.md', annotatedMd: 'AMD', protocolFull: 'P', checklistSingle: 'C', readme: 'R' });
  check('4 files', pkg.length === 4);
  check('names + order', pkg.map(f => f.name).join(',') === '審核後.md,審核協議-完整.md,審核checklist-單檔.md,README.md');
  check('審核後.md content = annotatedMd', pkg[0].content === 'AMD');
  check('協議/checklist/readme content passthrough', pkg[1].content === 'P' && pkg[2].content === 'C' && pkg[3].content === 'R');
}

console.log('asset files (fs):');
const asset = (p) => readFileSync(new URL('../src/review-assets/' + p, import.meta.url), 'utf8');
{
  const P = asset('審核協議-完整.md');
  check('協議關鍵句', P.includes('全量 source-vs-MD 交付審定協議') && P.includes('ledger_rows == source_units') && P.includes('gate PASS 前不准宣稱可交付'));
  const C = asset('審核checklist-單檔.md');
  check('checklist 關鍵句', C.includes('單檔 gate') && C.includes('ADJUDICATED_CLEAN') && C.includes('long_pipe') && C.includes('UNREVIEWED = 0'));
  const R = asset('README.md');
  check('README 關鍵句', R.includes('把真正的來源文件') && R.includes('依 審核協議-完整.md') && R.includes('乾淨'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 執行確認失敗**

Run: `node tests/reviewGuide.test.mjs`
Expected: FAIL（`Cannot find module '../src/reviewGuide.js'`）

- [ ] **Step 3: 實作 `src/reviewGuide.js`**

```js
// src/reviewGuide.js
// Pure assembler for the review package (下載審核包). Given the annotated MD and the
// three skill-doc strings, return the [{name, content}] array for createZip().
// Kept free of Vite `?raw` imports so node can unit-test it; the ?raw imports and
// buildAnnotatedMd call live in MdReviewer.jsx.
export function assembleReviewPackage({ fileName, annotatedMd, protocolFull, checklistSingle, readme }) {
  return [
    { name: '審核後.md', content: annotatedMd },
    { name: '審核協議-完整.md', content: protocolFull },
    { name: '審核checklist-單檔.md', content: checklistSingle },
    { name: 'README.md', content: readme },
  ];
}
```
（註：`fileName` 目前未用於檔名組裝，保留參數供未來擴充；ZIP 外層檔名在 MdReviewer.jsx 組。）

- [ ] **Step 4: 執行確認通過**

Run: `node tests/reviewGuide.test.mjs`
Expected: `7 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add src/reviewGuide.js tests/reviewGuide.test.mjs
git commit -m "feat(review-package): pure assembleReviewPackage + golden test"
```

---

## Task 3: 「下載審核包」按鈕接線

**Files:**
- Modify: `src/MdReviewer.jsx`（import 區、header 按鈕、handler）

- [ ] **Step 1: import `?raw` 三檔 + assembleReviewPackage + Package 圖示**

在既有 `import { buildAnnotatedMd, buildLlmPrompt } from './llmExport.js';` 下一行加：

```js
import { assembleReviewPackage } from './reviewGuide.js';
import reviewProtocolFull from './review-assets/審核協議-完整.md?raw';
import reviewChecklistSingle from './review-assets/審核checklist-單檔.md?raw';
import reviewReadme from './review-assets/README.md?raw';
```

在 `lucide-react` 的 import 清單（第 2 行）末尾（`GraduationCap` 後）加 `, Package`：
把 `... History, GraduationCap } from 'lucide-react';`
改為 `... History, GraduationCap, Package } from 'lucide-react';`

- [ ] **Step 2: 加 `downloadReviewPackage` handler（放在 `copyLlmPrompt` useCallback 附近）**

```js
  const downloadReviewPackage = useCallback(() => {
    if (!activeFile) return;
    const files = assembleReviewPackage({
      fileName: activeFile.name,
      annotatedMd: buildAnnotatedMd(activeFile.content, activeFile.marks),
      protocolFull: reviewProtocolFull,
      checklistSingle: reviewChecklistSingle,
      readme: reviewReadme,
    });
    const base = activeFile.name.replace(/\.[^.]+$/, '');
    const zipName = '審核包_' + base + '_' + new Date().toISOString().slice(0, 10) + '.zip';
    safeDownloadBlob(createZip(files), zipName);
  }, [activeFile]);
```

- [ ] **Step 3: header 加「下載審核包」按鈕（在「下載 MD」按鈕之後）**

找到 `data-tour="download"` 那顆「下載 MD」按鈕，在它之後插入：

```jsx
<button onClick={downloadReviewPackage} disabled={!activeFile} className="tbtn tbtn-gray" title="下載審核包（給 codex/AI 做交付審定的 ZIP：審核後.md + 協議 + checklist + README）"><Package className="w-3.5 h-3.5" />下載審核包</button>
```

- [ ] **Step 4: 編譯確認（含 ?raw 能被 Vite 解析）**

Run: `npx vite build --config vite.config.canary.js 2>&1 | grep -E "built|error"`
Expected: `✓ built`，無 `Failed to resolve import ... ?raw` 之類錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/MdReviewer.jsx
git commit -m "feat(review-package): 下載審核包 button (4-file ZIP via ?raw skill docs)"
```

---

## Task 4: 版本 bump v1.5.0 + releases.js

**Files:**
- Modify: `src/releases.js`（最前面加一筆）
- Modify: `package.json`（version → 1.5.0）

- [ ] **Step 1: releases.js 加最新版**

在 `export const RELEASES = [` 之後、`{ version: '1.4.0', ... }` 之前插入：

```js
  {
    version: '1.5.0',
    date: '2026-07-02',
    added: [
      '「下載審核包」：一鍵打包 ZIP（審核後.md + 交付審定協議 + 單檔 checklist + README），拿到自己的 codex/VSCode 讓 AI 做 source-vs-MD 逐頁比對、找出漏掉的、修到完整、跑交付 gate',
    ],
  },
```

- [ ] **Step 2: package.json bump**

把 `"version": "1.4.0",` 改為 `"version": "1.5.0",`。

- [ ] **Step 3: 編譯 + 版號確認**

Run: `npx vite build --config vite.config.canary.js 2>&1 | grep -E "md-reviewer@|built"`
Expected: `md-reviewer@1.5.0 build` + `✓ built`。

- [ ] **Step 4: Commit**

```bash
git add src/releases.js package.json
git commit -m "chore(release): v1.5.0 — 下載審核包 + 交付審定 skill"
```

---

## Task 5: DevOps 驗證閘門（本機）→ 停，等 code review

> 本任務不改產品程式，是流程閘門。嚴格 canary-first；截圖存 `screenshots/`。

- [ ] **Step 1: 跑純模組 golden（回歸）**

Run: `node tests/reviewGuide.test.mjs && node tests/llmExport.test.mjs && node tests/mdBlocks.test.mjs && node tests/tableModel.test.mjs`
Expected: 四支皆 `0 failed`。

- [ ] **Step 2: 啟動本機 canary，跑 BDD（亮+暗）**

```bash
npx vite --config vite.config.canary.js --port 5175 &
```
用 Playwright（載入示範檔 → 標記 → 下載）逐一驗證，攔截 `URL.createObjectURL` 的 blob 用 `blob.text()` 檢查（ZIP 為二進位，用 `await blob.arrayBuffer()` → 以 `TextDecoder('utf-8')` 解 → 內含檔名字串與協議關鍵句即可，不必完整解 ZIP）：
1. 「下載審核包」按鈕存在；有檔時 enabled、無檔時 disabled
2. 點按鈕觸發下載（攔到 blob，size > 0）
3. blob 位元組（TextDecoder）內含 4 個檔名字串：`審核後.md`、`審核協議-完整.md`、`審核checklist-單檔.md`、`README.md`
4. blob 內含協議關鍵句「全量 source-vs-MD 交付審定協議」與標記註解 `[審核問題 #1]`
5. 暗色主題按鈕可讀（背景非白、文字對比 OK）
每項截圖存 `screenshots/`。

- [ ] **Step 3: 本機 prod gate（flags off）**

```bash
npx vite --port 5174 &
```
於 `localhost:5174/md-reviewer/` 抽驗：無 canary banner、「下載審核包」按鈕在、點了會下載含 4 檔名的 ZIP（非 flag-gated）。

- [ ] **Step 4: 關 dev server，STOP 交付 code review**

```bash
pkill -f "vite.*517"
```
不 push、不部署。回報使用者本機 canary+prod 全綠 + 截圖，並進行 code review（使用者要求）。等 code review 後再 push canary → 線上驗證 →（再停等點頭）→ merge main。

---

## Self-Review（計畫對 spec 覆蓋）

- 下載審核包按鈕（純前端 createZip）→ Task 3 ✅
- 4 檔（審核後.md/協議/checklist/README）→ Task 1（3 skill 檔）+ Task 2（組包）+ Task 3（審核後.md via buildAnnotatedMd）✅
- 協議 verbatim、反引號問題（真 .md + ?raw）→ Task 1 + Task 3 ✅
- 純模組可測（assembleReviewPackage + fs 讀 .md）→ Task 2 ✅
- 對齊真實 pipeline 詞彙（ADJUDICATED_*/long_pipe/replacement_chars、乾淨 MD、report 結構）→ Task 1 checklist/README ✅
- 只做單檔、不放原始.md、沿用同分支 → 全篇一致 ✅
- v1.5.0 + releases → Task 4 ✅
- DevOps + code review 閘門 → Task 5 ✅
- 型別一致：`assembleReviewPackage({fileName, annotatedMd, protocolFull, checklistSingle, readme})` → 回傳 `[{name, content}]`；`downloadReviewPackage` 呼叫端參數名一致；ZIP glue（?raw import 名 reviewProtocolFull/reviewChecklistSingle/reviewReadme）一致 ✅

已知取捨（記錄）：BDD 不完整解壓 ZIP，只驗 blob 位元組含檔名/關鍵句（內容正確性由 golden + fs 讀檔保證）；`fileName` 參數目前未用於組裝，保留擴充。
