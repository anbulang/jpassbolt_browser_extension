/**
 * Offscreen document — the only DOM context the MV3 service worker can use to
 * touch the clipboard. It writes a value to the clipboard on request and, for
 * "temporary" copies, burns it after a delay so a copied password does not
 * linger on the clipboard indefinitely.
 *
 * Safety rules (mirrors the official extension's behaviour):
 *  - The write reports execCommand('copy')'s boolean back to the background so
 *    a failed copy surfaces as an error toast instead of a false success.
 *  - The burn timer first reads the clipboard back (clipboardRead permission)
 *    and only clears it when it still holds the value we wrote — if the user
 *    copied something else in the meantime we must not destroy their content.
 *  - execCommand('copy') on an empty textarea is a no-op in some browsers, so
 *    "clearing" writes a single space sentinel instead of ''.
 */
interface OffscreenMsg {
  target: 'offscreen';
  type: 'clipboard-write';
  text: string;
  clearAfterMs: number;
}

let clearTimer: ReturnType<typeof setTimeout> | undefined;
/** Last value this document successfully wrote (compared before burning). */
let lastWritten: string | null = null;

function writeClipboard(text: string): boolean {
  const ta = document.createElement('textarea');
  // Copying an empty selection can silently no-op; burn with a space sentinel.
  ta.value = text === '' ? ' ' : text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  if (ok) lastWritten = ta.value;
  return ok;
}

/**
 * Read the clipboard back, or null when unreadable. execCommand('paste') is
 * the documented offscreen-document read path (navigator.clipboard.readText
 * throws "Document is not focused" in an unfocused offscreen page); readText
 * is kept as a fallback in case paste is unavailable.
 */
async function readClipboard(): Promise<string | null> {
  const ta = document.createElement('textarea');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  let pasted = false;
  try {
    pasted = document.execCommand('paste');
  } catch {
    pasted = false;
  }
  const value = ta.value;
  ta.remove();
  if (pasted) return value;
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/** Burn the clipboard iff it still holds what we wrote (best-effort clear). */
async function burnClipboard(): Promise<void> {
  const expected = lastWritten;
  const current = await readClipboard();
  // Unreadable clipboard degrades to an unconditional clear (the original,
  // security-first behaviour); a readable mismatch means the user copied
  // something of their own — leave it alone.
  if (current !== null && current !== expected) return;
  if (!writeClipboard('')) {
    // One retry; if it still fails the password stays on the clipboard, which
    // we can only log — the offscreen doc has no UI of its own.
    if (!writeClipboard('')) console.warn('[jpassbolt] clipboard burn failed');
  }
}

chrome.runtime.onMessage.addListener((msg: OffscreenMsg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return; // not addressed to the offscreen doc
  if (msg.type === 'clipboard-write') {
    const ok = writeClipboard(msg.text);
    if (ok) {
      // Only reschedule on success: a failed write leaves the previous
      // clipboard content (possibly an earlier password) in place, so any
      // pending burn timer must keep running.
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = undefined;
      if (msg.clearAfterMs > 0) {
        clearTimer = setTimeout(() => {
          clearTimer = undefined;
          void burnClipboard();
        }, msg.clearAfterMs);
      }
    }
    sendResponse({ ok });
  }
});
