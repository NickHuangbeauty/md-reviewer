// MCP 工具單元測試 + server 啟動 smoke
// 執行：node tests/mcp.test.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  tools,
  toolList,
  encodeFilesToBase64,
  decodeBase64ToFiles,
  DEFAULT_BASE_URL,
} from '../mcp/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '../mcp/server.js');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '\n    ' + (e?.message || e));
  }
}

/** 從 MCP 工具結果取出文字 */
function textOf(result) {
  assert.ok(result && Array.isArray(result.content), '結果須含 content 陣列');
  return result.content.map(c => c.text).join('');
}

console.log('# MCP 工具單元測試');

await test('markdown_to_html 產生含 <h1> 與 <table> 的 HTML', async () => {
  const md = '# 標題\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
  const out = textOf(await tools.markdown_to_html.handler({ markdown: md }));
  assert.ok(out.includes('<h1>'), '應含 <h1>');
  assert.ok(/<table/i.test(out), '應含 <table>');
});

await test('table_md_to_html / table_html_to_md 來回轉換', async () => {
  const mdTable = '| 名稱 | 數量 |\n| --- | --- |\n| 蘋果 | 3 |\n| 香蕉 | 5 |';
  const html = textOf(await tools.table_md_to_html.handler({ md_table: mdTable }));
  assert.ok(/<table/i.test(html), 'md→html 應產生 <table>');
  assert.ok(html.includes('蘋果'), '應保留內容「蘋果」');
  const backMd = textOf(await tools.table_html_to_md.handler({ html_table: html }));
  assert.ok(backMd.includes('蘋果') && backMd.includes('香蕉'), 'html→md 應保留內容');
  assert.ok(backMd.includes('|'), 'html→md 應為 markdown 表格');
});

await test('merge_cells 輸出含 colspan="2"', async () => {
  const mdTable = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
  const html = textOf(await tools.table_md_to_html.handler({ md_table: mdTable }));
  const merged = textOf(await tools.merge_cells.handler({ html_table: html, r1: 1, c1: 0, r2: 1, c2: 1 }));
  assert.ok(/colspan="2"/.test(merged), '應含 colspan="2"，實得：\n' + merged);
});

await test('split_cell 還原合併', async () => {
  const mdTable = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
  const html = textOf(await tools.table_md_to_html.handler({ md_table: mdTable }));
  const merged = textOf(await tools.merge_cells.handler({ html_table: html, r1: 1, c1: 0, r2: 1, c2: 1 }));
  assert.ok(/colspan="2"/.test(merged), '前置：合併後應含 colspan');
  const split = textOf(await tools.split_cell.handler({ html_table: merged, r: 1, c: 0 }));
  assert.ok(!/colspan="2"/.test(split), '拆分後不應再含 colspan="2"，實得：\n' + split);
});

await test('apply_review_marks 注入審核註解', async () => {
  const content = '# 第一段\n\n第二段內容';
  const marks = [{ blockId: 'block-0', issue: '標題需更明確' }];
  const out = textOf(await tools.apply_review_marks.handler({ content, marks }));
  assert.ok(out.includes('[審核問題] 標題需更明確'), '應注入審核註解，實得：\n' + out);
});

await test('open_review 回傳含 #review= 的 URL 且 base64 可解回原 files', async () => {
  const files = [
    { name: 'a.md', content: '# 你好\n世界' },
    { name: 'b.md', content: '第二個檔案', originalContent: '原始' },
  ];
  const out = textOf(await tools.open_review.handler({ files }));
  assert.ok(out.includes('#review='), '應含 #review=');
  const m = out.match(/#review=([A-Za-z0-9+/=]+)/);
  assert.ok(m, '應能擷取 base64');
  const decoded = decodeBase64ToFiles(m[1]);
  assert.strictEqual(decoded.length, 2, '應解回 2 個檔案');
  assert.strictEqual(decoded[0].name, 'a.md');
  assert.strictEqual(decoded[0].content, '# 你好\n世界', 'UTF-8 內容應完整保留');
  assert.ok(out.includes(DEFAULT_BASE_URL), '應使用預設 baseUrl');
});

await test('open_review 自訂 baseUrl 與編碼/解碼互逆', async () => {
  const files = [{ name: 'x.md', content: '測試中文' }];
  const out = textOf(await tools.open_review.handler({ files, baseUrl: 'http://localhost:5196/md-reviewer/canary/' }));
  assert.ok(out.includes('http://localhost:5196/md-reviewer/canary/#review='), '應用自訂 baseUrl');
  const b64 = encodeFilesToBase64(files);
  assert.deepStrictEqual(decodeBase64ToFiles(b64), files, 'encode/decode 應互逆');
});

await test('open_review 對無效輸入回傳結構化錯誤（不 crash）', async () => {
  const out = await tools.open_review.handler({ files: [] });
  assert.ok(out.isError, '空 files 應為錯誤');
  const out2 = await tools.markdown_to_html.handler({ markdown: 123 });
  assert.ok(out2.isError, '非字串 markdown 應為錯誤');
});

await test('diff_markdown：diff 核心尚未整合時回傳明確錯誤', async () => {
  const out = await tools.diff_markdown.handler({ old: 'a', new: 'b' });
  // diff.js 可能由另一代理建立。若不存在 → isError + 明確訊息；若存在 → 成功回傳。
  if (out.isError) {
    assert.ok(textOf(out).includes('diff 核心尚未整合'), '錯誤訊息應說明尚未整合');
    console.log('    （備註：src/lib/diff.js 尚未存在，符合預期）');
  } else {
    const txt = textOf(out);
    assert.ok(txt.includes('edits') || txt.includes('stats'), 'diff.js 已整合，應回傳 edits/stats');
    console.log('    （備註：src/lib/diff.js 已整合，diff_markdown 正常運作）');
  }
});

console.log('\n# server 啟動 smoke（child_process + MCP client）');

await test('server 可啟動且 tools/list 回傳完整工具清單', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
  });
  const client = new Client({ name: 'mcp-test', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    const names = list.tools.map(t => t.name).sort();
    const expected = toolList.map(t => t.name).sort();
    assert.deepStrictEqual(names, expected, 'tools/list 應與註冊清單一致');
    // 順帶實際呼叫一個工具，確認 over-the-wire 也能運作
    const call = await client.callTool({ name: 'markdown_to_html', arguments: { markdown: '# Hi' } });
    const txt = call.content.map(c => c.text).join('');
    assert.ok(txt.includes('<h1>'), 'over-the-wire 呼叫應回傳 HTML');
  } finally {
    await client.close();
  }
});

console.log(`\n結果：${passed} 通過、${failed} 失敗`);
if (failed > 0) process.exit(1);
