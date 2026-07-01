# LLM 友善審核輸出 — 設計 spec（v1.4.0）

日期：2026-07-01
分支：`feat/table-cell-merge-diagonal`（延續）
狀態：設計已與使用者確認，待寫 implementation plan

## 目標（Why）

讓 BU 的審核回饋擺脫「截圖 + Excel」。BU 在 md-reviewer 對「解析後 MD vs 原始文件」逐段檢查，用**傻瓜級**的標記把問題就地標好；下載的 MD 本身帶著「問題 + 位置」，可直接丟給 LLM（VSCode 的 codex / Claude / ChatGPT）產出**問題清單報告**，取代人工 Excel 回饋。

決策摘要（使用者確認）：
1. LLM 比對在**外部**（工具先產 LLM 友善檔；內建一鍵 review 之後再做）。
2. LLM 產出＝**問題清單報告**（編號／位置／原文／問題／建議修正）。
3. 交付＝**強化版下載 MD** ＋ **新增「複製 LLM 提示」按鈕**（兩者都給）。
4. 標記體驗要**傻瓜級**：段落 hover 🚩 快標 ＋ 選字浮動列「標記」，**問題描述選填**。
5. 註解採 **Approach B 錨定**（編號 + 引文 + 開頭問題總表）。

## 非目標（YAGNI）

- 不做工具內建呼叫 LLM API（列為未來 Phase 2）。
- 不引入問題分類/嚴重度的固定選單（描述為自由文字；嚴重度交給 LLM 判定）。
- 不上傳「原始來源文件（PDF）」進工具比對；LLM 依標記 + 內文作業。

## 資料模型

Mark（現況 → 擴充）：
```
{ blockId: 'block-<n>',   // 既有：定位到區塊
  issue: string,          // 既有：問題描述 —— 改為「選填」，可為 ''
  quote?: string }        // 新增（選填）：選字標記時＝BU 圈選的文字；供精準錨定
```
- `remapBlockMarks`（MdReviewer.jsx:572）已接上所有區塊操作（插入/刪除/上移/下移，3827–3870），標記定位在編輯後維持正確；本功能加回歸測試守住。
- 匯入舊備份相容：無 `quote` 欄位者照舊運作。

## 元件與職責

### 1. `src/llmExport.js`（新，純函式、framework-free、可單元測試）
取代現有 3 行 `injectMarksToMd`。匯出：

- `blockQuote(blockText, max=24)` → 取區塊首行/前 N 字為引文摘要（去 markdown 記號、壓空白）。
- `annotationFor(mark, blockText, n)` → 產單條註解字串：
  - 引文來源：`mark.quote`（選字標記）優先，否則 `blockQuote(blockText)`。
  - 問題文字：`mark.issue.trim()` 或無描述時填 `(未填述，BU 標示此處有誤)`。
  - `-->` 逸出為 `—>`（issue 與 quote 都要）。
  - 格式：`<!-- [審核問題 #n] 段落:「<引文>」｜問題:<問題> -->`
- `buildAnnotatedMd(content, marks)` → 強化版下載 MD：
  - 無標記 → 原樣回傳（不注入任何 header）。
  - 有標記 → 檔首注入「給 LLM 的說明 + 問題總表」註解區塊；每個區塊後接其標記註解（依 blockId 分組，編號全域遞增、與總表一致）。
- `buildLlmPrompt(fileName, content, marks)` → 可直接貼的字串：
  - 前言（角色/任務/輸出欄位/「只依標記與內文、不得杜撰」）＋ 一行空行 ＋ `buildAnnotatedMd(...)` 結果。
  - 無標記 → 回傳 null（呼叫端據此 disable 按鈕）。

輸出範例（下載 MD）：
```markdown
<!-- ═══ 審核回饋｜給 LLM 的說明 ═══
  本檔含 2 處 BU 標記，格式 [審核問題 #n]，置於所指段落正下方。
  請逐條產出問題清單報告，欄位：編號／位置(第幾段)／原文摘錄／問題描述／建議修正／嚴重度。
  只依標記與內文判斷，不要杜撰。
  問題總表：
    #1「保險費率為千分之三…」— 原文應為千分之五，誤植為千分之三
    #2「理賠時採實損實賠…」—（未填述，BU 標示此處有誤）
═══════════════════════════ -->

# 火災保險投保須知
…
保險費率為千分之三，保額上限為重置成本。
<!-- [審核問題 #1] 段落:「保險費率為千分之三…」｜問題:原文應為千分之五，誤植為千分之三 -->
```

### 2. MdReviewer.jsx 接線
- **下載 MD / ZIP**：`injectMarksToMd` → `buildAnnotatedMd`（downloadFile ~3978、downloadZip ~3988）。
- **新按鈕「複製 LLM 提示」**（header，`activeFile.marks.length===0` 時 disabled）：
  - 點擊 → `navigator.clipboard.writeText(buildLlmPrompt(...))` → 成功顯示輕量提示（toast/短暫文字）。
  - 剪貼簿 API 不可用（非安全內容）→ fallback modal 顯示文字供手動複製。
- **標記 UX（傻瓜級）**
  - **段落 hover 🚩**：InlineBlock hover 時於區塊左/右緣浮現小 🚩 鈕 → 點擊開 MarkPopup（沿用），描述選填。
  - **選字「標記」**：既有選字浮動工具列加一顆 🚩「標記」→ 以選取文字建立含 `quote` 的標記（開 MarkPopup 預填/或直接建立）。
  - **MarkPopup**：`儲存` 不再要求 `issue.trim()` 非空；空白＝bare flag。空白標記於檢視上仍顯示（沿用紅點/計數）。
  - 雙擊維持可用。
- **導覽新增一步**（TOUR_STEPS）：聚光燈打亮 🚩 錨點，說明「標記會寫進下載的 MD，可直接丟 LLM」。加 `data-tour="mark"` 錨點。

## 錯誤處理

- 無標記：下載 MD 原樣（不含 header）；「複製 LLM 提示」disabled。
- 剪貼簿失敗：fallback modal 手動複製；不丟未捕捉例外。
- 註解注入：`-->` 逸出，避免破壞 HTML 註解。
- 空描述標記：匯出以 `(未填述，BU 標示此處有誤)` 佔位，報告仍有位置資訊。

## 測試

`tests/llmExport.test.mjs`（golden，node 執行，仿 tableModel.test.mjs）：
- 編號全域遞增且總表與內文一致
- `quote` 優先於區塊摘要；無 quote 時用 blockQuote
- 空 issue → 佔位字串
- `-->` 逸出
- 無標記 → 原樣、buildLlmPrompt 回 null
- blockQuote 去記號/壓空白/截斷

BDD（≥10，canary 亮+暗）：
1. hover 段落浮現 🚩　2. 點 🚩 開 popup　3. 空描述可存（bare flag）
4. 選字 → 浮動列「標記」→ 建含 quote 的標記
5. 下載 MD 含 `#n` + 引文 + 開頭總表
6. 「複製 LLM 提示」複製到剪貼簿且含前言 + 錨定 MD
7. 無標記時按鈕 disabled
8. 導覽新步驟打亮 🚩
9. **區塊搬移後標記仍錨定正確**（回歸）
10. 暗色主題 popup/按鈕/toast 可讀

## DevOps（使用者紀律，嚴格）

1. 本機 canary 5175（亮+暗）→ 2. 本機 prod 5174 gate → 3. commit →
4. **code review（使用者要求；完成後、部署前）** → 5. push canary 線上驗證 →
6. **停，等使用者點頭** → 7. merge main（線上正式版）→ 8. 線上 prod 驗證。
- 版本 bump **v1.4.0** + `src/releases.js` 一筆（新增：LLM 友善匯出 + 傻瓜級標記）。
- 不直接上正式版；每步不可跳。

## 風險 / 待確認

- hover 🚩 位置需避免與左側區塊手柄（GripVertical）/ TOC 衝突 → 實作時取右緣或段落內浮層。
- 選字標記與現有選字格式工具列並存，需確保不誤觸編輯/格式化。
