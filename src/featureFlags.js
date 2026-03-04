// Feature Flag System for MD Reviewer
// - Production (default): all flags OFF — safe, no new features exposed
// - Canary (VITE_CANARY=true): all flags ON — full testing
// - Remote (Gist JSON): per-flag control for gradual rollout
//
// Usage:
//   import { useFeatureFlag, getAllFlags, fetchRemoteFlags } from './featureFlags.js';
//   const darkMode = useFeatureFlag('dark-mode');      // React component
//   const flags = getAllFlags();                        // for Worker postMessage
//   fetchRemoteFlags();                                // call once on app mount

import { useState, useEffect } from 'react';

// ===== Flag Definitions =====
// Default: all OFF for production safety
const FLAG_DEFAULTS = {
  'new-diff-engine': false,  // 新版 diff 引擎（區塊分割 + 相似度配對）
  'dark-mode': false,        // 主題切換 (Sun/Moon 按鈕)
  'dashboard': false,        // 差異儀表板
};

// ===== Canary Detection (compile-time) =====
const IS_CANARY = !!import.meta.env.VITE_CANARY;

// ===== Remote Flag Source =====
// Set this to your GitHub Gist raw URL to enable remote flag control.
// Example: 'https://gist.githubusercontent.com/<user>/<gist-id>/raw/md-reviewer-flags.json'
// JSON format: { "new-diff-engine": true, "dark-mode": true, "dashboard": false }
const REMOTE_FLAGS_URL = null;

// ===== Internal State =====
let _remoteFlags = null;
let _fetchPromise = null;
const _listeners = new Set();

function notifyListeners() {
  _listeners.forEach(fn => fn());
}

/**
 * Fetch remote flags from GitHub Gist (once per session).
 * Silently falls back to defaults on failure.
 */
export async function fetchRemoteFlags() {
  if (!REMOTE_FLAGS_URL || IS_CANARY) return;
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = fetch(REMOTE_FLAGS_URL)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && typeof data === 'object') {
        _remoteFlags = data;
        notifyListeners();
      }
    })
    .catch(() => { /* silently fallback to defaults */ });

  return _fetchPromise;
}

/**
 * Get a single flag value (synchronous).
 * Priority: Canary (all true) > Remote Gist > Defaults
 */
export function getFlag(name) {
  if (IS_CANARY) return true;
  if (_remoteFlags && name in _remoteFlags) return !!_remoteFlags[name];
  return FLAG_DEFAULTS[name] ?? false;
}

/**
 * Get all flags as a plain object.
 * Use this for Worker postMessage: worker.postMessage({ ...data, flags: getAllFlags() })
 */
export function getAllFlags() {
  const flags = {};
  for (const key of Object.keys(FLAG_DEFAULTS)) {
    flags[key] = getFlag(key);
  }
  return flags;
}

/**
 * React hook: re-renders component when remote flags load.
 * @param {string} name - Flag name from FLAG_DEFAULTS
 * @returns {boolean}
 */
export function useFeatureFlag(name) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate(n => n + 1);
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  }, []);

  return getFlag(name);
}

/** Whether this is a canary build */
export const isCanary = IS_CANARY;
