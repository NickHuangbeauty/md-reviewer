// Single source of truth for the in-app version badge + release notes (更新日誌).
// Newest first. Each entry: { version, date: 'YYYY-MM-DD', added?, changed?, fixed? }.
// To cut a release: prepend a new entry here and bump package.json "version" to match.
// CURRENT_VERSION (the latest entry) drives the header badge, the "有什麼新功能" auto-popup,
// and window.mdReviewer.version.

export const RELEASES = [
  {
    version: '1.6.0',
    date: '2026-08-11',
    added: [
      '「使用教學」改為自動載入 10 份示範文件：涵蓋流程圖、甘特圖、統計圖表（長條/折線/圓餅）、時序圖、狀態機、ER 圖、客戶旅程、心智圖、風險四象限、複雜合併表格與數學公式',
      '每份示範文件都埋了真實的解析瑕疵（多餘符號、表格缺格、句子截斷、亂碼、頁碼混入），可直接拿來練習標記',
    ],
    fixed: [
      '標記描述換行不再破壞下載檔的註解格式（原本會讓註解斷開、後續標記位置錯亂）',
      '選取文字後切換檔案，浮動標記鈕不再殘留（原本可能把標記加到別的檔案）',
      '直接編輯原始碼新增／刪除段落時，既有標記會自動重新對應到正確段落',
      '未填描述的標記在清單顯示「（未填述）」而非空白',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-07-02',
    added: [
      '「下載審核包」：一鍵打包 ZIP（審核後.md + 交付審定協議 + 單檔 checklist + README），拿到自己的 codex/VSCode 讓 AI 做 source-vs-MD 逐頁比對、找出漏掉的、修到完整、跑交付 gate',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-07-01',
    added: [
      'LLM 友善審核輸出：下載的 MD 帶「問題錨定註解 + 開頭問題總表」，可直接丟 LLM 產出問題清單報告，取代截圖+Excel',
      '「複製 LLM 提示」按鈕：一鍵複製「提示詞 + 帶標記內文」，貼進 codex/Claude 即可跑',
      '傻瓜級標記：段落 hover 🚩 快標、選取文字直接標；問題描述改為選填',
    ],
  },
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
