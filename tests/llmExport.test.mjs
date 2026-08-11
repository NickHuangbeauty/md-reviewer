import { blockQuote, buildAnnotatedMd, buildLlmPrompt } from '../src/llmExport.js';
import { splitMdBlocks } from '../src/mdBlocks.js';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

console.log('blockQuote:');
check('strips heading marks + truncates at max', blockQuote('## 保險費率為千分之三，保額上限', 8) === '保險費率為千分之…');
check('collapses whitespace (first line only)', blockQuote('a   b\n c') === 'a b');
check('strips list marker', blockQuote('- 項目一') === '項目一');

console.log('buildAnnotatedMd:');
{
  const md = 'A 段\n\nB 段\n\nC 段';
  const marks = [{ blockId: 'block-1', issue: 'B 有誤' }];
  const out = buildAnnotatedMd(md, marks);
  check('inline anchored comment after its block', /B 段\n\n<!-- \[審核問題 #1\][^\n]*問題:B 有誤 -->/.test(out));
  check('header summary present with #1', out.includes('問題總表') && out.includes('#1'));
  check('quote defaults to block excerpt', out.includes('段落:「B 段'));
  check('untouched block C intact', out.includes('C 段'));
}
{
  const out = buildAnnotatedMd('X', []);
  check('no marks -> unchanged, no header', out === 'X');
}
{
  const marks = [{ blockId: 'block-0', issue: '', quote: '千分之三' }];
  const out = buildAnnotatedMd('保險費率為千分之三', marks);
  check('empty issue -> placeholder', out.includes('未填述'));
  check('quote overrides block excerpt', out.includes('段落:「千分之三」'));
}
{
  const marks = [{ blockId: 'block-0', issue: 'a --> b' }];
  const out = buildAnnotatedMd('para', marks);
  check('escapes --> in issue', out.includes('a —> b') && !/問題:a --> b/.test(out));
}
{
  // M1: --!> is also a comment terminator — must be neutralized so <script> stays inert
  const marks = [{ blockId: 'block-0', issue: 'evil --!> <script>x</script>' }];
  const out = buildAnnotatedMd('para', marks);
  check('escapes --!> terminator', !out.includes('--!>') && out.includes('—>'));
}
{
  // H1: two distinct marks on the same block → inline #1 and #2 must match the summary
  const marks = [{ blockId: 'block-0', issue: '第一' }, { blockId: 'block-0', issue: '第二' }];
  const out = buildAnnotatedMd('只有一段', marks);
  check('two marks same block get #1 and #2 inline', /#1\][^\n]*第一 -->/.test(out) && /#2\][^\n]*第二 -->/.test(out));
  check('count in header is 2', out.includes('本檔含 2 處'));
}
{
  // orphan mark (blockId out of range) still appears, numbered, at the end
  const out = buildAnnotatedMd('一段', [{ blockId: 'block-99', issue: '孤兒' }]);
  check('orphan mark rendered and numbered', /#1\][^\n]*孤兒 -->/.test(out) && out.includes('本檔含 1 處'));
  check('orphan without quote gets 位置未知 anchor, not empty 「」', out.includes('位置未知') && !out.includes('段落:「」'));
  // legacy cell-level id (not block-<n>) is also an orphan
  const legacy = buildAnnotatedMd('一段', [{ blockId: 'cell-2-3', issue: '舊格式' }]);
  check('legacy cell-id orphan anchored, not empty', legacy.includes('位置未知') && !legacy.includes('段落:「」'));
  // an orphan WITH a user selection still uses that quote (it is locatable)
  const oq = buildAnnotatedMd('一段', [{ blockId: 'block-99', issue: 'x', quote: '選到的字' }]);
  check('orphan with quote keeps the quote as anchor', oq.includes('段落:「選到的字」') && !oq.includes('位置未知'));
}
{
  // REGRESSION: multi-line issue/quote must not break the single-line comment.
  // A newline would split <!-- ... --> across blocks (splitMdBlocks breaks on blank
  // lines), leaking `… -->` as visible text and shifting later block indices.
  const md = 'A 段\n\nB 段\n\nC 段';
  const out = buildAnnotatedMd(md, [{ blockId: 'block-1', issue: '這裡數字錯了\n\n而且單位也不對' }]);
  const blocks = splitMdBlocks(out);
  const leaked = blocks.some(b => !b.startsWith('<!--') && b.includes('-->'));
  check('multi-line issue collapsed → comment stays on one line', !leaked);
  check('multi-line issue text preserved (space-joined)', out.includes('這裡數字錯了 而且單位也不對'));
  const outQ = buildAnnotatedMd(md, [{ blockId: 'block-1', issue: 'x', quote: '第一行\n第二行' }]);
  check('multi-line quote collapsed too', !splitMdBlocks(outQ).some(b => !b.startsWith('<!--') && b.includes('-->')));
  // round-trip: re-parsing the export must not gain stray body blocks
  const clean = buildAnnotatedMd(md, [{ blockId: 'block-1', issue: '單行沒問題' }]);
  check('single-line issue unaffected', !splitMdBlocks(clean).some(b => !b.startsWith('<!--') && b.includes('-->')));
}

console.log('buildLlmPrompt:');
check('null when no marks', buildLlmPrompt('f.md', 'X', []) === null);
{
  const p = buildLlmPrompt('f.md', 'A\n\nB', [{ blockId: 'block-1', issue: 'bad' }]);
  check('prompt has instruction preamble', /問題清單/.test(p) && p.includes('不要杜撰'));
  check('prompt embeds annotated md', p.includes('[審核問題 #1]'));
  check('prompt names the file', p.includes('f.md'));
  check('prompt is domain-general (no 產險/BU)', !p.includes('產險') && !p.includes('業務單位') && !/BU/.test(p));
  check('prompt de-dupes: has 問題總表 but NOT the full 給 LLM 的說明 header', p.includes('問題總表') && !p.includes('給 LLM 的說明'));
}
{
  // standalone download keeps the full explanatory header
  const md = buildAnnotatedMd('A\n\nB', [{ blockId: 'block-1', issue: 'bad' }]);
  check('download (full) keeps 給 LLM 的說明', md.includes('給 LLM 的說明'));
  const summ = buildAnnotatedMd('A\n\nB', [{ blockId: 'block-1', issue: 'bad' }], { header: 'summary' });
  check('summary mode: 問題總表 only, no instructions', summ.includes('問題總表') && !summ.includes('給 LLM 的說明'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
