# MD Reviewer — 架構記憶（Architecture Memory）

> 本檔由 **codebase-memory-mcp v0.8.1** 索引本專案後產生（索引日期 2026-06-29）。
> 內容 = 知識圖譜硬數據 + 一份 ADR（Architecture Decision Record）。
> 用途：給 codex / Claude / 人類快速建立對本專案的共同理解，並可在任何機器重新匯入記憶庫。
> 索引結果：**452 nodes / 724 edges / 157 functions / 37 files**。

---

## 1. 知識圖譜快照（codebase-memory `get_architecture`）

### 模組分層（layers）
| 模組 | 層 | 圖譜理由 |
|------|----|----------|
| `MdReviewer.jsx` | internal | fan-in=2, **fan-out=24**（神級單檔，119 節點） |
| `diffWorker.js` | entry | 只往外呼叫（Web Worker 入口） |
| `canary.js` | core | 高 fan-in（8 in / 0 out），不變量斷言 |
| `featureFlags.js` | core | 高 fan-in（6 in / 0 out），旗標治理 |
| `embedApi.js` | leaf | 只有入站、無出站 |

### 高內聚社群（clusters）＝ 未來拆模組的天然接縫
| Cluster | 內聚度 | 代表節點 | 對應職責 |
|---------|--------|----------|----------|
| 4 | **0.93（最高）** | InlineTableEditor / serialize / cloneGrid / gridToMdTable | **表格編輯（含合併儲存格）** ← 優先抽出強化 |
| 1 | 0.83 | computeStatsOnly / computeAndStreamDiff / legacy* | diff 運算（雙軌引擎） |
| 22 | 0.70 | DiffViewer / VirtualDiffList / useDashboardStats | 差異檢視 / 儀表板 |
| 5 | 0.67 | InlineBlock / MermaidEditor / enqueueMermaidRender | 區塊渲染 / Mermaid |
| 28 | 0.71 | initEmbedApi / sendToHost / handleMessage | 嵌入 API |
| 20 | 1.00 | submitSingle / submitBatch | AddFile modal |

### 熱點（hotspots，高 fan-in 工具函式）
`validateEdits`(4) · `normalizeTextForDiff`(4) · `esc`(4) · `getAllFlags`(3) · `serialize`(3) · `cloneGrid`(3) — 抽 core 時這些要優先設計成共用、單一來源。

---

## 2. ADR（已同步存入 codebase-memory 記憶庫）

### PURPOSE
產險 RAG 專用的純前端 Markdown/HTML 文檔檢閱與差異比對工具。功能：預覽編輯、表格編輯（含 colspan/rowspan 合併儲存格）、智能 diff 比對、批註標記、Mermaid/KaTeX 渲染。無後端，部署 GitHub Pages，所有運算在瀏覽器內（含 Web Worker 跑 diff）。

### STACK
React 18 + Vite 4 + Tailwind 3。依賴：diff(jsdiff)、katex、lucide-react（走 npm bundle）；Mermaid 走 cdnjs CDN 動態 `<script>` 注入（唯一 runtime 外部相依）。測試：node 引擎測試 + Playwright smoke。部署：GitHub Actions → GitHub Pages。

### ARCHITECTURE
入口 `main.jsx` → `MdReviewer.jsx`。
- **MdReviewer.jsx**：神級單檔，4310 行 / 218KB / 119 圖譜節點 / fan-out=24，內含約 50 個元件與工具函式（解析、表格編輯器、Mermaid、TOC、Dashboard、DiffViewer、虛擬列表）。
- **diffWorker.js**：Web Worker。new engine（區塊分割→fingerprint/Jaccard 配對→區塊內相似度→diffChars 處理 CJK）與 legacy（diffTrimmedLines + 位置配對）雙軌，由 flag 切換。
- **featureFlags.js**：旗標治理，優先序 **遠端 Gist JSON > 編譯期 VITE_CANARY > 預設全 OFF**。
- **embedApi.js**：跨源 iframe postMessage 協定（origin 白名單、5MB 上限、schema 驗證）。
- **canary.js**：diff 不變量斷言（always-on，O(n)）。

### PATTERNS
1. Feature Flag 三層治理：同一 bundle 切換行為，生產預設全關、canary 全開、Gist 漸進放量。
2. 金絲雀雙版部署（`deploy.yml`）：正式版永遠來自 main，canary 分支推送時同時 checkout main 建正式版，兩版共存於 `/md-reviewer/` 與 `/md-reviewer/canary/`。
3. Diff 雙軌引擎 + always-on 不變量斷言。
4. 嵌入三層：P0 `window.mdReviewer`（同源免旗標）/ P1 URL 參數 `?theme&mode=embed` / P2 `embedApi` postMessage（跨源）。

### TRADEOFFS（已知負債，依嚴重度）
- **H1** `MdReviewer.jsx` 單檔 4310 行 = 最大可維護性負債；`computeLineSimilarity` 在主執行緒與 worker 各一份已漂移。
- **H2** Mermaid 走外部 CDN，離線 / 內網 / CDN 故障時失效，與其他 bundle 依賴不一致。
- **H3** 中間層測試缺口：引擎與 E2E 有，UI 元件與解析函式幾無單元測試。
- **M1** `dangerouslySetInnerHTML` + 自製 HTML 解析，輸入若不可信有 XSS 面（可評估 DOMPurify）。
- **M2** `embedApi` 出站 postMessage 仍用 `targetOrigin '*'`（程式內有 TODO），跨源上線前必修。
- **M3** `REMOTE_FLAGS_URL` 硬編碼個人 Gist，可用性與安全單點依賴。
- **M4** 狀態集中根元件、檔案內容無持久化，重整即遺失批註。

### PHILOSOPHY
鐵律（CLAUDE.md）：金絲雀優先、不可破壞正式環境、feature 分支開發、先討論再動手、重視測試驗證、語言繁體中文。
**協定方向（與使用者談定，待執行）**：
1. 抽 monorepo `core/web/mcp`，純邏輯抽到 `core` 同時供瀏覽器 / Worker / Node 共用，消除重複。
2. 表格 cluster（合併儲存格）內聚最高、優先抽出強化。
3. 把工具做成 **MCP**：headless 工具（`diff_markdown` / `merge_cells` / `apply_marks`）+ human-in-the-loop 橋接（`open_review` 開啟視覺檢閱器給人核可，重用既有 embed/URL API）。標準 MCP 協定一次寫好同時支援 codex 與 claude。

---

## 3. 在你本機重建這份記憶

```bash
# 1. 安裝（會自動設定 codex / Claude Code / Gemini 等 agent）
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"

# 2. 索引本專案（用絕對路徑，避免 relative-path 的 corrupt 警告）
codebase-memory-mcp cli index_repository "{\"repo_path\": \"$(pwd)\"}"

# 3. 把上面第 2 段 ADR 重新存入記憶庫（mode=update，content 為六段 PURPOSE/STACK/...）
#    或直接在 agent 內說「把 docs/architecture-memory.md 的 ADR 用 manage_adr 存進記憶」

# 4. 驗證
codebase-memory-mcp cli get_architecture "{\"project\":\"<專案名>\",\"aspects\":[\"all\"]}"
```

> 註：記憶庫 db 位於 `~/.cache/codebase-memory-mcp/<專案名>.db`，專案名由絕對路徑推導，故換機器需重新索引（耗時 < 1 秒）。本檔即為跨機器可攜的記憶來源。
