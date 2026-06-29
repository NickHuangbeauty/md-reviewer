// MCP 工具實作（可測試模組）
// server.js 只負責註冊；本檔匯出每個工具的 handler 與 input JSON schema。
// 直接 import 專案內的純核心（src/lib/*，ESM，保留 .js 副檔名）。
// 注意：sanitize.js / download.js 依賴瀏覽器，MCP 不可使用。

import {
  parseMdTableToGrid,
  parseHtmlTableToGrid,
  gridToMdTable,
  gridToHtmlTable,
  mergeCells,
  splitCell,
} from '../src/lib/table.js';
import { splitMdBlocks, parseBlockToHtml } from '../src/lib/markdown.js';
import { injectMarksToMd } from '../src/lib/marks.js';

/** 預設視覺檢閱器網址（GitHub Pages 正式版） */
export const DEFAULT_BASE_URL = 'https://NickHuangbeauty.github.io/md-reviewer/';

/** 結構化錯誤輔助：回傳 MCP isError 形式的內容 */
function errResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: '錯誤：' + message }],
  };
}

/** 成功文字結果輔助 */
function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

/**
 * 為 Markdown 來源的 grid 補上 cellMeta。
 * parseMdTableToGrid 只產生 cells / isHeader，但 gridToHtmlTable 需要每格的 cellMeta
 * （否則會跳過所有非 primary 格而輸出空 <tr>）。此處依 row.isHeader 補上預設 meta。
 * 已有 cellMeta（HTML 來源）則原樣保留。回傳同一 grid（就地補上，輸入為剛解析的暫時物件）。
 */
function ensureCellMeta(grid) {
  if (!grid) return grid;
  grid.forEach(row => {
    if (!row.cellMeta) {
      row.cellMeta = row.cells.map(() => ({
        colspan: 1, rowspan: 1, isHeader: !!row.isHeader,
        style: '', align: '', height: '', primary: true,
      }));
    }
  });
  return grid;
}

/** UTF-8 安全的 base64 編碼（Node Buffer） */
export function encodeFilesToBase64(files) {
  const json = JSON.stringify({ files });
  return Buffer.from(json, 'utf-8').toString('base64');
}

/** UTF-8 安全的 base64 解碼，回傳 files 陣列 */
export function decodeBase64ToFiles(b64) {
  const json = Buffer.from(b64, 'base64').toString('utf-8');
  const data = JSON.parse(json);
  return Array.isArray(data) ? data : data.files;
}

/* ===================== 工具定義 ===================== */
// 每個工具：{ name, description, inputSchema, handler }
// handler(args) → MCP CallTool 結果（{ content: [...] } 或 { isError, content }）。
// 全部 try/catch，無效輸入回傳結構化錯誤，絕不 crash。

export const tools = {
  diff_markdown: {
    name: 'diff_markdown',
    description: '比對兩份 Markdown 文字，回傳差異編輯清單與統計（edits、stats）。依賴 src/lib/diff.js 的 computeDiff（由另一代理整合，可能尚未存在）。',
    inputSchema: {
      type: 'object',
      properties: {
        old: { type: 'string', description: '舊版 Markdown 原文' },
        new: { type: 'string', description: '新版 Markdown 原文' },
        opts: { type: 'object', description: '可選的 computeDiff 設定', additionalProperties: true },
      },
      required: ['old', 'new'],
    },
    async handler(args) {
      try {
        const { old, new: newText, opts } = args || {};
        if (typeof old !== 'string' || typeof newText !== 'string') {
          return errResult('old 與 new 皆須為字串');
        }
        // 動態 import + try/catch：diff 核心可能尚未由另一代理整合
        let computeDiff;
        try {
          const mod = await import('../src/lib/diff.js');
          computeDiff = mod.computeDiff;
        } catch {
          return errResult('diff 核心尚未整合（src/lib/diff.js 尚不存在，待另一代理建立）');
        }
        if (typeof computeDiff !== 'function') {
          return errResult('diff 核心尚未整合（computeDiff 匯出不存在）');
        }
        const result = computeDiff(old, newText, opts || {});
        return textResult(JSON.stringify(result, null, 2));
      } catch (e) {
        return errResult('diff_markdown 失敗：' + (e?.message || String(e)));
      }
    },
  },

  markdown_to_html: {
    name: 'markdown_to_html',
    description: '將 Markdown 文件轉為 HTML：先 splitMdBlocks 切塊，逐塊 parseBlockToHtml，再以兩個換行接起。',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Markdown 原文' },
      },
      required: ['markdown'],
    },
    handler(args) {
      try {
        const { markdown } = args || {};
        if (typeof markdown !== 'string') return errResult('markdown 須為字串');
        const blocks = splitMdBlocks(markdown);
        const html = blocks.map(b => parseBlockToHtml(b)).join('\n\n');
        return textResult(html);
      } catch (e) {
        return errResult('markdown_to_html 失敗：' + (e?.message || String(e)));
      }
    },
  },

  table_md_to_html: {
    name: 'table_md_to_html',
    description: '將 Markdown 表格轉為 HTML 表格（parseMdTableToGrid → gridToHtmlTable）。',
    inputSchema: {
      type: 'object',
      properties: {
        md_table: { type: 'string', description: 'Markdown 表格原文（含 | 分隔）' },
      },
      required: ['md_table'],
    },
    handler(args) {
      try {
        const { md_table } = args || {};
        if (typeof md_table !== 'string') return errResult('md_table 須為字串');
        const grid = parseMdTableToGrid(md_table);
        if (!grid) return errResult('無法解析為 Markdown 表格');
        return textResult(gridToHtmlTable(ensureCellMeta(grid)));
      } catch (e) {
        return errResult('table_md_to_html 失敗：' + (e?.message || String(e)));
      }
    },
  },

  table_html_to_md: {
    name: 'table_html_to_md',
    description: '將 HTML 表格轉為 Markdown 表格（parseHtmlTableToGrid → gridToMdTable）。',
    inputSchema: {
      type: 'object',
      properties: {
        html_table: { type: 'string', description: 'HTML 表格原文（含 <table>）' },
      },
      required: ['html_table'],
    },
    handler(args) {
      try {
        const { html_table } = args || {};
        if (typeof html_table !== 'string') return errResult('html_table 須為字串');
        const grid = parseHtmlTableToGrid(html_table);
        if (!grid) return errResult('無法解析為 HTML 表格');
        return textResult(gridToMdTable(grid));
      } catch (e) {
        return errResult('table_html_to_md 失敗：' + (e?.message || String(e)));
      }
    },
  },

  merge_cells: {
    name: 'merge_cells',
    description: '合併 HTML 表格中矩形範圍 (r1,c1)-(r2,c2) 的儲存格為單一儲存格（左上為主格，含 colspan/rowspan），回傳新的 HTML 表格。座標為 0-based。',
    inputSchema: {
      type: 'object',
      properties: {
        html_table: { type: 'string', description: 'HTML 表格原文' },
        r1: { type: 'integer', description: '起始列（0-based）' },
        c1: { type: 'integer', description: '起始欄（0-based）' },
        r2: { type: 'integer', description: '結束列（0-based）' },
        c2: { type: 'integer', description: '結束欄（0-based）' },
      },
      required: ['html_table', 'r1', 'c1', 'r2', 'c2'],
    },
    handler(args) {
      try {
        const { html_table, r1, c1, r2, c2 } = args || {};
        if (typeof html_table !== 'string') return errResult('html_table 須為字串');
        for (const [k, v] of [['r1', r1], ['c1', c1], ['r2', r2], ['c2', c2]]) {
          if (!Number.isInteger(v)) return errResult(`${k} 須為整數`);
        }
        const grid = parseHtmlTableToGrid(html_table);
        if (!grid) return errResult('無法解析為 HTML 表格');
        const merged = mergeCells(grid, r1, c1, r2, c2);
        return textResult(gridToHtmlTable(merged));
      } catch (e) {
        return errResult('merge_cells 失敗：' + (e?.message || String(e)));
      }
    },
  },

  split_cell: {
    name: 'split_cell',
    description: '將 HTML 表格中位於 (r,c) 的已合併主格拆回一般儲存格（colspan/rowspan 還原為 1），回傳新的 HTML 表格。座標為 0-based。',
    inputSchema: {
      type: 'object',
      properties: {
        html_table: { type: 'string', description: 'HTML 表格原文' },
        r: { type: 'integer', description: '主格所在列（0-based）' },
        c: { type: 'integer', description: '主格所在欄（0-based）' },
      },
      required: ['html_table', 'r', 'c'],
    },
    handler(args) {
      try {
        const { html_table, r, c } = args || {};
        if (typeof html_table !== 'string') return errResult('html_table 須為字串');
        if (!Number.isInteger(r) || !Number.isInteger(c)) return errResult('r 與 c 須為整數');
        const grid = parseHtmlTableToGrid(html_table);
        if (!grid) return errResult('無法解析為 HTML 表格');
        const split = splitCell(grid, r, c);
        return textResult(gridToHtmlTable(split));
      } catch (e) {
        return errResult('split_cell 失敗：' + (e?.message || String(e)));
      }
    },
  },

  apply_review_marks: {
    name: 'apply_review_marks',
    description: '將審核註解（marks）以 HTML 註解形式注入 Markdown 內容對應區塊之後（injectMarksToMd）。mark 需含 blockId（如 block-0）與 issue 文字。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Markdown 原文' },
        marks: {
          type: 'array',
          description: '審核標記清單',
          items: {
            type: 'object',
            properties: {
              blockId: { type: 'string', description: '對應區塊 ID，如 block-0' },
              issue: { type: 'string', description: '審核問題描述' },
            },
            required: ['blockId', 'issue'],
          },
        },
      },
      required: ['content', 'marks'],
    },
    handler(args) {
      try {
        const { content, marks } = args || {};
        if (typeof content !== 'string') return errResult('content 須為字串');
        if (!Array.isArray(marks)) return errResult('marks 須為陣列');
        return textResult(injectMarksToMd(content, marks));
      } catch (e) {
        return errResult('apply_review_marks 失敗：' + (e?.message || String(e)));
      }
    },
  },

  open_review: {
    name: 'open_review',
    description: '把多個檔案編碼進 URL hash，回傳可點連結。開啟此連結即可在視覺檢閱器載入這些檔案供人工核對／編修（human-in-the-loop）。',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: '要載入檢閱器的檔案清單',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '檔名' },
              content: { type: 'string', description: '檔案內容（Markdown）' },
              originalContent: { type: 'string', description: '可選的原始內容（供 diff 對照）' },
            },
            required: ['name', 'content'],
          },
        },
        baseUrl: { type: 'string', description: `檢閱器網址，預設 ${DEFAULT_BASE_URL}` },
      },
      required: ['files'],
    },
    handler(args) {
      try {
        const { files, baseUrl } = args || {};
        if (!Array.isArray(files) || files.length === 0) {
          return errResult('files 須為非空陣列');
        }
        for (const f of files) {
          if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') {
            return errResult('每個 file 須含字串 name 與 content');
          }
        }
        const base = (typeof baseUrl === 'string' && baseUrl) ? baseUrl : DEFAULT_BASE_URL;
        const b64 = encodeFilesToBase64(files);
        const url = `${base}#review=${b64}`;
        return textResult(
          `已產生檢閱連結（共 ${files.length} 個檔案）：\n${url}\n\n` +
          '開啟此連結即可在視覺檢閱器載入這些檔案供人工核對／編修。'
        );
      } catch (e) {
        return errResult('open_review 失敗：' + (e?.message || String(e)));
      }
    },
  },
};

/** 工具清單陣列（供 server 註冊與 tools/list） */
export const toolList = Object.values(tools);
