import { assembleReviewPackage } from '../src/reviewGuide.js';
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n); } };

console.log('assembleReviewPackage:');
{
  const pkg = assembleReviewPackage({ fileName: 'x.md', annotatedMd: 'AMD', protocolFull: 'P', checklistSingle: 'C', readme: 'R' });
  check('4 files', pkg.length === 4);
  check('names + order', pkg.map(f => f.name).join(',') === '審核後.md,審核協議-完整.md,審核checklist-單檔.md,README.md');
  check('審核後.md content = annotatedMd', pkg[0].content === 'AMD');
  check('協議/checklist/readme content passthrough', pkg[1].content === 'P' && pkg[2].content === 'C' && pkg[3].content === 'R');
}

console.log('asset files (fs):');
const asset = (p) => readFileSync(new URL('../src/review-assets/' + p, import.meta.url), 'utf8');
{
  const P = asset('審核協議-完整.md');
  check('協議關鍵句', P.includes('全量 source-vs-MD 交付審定協議') && P.includes('ledger_rows == source_units') && P.includes('gate PASS 前不准宣稱可交付'));
  const C = asset('審核checklist-單檔.md');
  check('checklist 關鍵句', C.includes('單檔 gate') && C.includes('ADJUDICATED_CLEAN') && C.includes('long_pipe') && C.includes('UNREVIEWED = 0'));
  const R = asset('README.md');
  check('README 關鍵句', R.includes('真正的來源文件') && R.includes('依 審核協議-完整.md') && R.includes('乾淨'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
