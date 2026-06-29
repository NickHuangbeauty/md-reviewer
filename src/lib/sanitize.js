// HTML sanitizer (M1) — wraps DOMPurify with an allowlist tuned for this app's
// rich rendering. RAG / user-supplied Markdown can embed raw HTML (tables with
// colspan/rowspan, inline styles, scoped <style> blocks). We must keep that
// formatting working while removing XSS vectors (<script>, on* handlers,
// javascript: URLs). Browser-only — do NOT import from node-side pure libs.
import DOMPurify from 'dompurify';

// Allow scoped <style> blocks the renderer emits; everything else uses
// DOMPurify's safe HTML defaults (which already keep class/style/colspan/
// rowspan/align and strip scripts, event handlers and javascript: URLs).
const CONFIG = {
  ADD_TAGS: ['style'],
  ADD_ATTR: ['target'],
};

/**
 * Sanitize an HTML string before injecting via dangerouslySetInnerHTML.
 * @param {string} html
 * @returns {string} sanitized HTML (safe to inject)
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return html || '';
  return DOMPurify.sanitize(html, CONFIG);
}
