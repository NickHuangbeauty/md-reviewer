// Dashboard overview + stats hook — extracted from MdReviewer.jsx (Phase 2 refactor).
// Behavior verbatim. The diff Web Worker is resolved relative to this module.
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { X, BarChart3 } from 'lucide-react';
import { getAllFlags } from '../featureFlags.js';

// ===== Dashboard Stats Hook =====

export function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function useDashboardStats(files, isActive) {
  const workerRef = useRef(null);
  const cacheRef = useRef(new Map());
  const [allStats, setAllStats] = useState(new Map());
  const [computing, setComputing] = useState({ active: false, current: 0, total: 0 });
  const queueRef = useRef([]);
  const activeRef = useRef(false);

  useEffect(() => {
    const w = new Worker(new URL('../diffWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, type, stats, canary } = e.data;
      if (type === 'stats-complete') {
        // Canary report logging
        if (canary) {
          canary.violations?.forEach(v => console.warn('[Canary]', id, v.code, v.message));
          canary.suspicious?.forEach(s => console.warn('[Canary:Suspicious]', id, s.code, s.message));
        }
        cacheRef.current.set(id, stats);
        setAllStats(prev => new Map(prev).set(id, stats));
        setComputing(prev => {
          const next = { ...prev, current: prev.current + 1 };
          if (next.current >= next.total) next.active = false;
          return next;
        });
        // Process next in queue
        const nextFile = queueRef.current.shift();
        if (nextFile) {
          w.postMessage({ id: nextFile.id, mode: 'stats', oldText: nextFile.originalContent || '', newText: nextFile.content || '', flags: getAllFlags() });
        }
      }
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!isActive || !workerRef.current) return;
    activeRef.current = true;

    // Find files that need (re)computation
    const stale = files.filter(f => {
      if (!f.originalContent) return false;
      const hash = simpleHash(f.originalContent + '|' + f.content);
      const cached = cacheRef.current.get(f.id);
      if (cached && cached._hash === hash) return false;
      return true;
    });

    if (stale.length === 0) {
      // Populate allStats from cache
      const m = new Map();
      files.forEach(f => { if (cacheRef.current.has(f.id)) m.set(f.id, cacheRef.current.get(f.id)); });
      setAllStats(m);
      return;
    }

    setComputing({ active: true, current: 0, total: stale.length });

    // Tag cache entries with hash for invalidation
    stale.forEach(f => {
      const hash = simpleHash(f.originalContent + '|' + f.content);
      const placeholder = { _hash: hash, _pending: true };
      cacheRef.current.set(f.id, placeholder);
    });

    // Queue all stale files, start first
    queueRef.current = stale.slice(1);
    const first = stale[0];
    workerRef.current.postMessage({ id: first.id, mode: 'stats', oldText: first.originalContent || '', newText: first.content || '', flags: getAllFlags() });
  }, [isActive, files]);

  const recompute = useCallback(() => {
    cacheRef.current.clear();
    setAllStats(new Map());
  }, []);

  return { allStats, computing, recompute };
}

// ===== Dashboard Overview Component =====

export function getSeverityInfo(ratio) {
  if (ratio <= 0.05) return { label: '微量修改', color: '#10b981', bg: '#ecfdf5' };
  if (ratio <= 0.15) return { label: '適度修改', color: '#f59e0b', bg: '#fffbeb' };
  if (ratio <= 0.30) return { label: '大幅修改', color: '#f97316', bg: '#fff7ed' };
  return { label: '重大變更', color: '#ef4444', bg: '#fef2f2' };
}

export function DashboardOverview({ files, allStats, computing, onSelectFile, onClose }) {
  const fileRows = useMemo(() => {
    return files.map(f => {
      const stats = allStats.get(f.id);
      const hasOriginal = !!f.originalContent;
      const identical = hasOriginal && f.originalContent === f.content;
      const actualLines = hasOriginal ? f.originalContent.split('\n').length : (f.content || '').split('\n').length;
      return { ...f, stats, hasOriginal, identical, actualLines };
    }).sort((a, b) => {
      const ra = a.stats?.changeRatio ?? -1;
      const rb = b.stats?.changeRatio ?? -1;
      return rb - ra;
    });
  }, [files, allStats]);

  const summary = useMemo(() => {
    const withStats = fileRows.filter(r => r.stats && !r.stats._pending);
    const total = files.length;
    const computed = withStats.length;
    const avgRatio = computed > 0 ? withStats.reduce((s, r) => s + r.stats.changeRatio, 0) / computed : 0;
    const maxFile = withStats.length > 0 ? withStats.reduce((a, b) => (a.stats.changeRatio > b.stats.changeRatio ? a : b)) : null;
    const totalAdded = withStats.reduce((s, r) => s + r.stats.added, 0);
    const totalDeleted = withStats.reduce((s, r) => s + r.stats.deleted, 0);
    const totalModified = withStats.reduce((s, r) => s + r.stats.modified, 0);
    const totalUnchanged = withStats.reduce((s, r) => s + r.stats.unchanged, 0);
    return { total, computed, avgRatio, maxFile, totalAdded, totalDeleted, totalModified, totalUnchanged };
  }, [files, fileRows]);

  const avgSeverity = getSeverityInfo(summary.avgRatio);

  return (
    <div className="dash-container">
      <div className="dash-header">
        <div className="dash-title">
          <BarChart3 className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <span>差異儀表板</span>
        </div>
        <button onClick={onClose} className="dash-close"><X className="w-4 h-4" /></button>
      </div>

      {/* Summary Cards */}
      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-card-value">{summary.total}</div>
          <div className="dash-card-label">總檔案數</div>
          {computing.active && <div className="dash-card-sub">計算中 {computing.current}/{computing.total}...</div>}
        </div>
        <div className="dash-card" style={{ borderTopColor: avgSeverity.color }}>
          <div className="dash-card-value" style={{ color: avgSeverity.color }}>{(summary.avgRatio * 100).toFixed(1)}%</div>
          <div className="dash-card-label">平均變更率</div>
          <div className="dash-card-sub" style={{ color: avgSeverity.color }}>{avgSeverity.label}</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: '#10b981' }}>+{summary.totalAdded}</div>
          <div className="dash-card-label">總新增行</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: '#ef4444' }}>-{summary.totalDeleted}</div>
          <div className="dash-card-label">總刪除行</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: '#f59e0b' }}>~{summary.totalModified}</div>
          <div className="dash-card-label">總修改行</div>
        </div>
      </div>

      {/* Per-file Donut Charts */}
      {summary.computed > 0 && (() => {
        const r = 38, circ = 2 * Math.PI * r;
        const donuts = fileRows.filter(row => row.stats && !row.stats._pending);
        if (donuts.length === 0) return null;
        return (
          <div className="dash-donut-grid">
            {donuts.map((row, di) => {
              const s = row.stats;
              const total = s.unchanged + s.added + s.deleted + s.modified;
              if (total === 0) return null;
              const segs = [
                { value: s.unchanged, color: '#d1d5db' },
                { value: s.added, color: '#10b981' },
                { value: s.deleted, color: '#ef4444' },
                { value: s.modified, color: '#f59e0b' },
              ].filter(seg => seg.value > 0);
              let cum = 0;
              const arcs = segs.map(seg => {
                const len = (seg.value / total) * circ;
                const off = cum; cum += len;
                return { ...seg, len, off };
              });
              const sev = getSeverityInfo(s.changeRatio);
              return (
                <div key={row.id} className="dash-donut-cell" onClick={() => onSelectFile(row.id)} title={`點擊查看 ${row.name} 的差異比對`}>
                  <div className="dash-donut-wrap-sm">
                    <svg viewBox="0 0 100 100" className="dash-donut-svg">
                      {arcs.map((a, i) => (
                        <circle key={i} r={r} cx="50" cy="50" fill="none" stroke={a.color} strokeWidth="12"
                          strokeDasharray={a.len + ' ' + (circ - a.len)} strokeDashoffset={-a.off}
                          transform="rotate(-90 50 50)" className="dash-donut-seg" style={{ animationDelay: (di * 150 + i * 100) + 'ms' }} />
                      ))}
                    </svg>
                    <div className="dash-donut-center">
                      <div className="dash-donut-pct" style={{ color: sev.color }}>{(s.changeRatio * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="dash-donut-fname">{row.name}</div>
                  <div className="dash-donut-meta">
                    {s.added > 0 && <span style={{ color: '#10b981' }}>+{s.added}</span>}
                    {s.deleted > 0 && <span style={{ color: '#ef4444' }}>-{s.deleted}</span>}
                    {s.modified > 0 && <span style={{ color: '#f59e0b' }}>~{s.modified}</span>}
                    {s.changed === 0 && <span style={{ color: '#10b981' }}>無變更</span>}
                  </div>
                  <div className="dash-donut-lines">{row.actualLines} 行</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Shared legend */}
      <div className="dash-legend-bar">
        <span className="dash-legend-item"><span className="dash-legend-dot" style={{ background: '#d1d5db' }} />未變更</span>
        <span className="dash-legend-item"><span className="dash-legend-dot" style={{ background: '#10b981' }} />新增</span>
        <span className="dash-legend-item"><span className="dash-legend-dot" style={{ background: '#ef4444' }} />刪除</span>
        <span className="dash-legend-item"><span className="dash-legend-dot" style={{ background: '#f59e0b' }} />修改</span>
      </div>

      {/* File ranking */}
      <div className="dash-section-title">檔案變更排行</div>
      <div className="dash-ranking">
        {fileRows.map((row, idx) => {
          const stats = row.stats;
          const pending = !stats || stats._pending;
          const ratio = pending ? 0 : stats.changeRatio;
          const sev = getSeverityInfo(ratio);
          const barWidth = Math.max(ratio * 100, 0.5);

          return (
            <div key={row.id} className="dash-row" onClick={() => onSelectFile(row.id)} title={`點擊查看 ${row.name} 的差異比對`}>
              <div className="dash-row-rank">{idx + 1}</div>
              <div className="dash-row-name">{row.name}</div>
              <div className="dash-row-bar-wrap">
                {pending ? (
                  <div className="dash-row-pending">計算中...</div>
                ) : row.identical ? (
                  <div className="dash-row-identical">無變更</div>
                ) : (
                  <div className="dash-row-stacked" style={{ width: Math.min(barWidth, 100) + '%', animationDelay: (idx * 60) + 'ms' }}>
                    {stats.added > 0 && <div style={{ flex: stats.added, background: '#10b981' }} />}
                    {stats.deleted > 0 && <div style={{ flex: stats.deleted, background: '#ef4444' }} />}
                    {stats.modified > 0 && <div style={{ flex: stats.modified, background: '#f59e0b' }} />}
                  </div>
                )}
              </div>
              <div className="dash-row-pct" style={{ color: pending ? '#9ca3af' : sev.color }}>
                {pending ? '...' : (ratio * 100).toFixed(1) + '%'}
              </div>
              <div className="dash-row-counts">
                {!pending && stats.changed > 0 && (
                  <>
                    {stats.added > 0 && <span style={{ color: '#10b981' }}>+{stats.added}</span>}
                    {stats.deleted > 0 && <span style={{ color: '#ef4444' }}>-{stats.deleted}</span>}
                    {stats.modified > 0 && <span style={{ color: '#f59e0b' }}>~{stats.modified}</span>}
                  </>
                )}
              </div>
              <div className="dash-row-lines">{row.actualLines}行</div>
            </div>
          );
        })}
        {fileRows.length === 0 && <div className="dash-empty">尚無檔案</div>}
      </div>
    </div>
  );
}
