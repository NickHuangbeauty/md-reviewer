// Floating table of contents — extracted from MdReviewer.jsx (Phase 2 refactor).
// Behavior verbatim.
import React, { useState, useRef, useEffect } from 'react';
import { ListTree, ChevronRight } from 'lucide-react';

/* ===== FLOATING TOC ===== */
export function extractTocEntries(blocks) {
  const entries = [];
  blocks.forEach((block, i) => {
    const m = block.match(/^(#{1,5})\s+(.+)$/m);
    if (m) {
      const level = m[1].length;
      // Strip inline markdown from title
      let title = m[2]
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      entries.push({ level, title, blockId: 'block-' + i, blockIdx: i });
    }
  });
  return entries;
}

export function FloatingToc({ entries, onNavigate, width }) {
  const [activeId, setActiveId] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const tocRef = useRef(null);

  // Scroll spy — track which heading is in viewport
  useEffect(() => {
    if (!entries.length) return;
    const observer = new IntersectionObserver(
      (ents) => {
        // Find the topmost visible heading
        const visible = ents
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );
    entries.forEach(e => {
      const el = document.getElementById(e.blockId);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [entries]);

  // Auto-scroll ToC to keep active item visible
  useEffect(() => {
    if (!activeId || !tocRef.current) return;
    const el = tocRef.current.querySelector('[data-toc-id="' + activeId + '"]');
    if (el) {
      const rect = el.getBoundingClientRect();
      const containerRect = tocRef.current.getBoundingClientRect();
      if (rect.top < containerRect.top + 20 || rect.bottom > containerRect.bottom - 20) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [activeId]);

  const handleClick = (entry) => {
    const el = document.getElementById(entry.blockId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('block-flash');
      setTimeout(() => el.classList.remove('block-flash'), 1800);
      setActiveId(entry.blockId);
    }
    if (onNavigate) onNavigate(entry);
  };

  // Determine which entries are children of a collapsed parent
  const isHidden = (idx) => {
    for (let i = idx - 1; i >= 0; i--) {
      if (entries[i].level < entries[idx].level) {
        if (collapsed.has(entries[i].blockId)) return true;
        // Continue checking ancestors
      }
    }
    return false;
  };

  const hasChildren = (idx) => {
    if (idx >= entries.length - 1) return false;
    return entries[idx + 1].level > entries[idx].level;
  };

  const toggleCollapse = (blockId) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId); else next.add(blockId);
      return next;
    });
  };

  if (!entries.length) return null;

  // Find min level for proper indentation
  const minLevel = Math.min(...entries.map(e => e.level));

  return (
    <div className="ftoc" ref={tocRef} style={width ? { width } : undefined}>
      <div className="ftoc-header">
        <ListTree style={{ width: 13, height: 13 }} />
        <span>目錄</span>
        <span className="ftoc-count">{entries.length}</span>
      </div>
      <div className="ftoc-list">
        {entries.map((entry, idx) => {
          if (isHidden(idx)) return null;
          const indent = entry.level - minLevel;
          const isActive = activeId === entry.blockId;
          const expandable = hasChildren(idx);
          const isCollapsed = collapsed.has(entry.blockId);
          return (
            <div key={entry.blockId} data-toc-id={entry.blockId}
              className={'ftoc-item' + (isActive ? ' ftoc-active' : '')}
              style={{ paddingLeft: 8 + indent * 14 }}>
              {expandable ? (
                <button className="ftoc-toggle" onClick={(e) => { e.stopPropagation(); toggleCollapse(entry.blockId); }}>
                  <ChevronRight style={{ width: 11, height: 11, transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform .15s' }} />
                </button>
              ) : (
                <span className="ftoc-dot-wrap"><span className={'ftoc-dot' + (isActive ? ' ftoc-dot-active' : '')} /></span>
              )}
              <button className="ftoc-link" onClick={() => handleClick(entry)}
                title={entry.title}>
                <span className={'ftoc-level ftoc-l' + entry.level}>H{entry.level}</span>
                <span className="ftoc-text">{entry.title}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
