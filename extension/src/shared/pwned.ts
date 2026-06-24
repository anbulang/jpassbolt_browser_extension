/**
 * Have-I-Been-Pwned breach check using the k-anonymity range API.
 *
 * Only the first 5 chars of the password's SHA-1 hash leave the device; the
 * server returns all hash suffixes sharing that prefix and we match locally,
 * so the password itself is never transmitted. Called from the service worker
 * (it has the host permission needed to reach api.pwnedpasswords.com).
 */

async function sha1Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Returns how many known breaches contain `password` (0 = not found).
 * Throws if the breach service is unreachable so the UI can degrade gracefully.
 */
export async function pwnedCount(password: string): Promise<number> {
  if (!password) return 0;
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  let res: Response;
  try {
    // Add-Padding hides the real result-set size from network observers.
    res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    });
  } catch {
    throw new Error('Breach-check service is unavailable.');
  }
  if (!res.ok) throw new Error(`Breach-check service error (${res.status}).`);

  const body = await res.text();
  for (const line of body.split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    if (line.slice(0, sep).trim().toUpperCase() === suffix) {
      return parseInt(line.slice(sep + 1).trim(), 10) || 0;
    }
  }
  return 0;
}
