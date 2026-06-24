/**
 * Offscreen document — the only DOM context the MV3 service worker can use to
 * touch the clipboard. It writes a value to the clipboard on request and, for
 * "temporary" copies, overwrites it with an empty string after a delay so a
 * copied password does not linger on the clipboard indefinitely.
 */
interface OffscreenMsg {
  target: 'offscreen';
  type: 'clipboard-write';
  text: string;
  clearAfterMs: number;
}

let clearTimer: ReturnType<typeof setTimeout> | undefined;

function writeClipboard(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

chrome.runtime.onMessage.addListener((msg: OffscreenMsg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return; // not addressed to the offscreen doc
  if (msg.type === 'clipboard-write') {
    writeClipboard(msg.text);
    if (clearTimer) clearTimeout(clearTimer);
    if (msg.clearAfterMs > 0) {
      // Best-effort flush: overwrite the clipboard after the delay.
      clearTimer = setTimeout(() => writeClipboard(''), msg.clearAfterMs);
    }
    sendResponse({ ok: true });
  }
});
