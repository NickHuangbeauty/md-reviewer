import { blockQuote, buildAnnotatedMd, buildLlmPrompt } from '../src/llmExport.js';
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
}

console.log('buildLlmPrompt:');
check('null when no marks', buildLlmPrompt('f.md', 'X', []) === null);
{
  const p = buildLlmPrompt('f.md', 'A\n\nB', [{ blockId: 'block-1', issue: 'bad' }]);
  check('prompt has instruction preamble', /問題清單/.test(p) && p.includes('不要杜撰'));
  check('prompt embeds annotated md', p.includes('[審核問題 #1]'));
  check('prompt names the file', p.includes('f.md'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
