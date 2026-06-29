# 表格儲存格合併/分割 + 斜線表頭 — 設計規格

- 日期：2026-06-29
- 狀態：設計定案（透過互動原型驗證）
- 範圍：`src/MdReviewer.jsx` 內的 `InlineTableEditor`（HTML 表格 grid 編輯器）、grid 模型、序列化器、DOMPurify sanitizer
- 流程：本功能屬新功能，必須走 canary-first（先本地 canary → 本地正式版 → 線上 canary → merge）

## 1. 目標

讓使用者在「預覽/編輯」畫面以視覺化方式操作表格：

1. **合併/分割儲存格** — 拖曳選取矩形範圍後合併成單一跨欄/跨列儲存格，或把已合併格分割還原。
2. **斜線表頭（對角線分割儲存格）** — 把角落儲存格以對角線分成右上（欄維度）與左下（列維度）兩個標籤。

兩者都是產險分層負責表這類 RAG 文件常見的版面，目前工具只能渲染（若來源已是 HTML）、無法在編輯畫面建立。

## 2. 非目標（YAGNI）

- 不支援跨越既有合併格再合併（v1：偵測到重疊則停用「合併」鈕，需先分割）。
- 不支援「串接內容」合併模式（原型驗證後確認對使用情境無用，固定為保留左上）。
- MD pipe 表格不新增任何合併語法（MD 無原生 colspan）；改由自動轉 HTML 承載。
- 斜線僅支援單一對角方向（左上→右下）與兩個文字標籤；不支援多重斜線或三分割。

## 3. 已鎖定的設計決策

| 項目 | 決定 | 理由 |
|---|---|---|
| 表格類型 | 任何合併/斜線操作時，若該表為 MD 格式則自動轉為 HTML（`outputFormat='html'`） | MD 無法表示 colspan/斜線 |
| 選取方式 | 拖曳選取（Excel 風）；單擊仍進入儲存格編輯 | 原型驗證最直覺 |
| 操作入口 | 選取範圍時浮現小工具列：合併 / 分割 / 斜線 | 原型驗證 |
| 合併內容 | 固定保留左上格；若其餘被合併格含非空內容，先彈確認「其餘格內容將被清除，確定？」 | 原型驗證；「串接」對使用情境無用 |
| 復原 | 編輯器內 undo/redo（向前/向後逐步） | 使用者明確要求 |
| 斜線渲染 | 對角線（左上→右下）內嵌 SVG `<line>` + 右上/左下兩個 `<span>` 標籤 | 原型驗證效果良好 |

## 4. 架構與單元

全部集中在 `InlineTableEditor` 與既有 grid 工具，沿用既有 `cellMeta`（已含 `colspan/rowspan/spannedBy/primary/isHeader/style/align/height`）。

### 4.1 資料模型擴充

`cellMeta` 每格新增一個可選欄位：

```
diag?: { up: string, lo: string }   // 存在即為斜線格；up=右上標籤、lo=左下標籤
```

斜線格本身為單一儲存格（`colspan/rowspan` 通常為 1）；其文字內容 `cell.text` 不使用，改用 `diag.up`/`diag.lo`。

### 4.2 新增/修改的單元

| 單元 | 類型 | 職責 | 介面 |
|---|---|---|---|
| 選取狀態 | `InlineTableEditor` state | 記錄拖曳選的矩形 | `selRange = {r1,c1,r2,c2} \| null` |
| 拖曳處理 | 事件委派 | 區分單擊（編輯）vs 拖曳（選範圍） | mousedown 記起點+追蹤旗標；mouseover（拖曳中）更新終點；mouseup 結束。位移為 0 視為單擊→沿用既有 `focusCell` 編輯 |
| `<CellToolbar>` | 元件 | 選取時於範圍上緣浮現，依狀態啟用合併/分割/斜線 | props: `range`, `canMerge`, `canSplit`, `canDiag`, 三個 callback |
| `mergeCells(grid, range)` | 純函式 | 左上設 colspan/rowspan 覆蓋範圍，其餘標 `spannedBy:{r,c}`+清空；回傳新 grid | grid→grid |
| `splitCell(grid, r, c)` | 純函式 | primary 還原 1×1，被覆蓋格還原獨立空格 | grid→grid |
| `setDiagonal(grid, r, c)` / `clearDiagonal(grid, r, c)` | 純函式 | 設定/移除 `diag`，初始 up/lo 取現有文字或空 | grid→grid |
| BUG 4 修復 | 改 `addColLeft/Right`、`deleteCol`、`addRowAbove/Below`、`deleteRow` | 插入/刪除時重算所有 `spannedBy` 座標、調整跨越該軸的 primary 的 `colspan/rowspan` | — |
| undo/redo | `InlineTableEditor` state | grid 狀態歷史堆疊 | `histRef=[clones]`, `hiRef`；`commit()` 推入、`undo()`/`redo()` 還原 |

### 4.3 序列化（已部分存在）

- `gridToHtmlTable`（~L795）：
  - colspan/rowspan 已支援（L803-804），保留。
  - **新增**：若 `meta.diag`，輸出帶內嵌 SVG 線的斜線儲存格：
    ```html
    <td class="diag-cell"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" stroke-width="1"/></svg><span class="diag-up">{up}</span><span class="diag-lo">{lo}</span></td>
    ```
  - 對應 CSS（`.diag-cell` position:relative、`.diag-up`/`.diag-lo` 絕對定位、svg inset:0）加入 `src/index.css`。
- `parseHtmlTableToGrid`（~L656）：
  - colspan/rowspan 已支援，保留。
  - **新增**：偵測 `class="diag-cell"` 的儲存格 → 還原成 `diag:{up,lo}`（讀 `.diag-up`/`.diag-lo` 文字）。

### 4.4 安全（DOMPurify）

`sanitizeUserHtml`（`src/MdReviewer.jsx`，G3.2）目前會濾掉 `<svg>`/`<line>`。需擴充：

- `ADD_TAGS` 增加 `'svg'`, `'line'`。
- `ADD_ATTR` 增加 `'viewBox'`, `'preserveAspectRatio'`, `'x1'`, `'y1'`, `'x2'`, `'y2'`, `'stroke'`, `'stroke-width'`。
- **仍禁**：`foreignObject`, `script`, 所有 `on*`, 外部 `xlink:href`/`href`（DOMPurify USE_PROFILES.svg 預設行為 + FORBID_TAGS 維持）。
- 驗證：既有 XSS payload（img onerror、svg onload）仍被中和——特別是 `<svg onload=...>` 必須仍被擋（允許 svg 標籤 ≠ 允許 svg 事件處理）。

## 5. 互動流程（資料流）

```
拖曳選取 → selRange → <CellToolbar> 浮現
  ├─ 合併：若範圍含非空其餘格 → confirm() → mergeCells() → 若原為 MD 則 outputFormat='html' → commit()(歷史) → 重繪
  ├─ 分割：splitCell() → commit() → 重繪
  └─ 斜線（選單格時）：setDiagonal() → 兩標籤就地編輯 → commit()
存檔（點編輯器外）：gridToHtmlTable(data) → onSave
```

## 6. 邊界與錯誤處理

- 合併範圍含已合併/被覆蓋格 → 「合併」鈕停用（提示「請先分割重疊的合併格」）。
- 分割僅在選到單一 `colspan>1||rowspan>1` 的 primary 時啟用。
- 斜線僅在選到單一未合併格時啟用；已是斜線格則工具列改顯示「取消斜線」。
- 刪除整列/欄時若該軸有 primary 跨越 → 對應 primary 的 span 減 1（降到 1 即恢復普通格）。
- undo/redo 到邊界時按鈕停用。
- 表頭列（th）可合併、可斜線（序列化依 `isHeader` 出 th）。

## 7. 測試（canary-first，≥10 BDD，亮+暗）

1. 合併 2×1（橫向）→ colspan=2、其餘格消失
2. 合併 1×2（縱向）→ rowspan=2
3. 合併 2×2 → colspan=2 rowspan=2
4. 表頭列合併 → 輸出 `<th colspan>`
5. 分割已合併格 → 還原獨立格
6. 合併含非空內容 → 跳確認；取消則不變、確定則保留左上清其餘
7. undo 合併 → 還原；redo → 重做
8. MD 表格合併 → 自動轉 HTML（存檔輸出 `<table>`）
9. 斜線建立 + 編輯上下標籤 → 渲染正確（DOM 有 .diag-cell + svg line + 2 span）
10. **斜線過 DOMPurify 不被濾**；且 `<svg onload>` XSS 仍被中和
11. **合併後插入欄**：原合併 span 仍正確（BUG 4 回歸）
12. 合併後刪列：跨越的 primary span 正確調整
- 外加：`parseHtmlTableToGrid → gridToHtmlTable` round-trip golden（span + diag 保真）

## 7a. 相關修復（順手納入）

- **暗色模式儲存格反白**：dark mode 下點擊表格內儲存格進入編輯時，該格背景變白（反白），與深色主題不搭。因本功能會大量在暗色模式測試表格編輯器，順手查出焦點/編輯狀態的 cell 樣式並修正（`src/index.css` 或 `InlineTableEditor` 的 inline style）。BDD 須在暗色模式驗證點擊/編輯格子無反白。

## 8. 風險

- 拖曳選取與既有單擊編輯的事件競態 → 用位移閾值區分。
- BUG 4 的 spannedBy 重算邏輯較易出錯 → 純函式 + golden 測試先行。
- DOMPurify 放行 svg 後的 XSS 面 → 明確測 `<svg onload>` 仍擋。
- `InlineTableEditor` 已是大元件 → 抽出純函式（merge/split/diag/spannedBy 重算）到可獨立測試的小單元。
