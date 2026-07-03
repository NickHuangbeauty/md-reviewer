# 審核包 + 交付審定 skill — 設計 spec（v1.5.0）

日期：2026-07-02
分支：`feat/table-cell-merge-diagonal`（延續，沿用同分支）
狀態：設計已與使用者確認，待寫 implementation plan

## 目標（Why）

延續 v1.4.0 的審核工作流。BU 在 md-reviewer 人工快篩（編輯 + 🚩 標記）後，按一顆「下載審核包」，得到一個 ZIP。BU 把 ZIP 解開、用 VSCode + codex（或任一 AI IDE）打開，讓 AI 依附帶的「交付審定協議」對照原始文件**逐段比對、找出 BU 可能漏掉的、修成完整 MD、跑 gate**，把逐頁比對從人腦搬給 AI。

決策摘要（使用者確認）：
1. 交付形式 = md-reviewer 前端**一顆「下載審核包」按鈕**，純前端用既有 `createZip` 打包（不經伺服器）。
2. AI 的任務 = **主動找出 BU 可能漏掉的解析瑕疵**（不只驗證已標記處）。
3. skill「兩份都出」：完整協議（給 BU 自己的交付管線）+ md-reviewer 單檔精簡版。
4. 審核包只放**一份 MD**（`審核後.md`）；`原始.md` 不放（效果對「找漏」幾乎無差，且避免兩份 MD 混淆；真比對基準是 BU 自放的來源 PDF）。
5. 先只做**單檔**「下載審核包」；多檔批次（擴充「全部 ZIP」）之後再說。

## 非目標（YAGNI）

- 不做「全部 ZIP」多檔批次審核包（之後再擴充）。
- 不放 `原始.md`（originalContent）；將來真要 before/after，一行可加回。
- 不做工具內建呼叫 LLM（Phase 2）。
- md-reviewer 不實作 viewer/manifest/hash/delivery-gate；那些屬 BU 自己的完整管線，協議文件描述之。

## 資料來源（工具已有）

- `activeFile.content` — corrected MD（BU 編輯後）
- `activeFile.marks` — 🚩 標記（`{blockId, issue?, quote?}`）
- `activeFile.name` — 檔名
`buildAnnotatedMd(content, marks)`（v1.4.0，`src/llmExport.js`）已能產出「corrected MD + `<!-- [審核問題 #n] -->` + 問題總表」。

## 審核包內容（4 個檔）

| 檔名 | 內容 | 來源 |
|---|---|---|
| `審核後.md` | corrected MD + 標記註解 + 問題總表 | `buildAnnotatedMd(content, marks)` |
| `審核協議-完整.md` | 使用者提供的協議**一字不改**（長版 + 短口令版） | `REVIEW_PROTOCOL_FULL` 常數 |
| `審核checklist-單檔.md` | md-reviewer 單檔精簡協議 | `REVIEW_CHECKLIST_SINGLE` 常數 |
| `README.md` | 使用說明（三步驟 + 提醒放來源 PDF） | `REVIEW_README` 常數 |

ZIP 檔名：`審核包_<檔名去副檔名>_<YYYY-MM-DD>.zip`

### `審核協議-完整.md`（verbatim，不得改動）

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

### `審核checklist-單檔.md`（草案，md-reviewer 單檔版）

```
# 審核 checklist —— md-reviewer 單檔版

適用：只有這個審核包（審核後.md +（選配）來源 PDF），不需 viewer/manifest/hash 管線。
目標：對這一份文件做逐段（block）source-vs-MD 比對，修到完整，gate PASS 才算可交付。

## 步驟
1. 讀 審核後.md。若資料夾內有來源 PDF，以 PDF 為左側「原始文件」；沒有則就 MD 內文自證明顯瑕疵。
2. 把 審核後.md 依標題/段落切成 blocks，對每個 block 建一列 ledger：
   | # | block 位置/引文 | 狀態 | 比對發現 | 修正 |
3. 逐 block 比對：
   - 文字是否遺漏或多出
   - 表格欄列、合併儲存格（rowspan/colspan）是否正確
   - 符號/編號/註腳/標題/段落是否正確
   - 是否出現來源不存在的內容（例如 |||、亂碼、頁首頁尾殘留）
   - 句子是否被截斷、段落是否被錯拆或錯併
   - 既有的 <!-- [審核問題 #n] --> 標記是否成立，補說明與修正
4. 每個 block 狀態只能是：
   CLEAN / FIXED（已修完整 MD）/ SOURCE_LIMITED（無來源可辨識，不猜）/
   NEEDS_REPAIR（尚未修完，不可交付）/ UNREVIEWED（尚未審，不可交付）
5. 發現問題：修「完整 MD」，不是片段；修完把整份 corrected MD 一起輸出。

## 單檔 gate（PASS 才算可交付）
- ledger 列數 == 文件 block 數
- UNREVIEWED = 0
- NEEDS_REPAIR = 0
- 每個標記都已查證（成立/不成立都要寫）

## 嚴禁
- 抽查幾段就說整份完成
- 只回報問題卻不修完整 MD
- 口頭「我看過」而無 ledger

## 輸出
1. 全量 block ledger
2. 修正後的完整 corrected MD
3. before/after 證據
4. gate 結果（UNREVIEWED=0 / NEEDS_REPAIR=0）
5. 未完成/不可交付清單；若無，明確寫 0
```

### `README.md`（草案）

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

## 注意
- 沒放來源 PDF 時，AI 只能就 MD 本身找明顯瑕疵（亂碼/表格錯位/|||/截斷），無法保證抓到所有與原文的差異。
- gate PASS（UNREVIEWED=0 / NEEDS_REPAIR=0）前，不要當作已交付。
```

## 元件與職責

### 三份 skill 文件存為真 `.md`（用 Vite `?raw` 匯入，避開反引號逃逸問題）
協議文字含反引號（例：`` `|||` ``），若寫成 JS template literal 會壞。改為**存成真正的 markdown 檔**，用 Vite 的 `?raw` 匯入成字串：
- `src/review-assets/審核協議-完整.md` — 上述協議 verbatim
- `src/review-assets/審核checklist-單檔.md` — 上述單檔版
- `src/review-assets/README.md` — 上述說明

好處：內容當真 markdown 維護、零字串逃逸、可直接檢視 diff。

### `src/reviewGuide.js`（新，純模組）
```
import protocolFull from './review-assets/審核協議-完整.md?raw';
import checklistSingle from './review-assets/審核checklist-單檔.md?raw';
import readme from './review-assets/README.md?raw';
import { buildAnnotatedMd } from './llmExport.js';

export function buildReviewPackage(file) {
  return [
    { name: '審核後.md', content: buildAnnotatedMd(file.content, file.marks) },
    { name: '審核協議-完整.md', content: protocolFull },
    { name: '審核checklist-單檔.md', content: checklistSingle },
    { name: 'README.md', content: readme },
  ];
}
```
測試考量：`?raw` 是 Vite 專屬語法，node 直接跑 `tests/reviewGuide.test.mjs` 無法解析。故 golden test 改為**直接讀檔驗證**（`fs.readFileSync('src/review-assets/*.md')` 驗關鍵句）+ 對 `buildReviewPackage` 的結構/檔名/`審核後.md` 內容用一個小 stub（測試裡自行組 4 檔陣列邏輯），或把 `buildReviewPackage` 拆成純函式 `assembleReviewPackage(annotatedMd, protocolFull, checklistSingle, readme)` 便於單元測試（實際 `buildReviewPackage` 只做 import + 呼叫）。採後者：`assembleReviewPackage` 純可測，`buildReviewPackage` 負責接線。

### `src/MdReviewer.jsx` 接線
- import `buildReviewPackage` from `./reviewGuide.js`。
- header 加「下載審核包」按鈕（在「複製 LLM 提示」/「下載 MD」附近；`activeFile` 存在即 enabled）：
  ```
  const zipName = '審核包_' + activeFile.name.replace(/\.[^.]+$/, '') + '_' + new Date().toISOString().slice(0,10) + '.zip';
  safeDownloadBlob(createZip(buildReviewPackage(activeFile)), zipName);
  ```
- 導覽（可選）：在 download 步驟文案補一句「或用『下載審核包』給 codex 找漏」。

## 錯誤處理
- 無 activeFile → 按鈕 disabled。
- 標記數為 0 也可下載（協議/checklist 仍有用；審核後.md 就是乾淨 corrected MD）。
- 中文檔名：`createZip` 已設 UTF-8 flag（0x0800），實測既有「全部 ZIP」中文檔名正常。

## 測試

`tests/reviewGuide.test.mjs`（golden，node 執行）：
- `assembleReviewPackage(annotatedMd, protocolFull, checklistSingle, readme)` 回傳 4 個檔、name 正確、順序正確
- 傳入的 annotatedMd 原樣成為 `審核後.md` content
- 直接 `fs.readFileSync` 三份 `src/review-assets/*.md` 驗關鍵句：
  - 協議含「全量 source-vs-MD 交付審定協議」「delivery gate」「ledger_rows == source_units」「gate PASS 前不准宣稱可交付」
  - 單檔版含「單檔 gate」「UNREVIEWED = 0」「NEEDS_REPAIR = 0」
  - README 含「把真正的來源文件」「依 審核協議-完整.md」
- 無標記時 annotatedMd = 乾淨 corrected MD（沿用 llmExport 行為）→ 仍組出 4 檔

BDD（≥6，canary 亮+暗）：
1. 「下載審核包」按鈕存在且有檔時 enabled
2. 無檔時 disabled
3. 點按鈕 → 攔截 blob → 解 ZIP → 4 個檔存在
4. ZIP 內 `審核後.md` 含標記註解 + 問題總表
5. ZIP 內 `審核協議-完整.md` 內容完整（含關鍵句）
6. 暗色主題按鈕可讀
（ZIP 解析：Playwright 內用簡易 unzip 或檢查中央目錄檔名 + 內容位元組。）

## DevOps（嚴格）
1. 本機 canary 5175（亮+暗）→ 2. 本機 prod 5174 gate → 3. commit →
4. **code review（使用者要求）** → 5. push canary 線上驗證 →
6. **停，等使用者點頭** → 7. merge main → 8. 線上 prod 驗證。
- 版本 bump **v1.5.0** + `src/releases.js` 一筆（新增：下載審核包 + 交付審定 skill）。
- 沿用同分支 `feat/table-cell-merge-diagonal`；不直接上正式版。

## 風險 / 待確認
- 反引號逃逸問題已解：三份 skill 存為真 `.md` + `?raw` 匯入（見上），不再有 JS 模板字面值破壞風險。
- BDD 解 ZIP：Playwright 內解壓 central directory 讀檔名較繁；退而求其次 = BDD 驗「按鈕觸發下載 + blob 大小 > 0 + 攔 createObjectURL 的 blob.text() 內含 4 個檔名字串 + 協議關鍵句」，內容正確性交給 golden + fs 讀檔保證。
- `?raw` 是 Vite 專屬，故 golden 不 import reviewGuide.js（會炸），改用 `assembleReviewPackage` 純函式 + `fs` 直接讀 `.md`。
