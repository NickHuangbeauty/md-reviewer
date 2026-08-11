// src/demoDocs.js
// The 使用教學 demo set: 10 realistic 產險 documents that between them exercise
// every renderer the app has (Mermaid flowchart / gantt / xychart / pie /
// sequence / state / ER / journey / mindmap / quadrant, merged-cell HTML tables,
// KaTeX) AND carry planted RAG parsing defects so the review workflow has
// something real to find.
//
// Source of truth: test-data/showcase/build-showcase.mjs writes both
// src/demo-assets/*.md (bundled here) and the manually-importable JSON.
// Mermaid CJK caveats are baked into the .md files — see §fact/mermaid-10-9-1-cjk-limits.
const modules = import.meta.glob('./demo-assets/*.md', { eager: true, as: 'raw' });

export const DEMO_DOCS = Object.keys(modules)
  .sort() // filenames are 01_…10_ so this is the intended reading order
  .map(path => ({
    name: path.replace('./demo-assets/', ''),
    content: modules[path],
  }));
