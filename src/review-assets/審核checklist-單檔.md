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
