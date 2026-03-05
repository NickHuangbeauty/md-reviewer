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
  if (!raw) return null; // null = accept all origins (POC/dev mode)
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
})();

function isOriginAllowed(origin) {
  if (!ALLOWED_ORIGINS) return true; // dev mode: accept all
  return ALLOWED_ORIGINS.has(origin);
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
  function sendToHost(type, requestId, payload) {
    if (!window.parent || window.parent === window) return;
    // TODO: v1 must replace '*' with specific allowed origin. Do NOT ship '*' to production.
    window.parent.postMessage({
      source: SOURCE_ID,
      type,
      requestId: requestId || null,
      instanceId: instanceId || null,
      payload,
    }, '*');
  }

  function handleMessage(event) {
    // Origin guard
    if (!isOriginAllowed(event.origin)) {
      console.warn('[EmbedAPI] Blocked origin:', event.origin);
      return;
    }

    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.source !== HOST_SOURCE) return;

    switch (msg.type) {
      case 'setFiles': {
        // Payload size guard — only for setFiles (the only inbound large payload)
        try {
          const size = JSON.stringify(msg.payload).length * 2; // conservative UTF-16 estimate
          if (size > MAX_PAYLOAD_BYTES) {
            sendToHost('error', msg.requestId, {
              code: ERR.PAYLOAD_TOO_LARGE,
              message: `Payload ~${(size / 1024 / 1024).toFixed(1)}MB exceeds 5MB limit`,
            });
            return;
          }
        } catch { return; }
        const err = validateSetFilesPayload(msg.payload);
        if (err) {
          sendToHost('error', msg.requestId, { code: ERR.INVALID_SCHEMA, message: err });
          return;
        }
        onSetFiles(msg.payload.files);
        sendToHost('ack', msg.requestId, { type: 'setFiles', count: msg.payload.files.length });
        break;
      }
      case 'getState': {
        const state = onGetState();
        sendToHost('stateResponse', msg.requestId, state);
        break;
      }
      default:
        sendToHost('error', msg.requestId, {
          code: ERR.UNKNOWN_TYPE,
          message: `Unknown message type: ${msg.type}`,
        });
    }
  }

  window.addEventListener('message', handleMessage);

  // Send ready signal (after microtask to let React render)
  Promise.resolve().then(() => {
    sendToHost('ready', null, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: ['setFiles', 'getState'],
    });
  });

  // Return cleanup function
  return () => {
    window.removeEventListener('message', handleMessage);
  };
}
