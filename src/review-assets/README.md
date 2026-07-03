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
