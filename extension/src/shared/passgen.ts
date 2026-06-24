/**
 * Client-side password & passphrase generators.
 *
 * All randomness comes from crypto.getRandomValues (CSPRNG) — never Math.random.
 * Pure functions, usable from any context (popup, app, in-form menu).
 */

export interface PasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  special: boolean;
  /** Drop visually ambiguous characters (O/0, l/1/I, …). */
  excludeLookAlike: boolean;
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  wordCase: 'lower' | 'upper' | 'capitalize';
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 18,
  upper: true,
  lower: true,
  digits: true,
  special: true,
  excludeLookAlike: false,
};

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 9,
  separator: '-',
  wordCase: 'lower',
};

const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  special: '!@#$%^&*()-_=+[]{};:,.?/',
};
const LOOK_ALIKE = /[O0oIl1|S5B8]/g;

/** Uniform, modulo-bias-free pick of `count` chars from `pool`. */
function randomChars(pool: string, count: number): string {
  if (pool.length === 0) return '';
  const out: string[] = [];
  // Reject values in the biased tail so every char is equally likely.
  const limit = Math.floor(0xffffffff / pool.length) * pool.length;
  const buf = new Uint32Array(1);
  while (out.length < count) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    out.push(pool[buf[0] % pool.length]);
  }
  return out.join('');
}

export function generatePassword(opts: PasswordOptions): string {
  let pool = '';
  if (opts.upper) pool += SETS.upper;
  if (opts.lower) pool += SETS.lower;
  if (opts.digits) pool += SETS.digits;
  if (opts.special) pool += SETS.special;
  if (opts.excludeLookAlike) pool = pool.replace(LOOK_ALIKE, '');
  if (!pool) pool = SETS.lower; // never produce an empty alphabet
  return randomChars(pool, Math.max(1, Math.min(128, opts.length)));
}

/** Shannon entropy (bits) of a random string drawn uniformly from `poolSize`. */
export function passwordEntropyBits(length: number, poolSize: number): number {
  if (poolSize <= 1 || length <= 0) return 0;
  return Math.round(length * Math.log2(poolSize));
}

export function passwordPoolSize(opts: PasswordOptions): number {
  let pool = '';
  if (opts.upper) pool += SETS.upper;
  if (opts.lower) pool += SETS.lower;
  if (opts.digits) pool += SETS.digits;
  if (opts.special) pool += SETS.special;
  if (opts.excludeLookAlike) pool = pool.replace(LOOK_ALIKE, '');
  return pool.length || SETS.lower.length;
}

// A compact word list for diceware-style passphrases (256 common words ->
// 8 bits of entropy per word; 9 words ≈ 72 bits). Kept short & memorable.
const WORDS = [
  'able', 'acid', 'aged', 'also', 'area', 'army', 'away', 'baby', 'back', 'ball',
  'band', 'bank', 'base', 'bath', 'bear', 'beat', 'been', 'beer', 'bell', 'belt',
  'bird', 'blue', 'boat', 'body', 'bone', 'book', 'boom', 'boot', 'born', 'boss',
  'both', 'bowl', 'bulk', 'burn', 'bush', 'busy', 'cake', 'call', 'calm', 'came',
  'camp', 'card', 'care', 'case', 'cash', 'cast', 'cell', 'chat', 'chip', 'city',
  'clay', 'club', 'clue', 'coal', 'coat', 'code', 'cold', 'come', 'cook', 'cool',
  'cope', 'copy', 'core', 'corn', 'cost', 'crew', 'crop', 'dark', 'data', 'date',
  'dawn', 'days', 'dead', 'deal', 'dear', 'debt', 'deep', 'deny', 'desk', 'dial',
  'diet', 'dirt', 'dish', 'dock', 'does', 'door', 'dose', 'down', 'draw', 'drop',
  'drug', 'drum', 'dual', 'duke', 'dust', 'duty', 'each', 'earn', 'ease', 'east',
  'easy', 'edge', 'else', 'even', 'ever', 'evil', 'exit', 'face', 'fact', 'fade',
  'fail', 'fair', 'fall', 'farm', 'fast', 'fate', 'fear', 'feed', 'feel', 'feet',
  'fell', 'file', 'fill', 'film', 'find', 'fine', 'fire', 'firm', 'fish', 'five',
  'flag', 'flat', 'flow', 'food', 'foot', 'ford', 'form', 'fort', 'four', 'free',
  'frog', 'fuel', 'full', 'fund', 'gain', 'game', 'gate', 'gave', 'gear', 'gift',
  'girl', 'give', 'glad', 'goal', 'goat', 'gold', 'golf', 'gone', 'good', 'gray',
  'grew', 'grid', 'grip', 'grow', 'gulf', 'hair', 'half', 'hall', 'hand', 'hang',
  'hard', 'harm', 'hate', 'have', 'head', 'heal', 'heap', 'hear', 'heat', 'held',
  'hell', 'help', 'herb', 'hero', 'hide', 'high', 'hill', 'hint', 'hire', 'hold',
  'hole', 'holy', 'home', 'hope', 'horn', 'host', 'hour', 'huge', 'hull', 'hunt',
  'idea', 'inch', 'iron', 'item', 'jade', 'join', 'joke', 'jump', 'jury', 'just',
  'keen', 'keep', 'kept', 'kick', 'kind', 'king', 'kiss', 'knee', 'knew', 'know',
  'lack', 'lady', 'lake', 'lamp', 'land', 'lane', 'last', 'late', 'lawn', 'lead',
  'leaf', 'lean', 'left', 'lend', 'lens', 'life', 'lift', 'like', 'line', 'link',
  'lion', 'list', 'live', 'load', 'loan', 'lock', 'long', 'look', 'loop', 'lord',
  'lose', 'loss', 'lost', 'loud', 'love', 'luck',
];

export function generatePassphrase(opts: PassphraseOptions): string {
  const count = Math.max(1, Math.min(40, opts.words));
  const limit = Math.floor(0xffffffff / WORDS.length) * WORDS.length;
  const buf = new Uint32Array(1);
  const picked: string[] = [];
  while (picked.length < count) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    let w = WORDS[buf[0] % WORDS.length];
    if (opts.wordCase === 'upper') w = w.toUpperCase();
    else if (opts.wordCase === 'capitalize') w = w[0].toUpperCase() + w.slice(1);
    picked.push(w);
  }
  return picked.join(opts.separator ?? '-');
}

export function passphraseEntropyBits(words: number): number {
  return Math.round(words * Math.log2(WORDS.length));
}
