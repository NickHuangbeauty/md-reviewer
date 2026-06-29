// Embed API — postMessage listener for iframe integration
// Handles cross-origin communication when MD Reviewer is embedded in an iframe.
// Protocol: Host (Streamlit) sends setFiles/getState, Reviewer responds with ack/stateResponse.

const SOURCE_ID = 'md-reviewer';
const HOST_SOURCE = 'streamlit-host';
const PROTOCOL_VERSION = '1.0';
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB

// ===== Error Codes =====
const ERR = {
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  // BLOCKED_ORIGIN — console.warn only, no response (avoid info leak)
};

// ===== Origin Whitelist (cached at module level — env var is a build-time constant) =====

const ALLOWED_ORIGINS = (() => {
  const raw = import.meta.env.VITE_ALLOWED_ORIGINS || '';
  if (!raw) return null; // unset
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
})();
const IS_DEV = !!import.meta.env.DEV;

// Fail closed in production: with no configured allowlist, reject cross-origin
// messages (a build that wants the embed API MUST set VITE_ALLOWED_ORIGINS).
// In the dev server we accept all for local POC convenience.
function isOriginAllowed(origin) {
  if (ALLOWED_ORIGINS) return ALLOWED_ORIGINS.has(origin);
  return IS_DEV;
}

// ===== Schema Validation =====

function validateSetFilesPayload(payload) {
  if (!payload || !Array.isArray(payload.files)) {
    return 'payload.files must be an array';
  }
  for (let i = 0; i < payload.files.length; i++) {
    const f = payload.files[i];
    if (!f || typeof f.name !== 'string' || !f.name) {
      return `files[${i}].name must be a non-empty string`;
    }
    if (typeof f.content !== 'string') {
      return `files[${i}].content must be a string`;
    }
  }
  return null; // valid
}

// ===== Core =====

/**
 * Initialize the embed API listener.
 * @param {Object} opts
 * @param {string} opts.instanceId - Unique instance identifier (for future multi-iframe routing)
 * @param {Function} opts.onSetFiles - Callback: (files: Array<{name, content, originalContent?}>) => void
 * @param {Function} opts.onGetState - Callback: () => { files: Array }
 * @returns {Function} cleanup - call to remove listener
 */
export function initEmbedApi({ instanceId, onSetFiles, onGetState }) {
  // Post to the parent frame, always targeting a SPECIFIC origin (never '*').
  // Responses go back to the exact origin that messaged us; proactive messages
  // (ready) go only to configured allowed origins.
  function postToHost(type, requestId, payload, targetOrigin) {
    if (!window.parent || window.parent === window) return;
    if (!targetOrigin || targetOrigin === '*') {
      if (!IS_DEV) return; // never broadcast document content to '*' in production
      targetOrigin = '*';
    }
    window.parent.postMessage({
      source: SOURCE_ID,
      type,
      requestId: requestId || null,
      instanceId: instanceId || null,
      payload,
    }, targetOrigin);
  }

  function handleMessage(event) {
    // Origin guard — fail closed in production when no allowlist is configured.
    if (!isOriginAllowed(event.origin)) {
      console.warn('[EmbedAPI] Blocked origin:', event.origin);
      return;
    }
    // Reply only to the (allowed) origin that sent this message.
    const reply = (type, requestId, payload) => postToHost(type, requestId, payload, event.origin);

    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.source !== HOST_SOURCE) return;

    switch (msg.type) {
      case 'setFiles': {
        // Payload size guard — only for setFiles (the only inbound large payload)
        try {
          const size = JSON.stringify(msg.payload).length * 2; // conservative UTF-16 estimate
          if (size > MAX_PAYLOAD_BYTES) {
            reply('error', msg.requestId, {
              code: ERR.PAYLOAD_TOO_LARGE,
              message: `Payload ~${(size / 1024 / 1024).toFixed(1)}MB exceeds 5MB limit`,
            });
            return;
          }
        } catch { return; }
        const err = validateSetFilesPayload(msg.payload);
        if (err) {
          reply('error', msg.requestId, { code: ERR.INVALID_SCHEMA, message: err });
          return;
        }
        onSetFiles(msg.payload.files);
        reply('ack', msg.requestId, { type: 'setFiles', count: msg.payload.files.length });
        break;
      }
      case 'getState': {
        const state = onGetState();
        reply('stateResponse', msg.requestId, state);
        break;
      }
      default:
        reply('error', msg.requestId, {
          code: ERR.UNKNOWN_TYPE,
          message: `Unknown message type: ${msg.type}`,
        });
    }
  }

  window.addEventListener('message', handleMessage);

  // Send ready signal (after microtask to let React render). This is proactive
  // (no triggering message), so target each configured allowed origin explicitly;
  // in dev with no allowlist, fall back to '*'. In production with no allowlist we
  // stay silent — the host can poll via getState, which we answer to its origin.
  Promise.resolve().then(() => {
    const readyPayload = { protocolVersion: PROTOCOL_VERSION, capabilities: ['setFiles', 'getState'] };
    if (ALLOWED_ORIGINS) {
      for (const origin of ALLOWED_ORIGINS) postToHost('ready', null, readyPayload, origin);
    } else if (IS_DEV) {
      postToHost('ready', null, readyPayload, '*');
    }
  });

  // Return cleanup function
  return () => {
    window.removeEventListener('message', handleMessage);
  };
}
