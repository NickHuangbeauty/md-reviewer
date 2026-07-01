// Single source of truth for the in-app version badge + release notes (更新日誌).
// Newest first. Each entry: { version, date: 'YYYY-MM-DD', added?, changed?, fixed? }.
// To cut a release: prepend a new entry here and bump package.json "version" to match.
// CURRENT_VERSION (the latest entry) drives the header badge, the "有什麼新功能" auto-popup,
// and window.mdReviewer.version.

export const RELEASES = [
  {
    version: '1.3.0',
    date: '2026-07-01',
    added: [
      '使用教學(新手導覽)— 聚光燈一步步帶你操作各功能,第一次進來自動開,右上「使用教學」可隨時重看',
      '導覽時自動載入一份示範文件,邊看邊有東西可操作(可隨時移除)',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-06-30',
    added: [
      '表格儲存格合併 / 分割 — 在「預覽編輯」直接框選儲存格視覺化合併，不必手寫 colspan',
      '斜線表頭（/）— 一格上下分兩個欄位標題',
      '合併支援跨已合併列、且串接所有內文（不會丟資料）',
      '版本徽章與更新日誌（就是這個視窗）',
    ],
    changed: [
      'UI 質感優化：扁平化邊框、移除浮動發光，整體更沉穩一致',
    ],
    fixed: [
      '雙擊 → 標記：現在會正確跳出標記視窗（先前會誤進編輯模式）',
      '暗色主題下儲存格編輯反白的問題',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-03-26',
    added: [
      'Embed 嵌入模式 + window.mdReviewer API（可被 iframe / 外部程式驅動）',
      '網址參數支援 ?theme=dark、?mode=embed',
      'KaTeX 數學公式、Mermaid 圖表渲染',
      'Canary 雙分支部署策略（canary 先驗證、不影響正式版）',
    ],
    changed: [
      'Diff 引擎改進：大型差異串流渲染更順',
    ],
    fixed: [
      'HTML 內容 XSS 防護（DOMPurify 淨化，阻擋 script / onerror / javascript: 等）',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-03-03',
    added: [
      '批次 Markdown / HTML 文檔審核：解析後 MD 與原始文件比對',
      '差異比對引擎 + 變更幅度統計儀表板',
      '亮色 / 暗色主題切換',
      '審核標記、匯入 / 匯出狀態、下載 MD / ZIP',
      'Feature Flag 遠端控制系統',
    ],
  },
];

export const CURRENT_VERSION = RELEASES[0].version;
