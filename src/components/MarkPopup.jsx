// Mark popup — extracted from MdReviewer.jsx (Phase 2 refactor). Behavior verbatim.
import React, { useState, useRef, useEffect } from 'react';
import { AlertCircle, X, Edit, Check, Trash2 } from 'lucide-react';

/* ===== MARK POPUP ===== */
export function MarkPopup({ mark, position, onSave, onDelete, onClose }) {
  const [issue, setIssue] = useState(mark?.issue || '');
  const [editing, setEditing] = useState(!mark);
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position:'fixed', left: Math.min(position.x, window.innerWidth-290), top: Math.min(position.y+10, window.innerHeight-220), width:270, background:'white', borderRadius:12, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', border:'1px solid #fecaca', padding:16, zIndex:50 }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-red-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{mark ? '問題標記' : '新增標記'}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      {editing ? (<>
        <textarea value={issue} onChange={e => setIssue(e.target.value)} placeholder="描述問題..."
          className="w-full h-20 border rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300" autoFocus />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
          <button onClick={() => { if (issue.trim()) onSave(issue.trim()); }} disabled={!issue.trim()}
            className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40 flex items-center gap-1"><Check className="w-3.5 h-3.5" />儲存</button>
        </div>
      </>) : (<>
        <div className="bg-red-50 rounded-lg p-2.5 text-sm text-gray-700 mb-3">{mark?.issue}</div>
        <div className="flex justify-end gap-2">
          <button onClick={() => setEditing(true)} className="px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1"><Edit className="w-3 h-3" />修改</button>
          <button onClick={onDelete} className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1"><Trash2 className="w-3 h-3" />刪除</button>
        </div>
      </>)}
    </div>
  );
}
