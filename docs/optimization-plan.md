# MD Reviewer 優化計畫

> 依據 codebase-memory 索引出的真實數據（見 `architecture-memory.md`）制定。
> 原則：分階段、每階段走金絲雀流程、絕不破壞正式版。

## 一、問題根源（數據）

| 問題 | 證據 |
|------|------|
| 單一巨檔 | `MdReviewer.jsx` 4310 行、119 函式、主元件 cx=70 / cog=118 / 1000 行 |
| 變更全擠一處 | 該檔被改 21 次（最高），連動 index.css、featureFlags |
| 重複已漂移 | `computeLineSimilarity` 主程式(38行) vs Worker(18行) 各一份且實作不同 |
| 模組化極低 | 全專案僅 6 條 import |
| 測試缺口 | 引擎/E2E 有，UI 元件與解析函式幾無單元測試 |

## 二、分階段策略

### Phase 0 — 安全網（測試）
動刀前先用測試鎖住現有行為。風險：零。
- 補純函式測試：表格 grid 互轉、`parseBlockToHtml`、`injectMarksToMd`、diff。
- 因純函式目前卡在 `MdReviewer.jsx`（React 模組無法在 node 直接 import），Phase 0 與 Phase 1 的第一步「抽出」需搭配進行：**抽一個函式 → 補一個測試 → 驗證行為不變**。

### Phase 1 — 抽共用工具層 `src/lib/`
把純邏輯搬出 `MdReviewer.jsx`：
- `lib/table.js`（grid 互轉、合併儲存格）← **優先，內聚最高且是重點功能**
- `lib/markdown.js`（splitMdBlocks、parseBlockToHtml、parseMarkdownTable…）
- `lib/download.js`（safeDownload、createZip）
- `lib/marks.js`（injectMarksToMd）
- `lib/similarity.js`（修掉重複：主程式 + Worker 共用一份）
風險：低（搬家 + 去重，行為不變）。

### Phase 2 — 拆元件（照圖譜的高內聚社群）
- `components/TableEditor/`（cluster 4，內聚 0.93 → 合併儲存格功能）
- `components/DiffViewer/`（cluster 22）
- `components/Block/`（InlineBlock + Mermaid，cluster 5）
- `components/Toc/`、`components/AddFileModal/`
- `MdReviewer.jsx` 收斂為薄指揮層。風險：中（有 Phase 0 測試保護）。

### Phase 3 — 體質改善（可選）
- 持久化（M4：批註存瀏覽器，重整不丟）
- 安全收尾：embedApi `'*'`(M2)、Mermaid 改 bundle(H2)、Gist URL 改設定(M3)、HTML sanitize(M1)

## 三、執行順序

```
Phase 0 測試 → Phase 1 抽 lib（先 table）→ Phase 2 先做 TableEditor
```
先做 TableEditor 的理由：邊界最乾淨（內聚 0.93）+ 是使用者最在意的功能（合併儲存格）。
也是未來「做成 MCP」的前置（核心邏輯抽乾淨才能給 AI 呼叫）。

## 四、上線流程（鐵律）

```
本地正式版改 → 本地 canary 驗證 → push → GitHub Pages canary 驗證 → 確認 OK → merge 正式版
```
