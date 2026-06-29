# MD Reviewer MCP Server

把 MD Reviewer 的純核心（Markdown / 表格處理、審核標記、視覺檢閱器橋接）包成
[Model Context Protocol](https://modelcontextprotocol.io/) server，讓 Claude Code、
codex 等 agent 能直接呼叫；並透過 `open_review` 工具提供 **human-in-the-loop** 橋接：
agent 產生連結 → 人類在視覺檢閱器中核對 / 編修。

- Transport：stdio
- 進入點：`mcp/server.js`（`npm run mcp` 或 `node mcp/server.js`）
- 工具邏輯：`mcp/tools.js`（可被測試直接 import）
- 依賴專案內純 ESM 核心：`src/lib/table.js`、`src/lib/markdown.js`、`src/lib/marks.js`、`src/lib/diff.js`

## 安裝

```bash
npm install        # 會安裝 @modelcontextprotocol/sdk
npm run mcp        # 啟動 server（stdio）
```

## 工具清單

| 工具 | 輸入 | 說明 |
| --- | --- | --- |
| `diff_markdown` | `{ old, new, opts? }` | 比對兩份 Markdown，回傳 `{ edits, stats }`。依賴 `src/lib/diff.js` 的 `computeDiff`（由另一代理整合）；若尚未存在，回傳明確錯誤「diff 核心尚未整合」。 |
| `markdown_to_html` | `{ markdown }` | `splitMdBlocks` 切塊後逐塊 `parseBlockToHtml`，以兩個換行接起。 |
| `table_md_to_html` | `{ md_table }` | Markdown 表格 → HTML 表格。 |
| `table_html_to_md` | `{ html_table }` | HTML 表格 → Markdown 表格。 |
| `merge_cells` | `{ html_table, r1, c1, r2, c2 }` | 合併 HTML 表格矩形範圍儲存格（座標 0-based），回傳新 HTML（含 `colspan`/`rowspan`）。 |
| `split_cell` | `{ html_table, r, c }` | 將 `(r,c)` 的已合併主格拆回一般儲存格。 |
| `apply_review_marks` | `{ content, marks }` | 將審核標記（`{ blockId, issue }`）以 HTML 註解注入對應區塊之後。 |
| `open_review` | `{ files:[{name,content,originalContent?}], baseUrl? }` | 把檔案 base64(JSON) 編碼進 URL hash，回傳可點連結供人工檢閱。 |

所有工具皆會處理錯誤：無效輸入回傳結構化錯誤（`isError: true`），不會讓 server crash。

## 在 Claude Code 設定（`.mcp.json`）

於專案根目錄建立或編輯 `.mcp.json`：

```json
{
  "mcpServers": {
    "md-reviewer": {
      "command": "node",
      "args": ["mcp/server.js"]
    }
  }
}
```

> 若不在專案目錄下執行，請把 `args` 改成 `server.js` 的絕對路徑，例如
> `["/abs/path/to/md-reviewer/mcp/server.js"]`。

## 在 codex 設定（`~/.codex/config.toml`）

```toml
[mcp_servers.md-reviewer]
command = "node"
args = ["/abs/path/to/md-reviewer/mcp/server.js"]
```

## open_review：human-in-the-loop 用法

1. Agent 完成 Markdown 產生 / 審核後，呼叫 `open_review`，傳入要給人類核對的檔案：

   ```json
   {
     "files": [
       { "name": "draft.md", "content": "# 草稿\n內容…", "originalContent": "# 原稿\n…" }
     ]
   }
   ```

2. 工具回傳一個連結，形如：

   ```
   https://NickHuangbeauty.github.io/md-reviewer/#review=<base64(JSON)>
   ```

3. 把連結交給人類。開啟後，檢閱器的 URL-hash 載入器（`src/MdReviewer.jsx`）會自動
   base64 解碼 → `JSON.parse` → 呼叫 `importFiles` 載入這些檔案，人類即可在視覺介面
   中核對、加審核標記、編修。

4. `originalContent` 會被保留，供檢閱器做新舊對照（diff）。

> 預設 `baseUrl` 為線上正式版。本機驗證可傳 `baseUrl`，例如
> `http://localhost:5196/md-reviewer/canary/`。

## 測試

```bash
npm run test:mcp     # 工具單元測試 + server 啟動 smoke
```
