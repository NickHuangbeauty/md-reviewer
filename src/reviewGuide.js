// src/reviewGuide.js
// Pure assembler for the review package (下載審核包). Given the annotated MD and the
// three skill-doc strings, return the [{name, content}] array for createZip().
// Kept free of Vite `?raw` imports so node can unit-test it; the ?raw imports and
// buildAnnotatedMd call live in MdReviewer.jsx.
export function assembleReviewPackage({ fileName, annotatedMd, protocolFull, checklistSingle, readme }) {
  return [
    { name: '審核後.md', content: annotatedMd },
    { name: '審核協議-完整.md', content: protocolFull },
    { name: '審核checklist-單檔.md', content: checklistSingle },
    { name: 'README.md', content: readme },
  ];
}
