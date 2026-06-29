// Download / ZIP pure helpers — extracted from MdReviewer.jsx (Phase 1 refactor)
// Browser-side file download + a minimal ZIP (store, no compression) writer.
// No React. Behaviour identical to the original inline versions.

export function safeDownload(content, filename, mimeType) {
  console.log('=== safeDownload called ===');
  console.log('Original filename:', filename);
  console.log('MimeType:', mimeType);
  console.log('Content length:', content?.length);

  // Ensure filename has .md extension
  if (!filename.endsWith('.md')) {
    filename = filename + '.md';
  }
  console.log('Final filename:', filename);

  try {
    const blob = new Blob([content], { type: mimeType });
    console.log('Blob created, size:', blob.size);

    // For IE/Edge (legacy)
    if (typeof navigator !== 'undefined' && navigator.msSaveBlob) {
      console.log('Using msSaveBlob (IE/Edge)');
      navigator.msSaveBlob(blob, filename);
      return;
    }

    // Modern browsers - use FileSaver.js pattern
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.href = url;
    link.download = filename;

    console.log('Link created:');
    console.log('  - href:', link.href);
    console.log('  - download attribute:', link.download);
    console.log('  - link.getAttribute("download"):', link.getAttribute('download'));

    // Append to body (required for Firefox)
    document.body.appendChild(link);

    // Dispatch click event (more reliable than link.click())
    const event = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    link.dispatchEvent(event);
    console.log('Click event dispatched');

    // Cleanup after download starts
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      console.log('Cleanup completed');
    }, 100);

  } catch (e) {
    console.error('Download error:', e);
    // Fallback: prompt user to save manually
    try {
      const b64 = btoa(unescape(encodeURIComponent(content)));
      const dataUri = 'data:' + mimeType + ';base64,' + b64;
      const downloadLink = document.createElement('a');
      downloadLink.href = dataUri;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch {
      alert('下載失敗，請使用瀏覽器的「另存為」功能');
    }
  }
}

/* ===== ZIP ===== */
export function crc32(d) { let c = 0xFFFFFFFF; const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let v = i; for (let j = 0; j < 8; j++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1); t[i] = v; }
  for (let i = 0; i < d.length; i++) c = t[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function createZip(files) {
  const enc = new TextEncoder(); const lf = []; const cd = []; let off = 0;
  files.forEach(({ name, content }) => {
    const d = enc.encode(content); const n = enc.encode(name); const cr = crc32(d);
    const lo = new Uint8Array(30 + n.length + d.length); const lv = new DataView(lo.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
    lv.setUint32(14, cr, true); lv.setUint32(18, d.length, true); lv.setUint32(22, d.length, true);
    lv.setUint16(26, n.length, true); lv.setUint16(28, 0, true); lo.set(n, 30); lo.set(d, 30 + n.length); lf.push(lo);
    const ce = new Uint8Array(46 + n.length); const cv = new DataView(ce.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, cr, true); cv.setUint32(20, d.length, true); cv.setUint32(24, d.length, true);
    cv.setUint16(28, n.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, off, true);
    ce.set(n, 46); cd.push(ce); off += lo.length;
  });
  const cds = cd.reduce((s, c) => s + c.length, 0); const eo = new Uint8Array(22); const ev = new DataView(eo.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cds, true); ev.setUint32(16, off, true);
  return new Blob([...lf, ...cd, eo], { type: 'application/zip' });
}

export function safeDownloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(window.document.createElement('a'), { href: url, download: filename, style: 'display:none' });
    window.document.body.appendChild(link); link.click();
    setTimeout(() => { window.document.body.removeChild(link); URL.revokeObjectURL(url); }, 200);
  } catch {
    try {
      const reader = new FileReader();
      reader.onload = () => { const l = Object.assign(window.document.createElement('a'), { href: reader.result, download: filename, style: 'display:none' }); window.document.body.appendChild(l); l.click(); setTimeout(() => window.document.body.removeChild(l), 200); };
      reader.readAsDataURL(blob);
    } catch { alert('ZIP 下載失敗'); }
  }
}
