# MD Reviewer — 架構記憶（Architecture Memory / 完整版）

> 來源：**codebase-memory-mcp v0.8.1** 索引本專案（2026-06-29）。
> 圖譜規模：**452 nodes / 724 edges / 157 functions / 37 files**。
> 用途：給 mneme / codex / Claude / 人類建立對本專案的**完整**共同理解。
> 配套：`docs/codebase-knowledge.json`（機器可讀的無損匯出，含全部 157 函式指標 + 196 條呼叫邊）。

---

## 0. 如何把這份知識存進你的記憶系統（mneme）

mneme（mnemory 類個人記憶 MCP）**沒有掛在產生本檔的雲端 session**，所以本檔是「可攜的知識來源」。在你本機（已掛 mneme 的 Claude Code / codex）執行其一：
- 對 agent 說：「讀 `docs/architecture-memory.md` 與 `docs/codebase-knowledge.json`，把其中的事實存進 mneme」。
- 或直接餵 `docs/codebase-knowledge.json` 給 mneme 的匯入工具（JSON 內每個函式 / 呼叫邊都是一筆可記憶事實）。

---

## 1. 專案事實（PURPOSE / STACK）

- **定位**：產險 RAG 專用的**純前端** Markdown/HTML 文檔檢閱與差異比對工具。無後端，所有運算在瀏覽器內（含 Web Worker 跑 diff），部署 GitHub Pages。
- **功能**：預覽編輯、表格編輯（含 colspan/rowspan 合併儲存格）、智能 diff、批註、Mermaid/KaTeX 渲染、差異儀表板、嵌入模式。
- **技術棧**：React 18 + Vite 4 + Tailwind 3。依賴 `diff`(jsdiff)、`katex`、`lucide-react`（bundle）；**Mermaid 走 cdnjs CDN**（唯一 runtime 外部相依）。測試：node 引擎測試 + Playwright smoke。

---

## 2. 模組分層（codebase-memory `get_architecture`）

| 模組 | 層 | 圖譜證據 |
|------|----|----------|
| `MdReviewer.jsx` | internal | fan-in=2, **fan-out=24**，119 函式節點 |
| `diffWorker.js` | entry | 只往外呼叫（Web Worker 入口） |
| `canary.js` | core | 高 fan-in（8 in / 0 out），不變量斷言 |
| `featureFlags.js` | core | 高 fan-in（6 in / 0 out），旗標治理 |
| `embedApi.js` | leaf | 只有入站、無出站 |

### 模組職責
- **MdReviewer.jsx**：UI 主體 + 約 50 個元件 / 工具函式（解析、表格編輯器、Mermaid、TOC、Dashboard、DiffViewer、虛擬列表）。
- **diffWorker.js**：Web Worker。**new engine**（區塊分割→fingerprint/Jaccard 配對→區塊內相似度→diffChars 處理 CJK）與 **legacy**（diffTrimmedLines + 位置配對）雙軌，由 flag 切換。
- **featureFlags.js**：旗標優先序 **遠端 Gist JSON > 編譯期 VITE_CANARY > 預設全 OFF**。
- **embedApi.js**：跨源 iframe postMessage（origin 白名單、5MB 上限、schema 驗證）。
- **canary.js**：diff 不變量斷言（always-on，O(n)）。

---

## 3. 高內聚社群（clusters）＝ 拆模組的天然接縫

| Cluster | 內聚度 | 代表節點 | 對應職責 |
|---------|--------|----------|----------|
| 4 | **0.93（最高）** | InlineTableEditor / serialize / cloneGrid / gridToMdTable | **表格編輯（含合併儲存格）** |
| 1 | 0.83 | computeStatsOnly / computeAndStreamDiff / legacy* | diff 運算（雙軌引擎） |
| 22 | 0.70 | DiffViewer / VirtualDiffList / useDashboardStats | 差異檢視 / 儀表板 |
| 5 | 0.67 | InlineBlock / MermaidEditor / enqueueMermaidRender | 區塊渲染 / Mermaid |
| 28 | 0.71 | initEmbedApi / sendToHost / handleMessage | 嵌入 API |
| 20 | 1.00 | submitSingle / submitBatch | AddFile modal |

---

## 4. 完整函式清單（依檔案，cx = cyclomatic complexity, cog = cognitive）
#### `src/MdReviewer.jsx` — 119 個函式
- `MdReviewer` — cx=70 cog=118 行數=1000 參數=0
- `highlightCode` — cx=35 cog=88 行數=91 參數=2 loop=2
- `InlineBlock` — cx=31 cog=41 行數=345 參數=1
- `splitMdBlocks` — cx=27 cog=60 行數=92 參數=1 loop=1
- `DiffViewer` — cx=23 cog=42 行數=296 參數=1 loop=2
- `InlineTableEditor` — cx=22 cog=33 行數=252 參數=1 loop=2
- `formatMarkdown` — cx=19 cog=37 行數=17 參數=1 loop=1
- `FloatingToc` — cx=15 cog=19 行數=117 參數=1 loop=1
- `parseBlockToHtml` — cx=14 cog=18 行數=118 參數=1 loop=1
- `MermaidEditor` — cx=14 cog=16 行數=170 參數=1
- `parseHtmlTableToGrid` — cx=13 cog=32 行數=107 參數=1 loop=3
- `AddFileModal` — cx=11 cog=17 行數=163 參數=1 loop=1
- `buildFoldedItems` — cx=11 cog=42 行數=36 參數=2 loop=2
- `fM` — cx=10 cog=24 行數=7 參數=1 loop=1
- `isEmptyOrWhitespace` — cx=9 cog=11 行數=29 參數=1
- `useDashboardStats` — cx=9 cog=13 行數=79 參數=2
- `handleDrop` — cx=9 cog=22 行數=46 參數=1
- `gridToHtmlTable` — cx=8 cog=8 行數=29 參數=1
- `renderRow` — cx=8 cog=14 行數=51 參數=2 loop=2
- `SlashMenu` — cx=8 cog=15 行數=105 參數=1
- `extractNodeIdsFromLine` — cx=8 cog=9 行數=39 參數=1 loop=1
- `safeDownload` — cx=6 cog=13 行數=71 參數=3
- `parseMdTableToGrid` — cx=6 cog=8 行數=38 參數=1 loop=1
- `findSvgNodesById` — cx=6 cog=8 行數=20 參數=2
- `_drainMmQueue` — cx=6 cog=14 行數=21 參數=0 loop=1
- `computeLineSimilarity` — cx=6 cog=9 行數=38 參數=2 loop=2
- `parseMarkdownTable` — cx=5 cog=7 行數=20 參數=1 loop=1
- `gridsAreDifferent` — cx=5 cog=9 行數=12 參數=2 loop=2
- …另 91 個低複雜度(cx<5)工具/輔助函式

#### `src/diffWorker.js` — 17 個函式
- `pairBySimilarity` — cx=31 cog=78 行數=122 參數=4 loop=2
- `parseBlocks` — cx=28 cog=62 行數=170 參數=1 loop=1
- `matchBlocks` — cx=21 cog=37 行數=71 參數=2 loop=2
- `computeAndStreamDiff` — cx=18 cog=38 行數=106 參數=3 loop=3
- `legacyComputeAndStreamDiff` — cx=12 cog=45 行數=63 參數=3 loop=2
- `legacyComputeStatsOnly` — cx=12 cog=45 行數=55 參數=3 loop=2
- `isEmptyOrWhitespaceWorker` — cx=10 cog=12 行數=31 參數=1
- `tokenSetJaccard` — cx=9 cog=17 行數=27 參數=2 loop=2
- `diffWithinBlock` — cx=8 cog=29 行數=40 參數=2 loop=2
- `computeStatsOnly` — cx=7 cog=11 行數=41 參數=3 loop=2
- `computeLineSimilarity` — cx=6 cog=9 行數=18 參數=2 loop=1
- `tokenize` — cx=5 cog=12 行數=13 參數=1 loop=2
- …另 5 個低複雜度(cx<5)工具/輔助函式

#### `src/canary.js` — 3 個函式
- `validateEdits` — cx=15 cog=31 行數=71 參數=1 loop=1
- `validateStats` — cx=6 cog=7 行數=47 參數=2
- …另 1 個低複雜度(cx<5)工具/輔助函式

#### `src/featureFlags.js` — 6 個函式
- …另 6 個低複雜度(cx<5)工具/輔助函式

#### `src/embedApi.js` — 5 個函式
- `initEmbedApi` — cx=11 cog=24 行數=73 參數=1
- `handleMessage` — cx=10 cog=23 行數=44 參數=1
- …另 3 個低複雜度(cx<5)工具/輔助函式

#### `tests/smoke.mjs` — 4 個函式
- `main` — cx=11 cog=11 行數=87 參數=0
- …另 3 個低複雜度(cx<5)工具/輔助函式

#### `tests/diff-engine.test.mjs` — 3 個函式
- …另 3 個低複雜度(cx<5)工具/輔助函式

---

## 5. 跨模組呼叫邊界（boundaries，call_count）
MdReviewer→smoke(14) · diffWorker→canary(8) · MdReviewer→featureFlags(6) · diffWorker→diff-engine(5) · MdReviewer→diff-engine(3) · diffWorker→smoke(3) · MdReviewer→embedApi(1)
（註：tests 與 src 同名符號造成部分跨界係測試鏡像，非真實依賴。）

### Imports（僅 6 條，模組化低）
- `MdReviewer.jsx` → `featureFlags.js`(getAllFlags) / `embedApi.js`(initEmbedApi)
- `diffWorker.js` → `canary.js`(mergeReports)
- `main.jsx` → `MdReviewer.jsx` / `index.css`

---

## 6. 變更熱點與耦合（git history）

- **churn（修改次數）**：`MdReviewer.jsx` **21 次**（遠高於其餘）；index.css 5、development-guide.md 3、featureFlags.js 3。
- **co-change 耦合（coupling_score 1.00）**：改 `MdReviewer.jsx` 幾乎必連動 `index.css`（5 次）與 `featureFlags.js`（3 次）。
- **解讀**：`MdReviewer.jsx` 是「變更磁鐵」，任何功能改動都集中於此 → 與 fan-out=24、複雜度 70 互相印證，是重構第一優先。

---

## 7. 已知負債（TRADEOFFS，依嚴重度）

- **H1** `MdReviewer.jsx` 單檔 4310 行 / 主元件 cx=70 cog=118 = 最大可維護性負債。**已證實重複漂移**：`computeLineSimilarity` 在 `MdReviewer.jsx`(38 行) 與 `diffWorker.js`(18 行) 各一份且實作已不同。
- **H2** Mermaid 走外部 CDN，離線 / 內網 / CDN 故障時失效。
- **H3** 中間層測試缺口：引擎與 E2E 有，UI 元件與解析函式幾無單元測試。
- **M1** `dangerouslySetInnerHTML` + 自製 HTML 解析，輸入若不可信有 XSS 面（可評估 DOMPurify）。
- **M2** `embedApi` 出站 postMessage 仍用 `targetOrigin '*'`（程式內有 TODO），跨源上線前必修。
- **M3** `REMOTE_FLAGS_URL` 硬編碼個人 Gist，可用性與安全單點依賴。
- **M4** 狀態集中根元件、檔案內容無持久化，重整即遺失批註。

---

## 8. 哲學與鐵律（PHILOSOPHY）

CLAUDE.md：金絲雀優先（BDD/E2E 先在 canary 通過才跑正式）、不可破壞正式環境、feature 分支開發、先討論再動手、重視測試驗證、語言繁體中文。

> 後續規劃見 `docs/refactor-and-mcp-plan.md`。
