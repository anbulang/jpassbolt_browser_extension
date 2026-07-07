/**
 * Minimal QR-code encoder (byte mode, ECC level M) — no external dependency.
 * Ported verbatim from the SPA pages/Settings.tsx tail section; used by the
 * SecurityTab to render the TOTP otpauth:// provisioning URI on a <canvas>.
 *
 * Returns a boolean matrix (true = dark module). Supports QR versions 1..10,
 * which comfortably hold a typical otpauth:// payload (~120 chars at level M).
 * Mask pattern 0 ((row + col) % 2 === 0) is applied unconditionally.
 */

// Capacity (bytes) for byte mode at ECC level M, versions 1..10.
const BYTE_CAPACITY_M = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

// Error-correction structure per version (level M): EC codewords per block + block groups.
const EC_TABLE_M: Record<number, { ecPerBlock: number; groups: [number, number][] }> = {
  1: { ecPerBlock: 10, groups: [[1, 16]] },
  2: { ecPerBlock: 16, groups: [[1, 28]] },
  3: { ecPerBlock: 26, groups: [[1, 44]] },
  4: { ecPerBlock: 18, groups: [[2, 32]] },
  5: { ecPerBlock: 24, groups: [[2, 43]] },
  6: { ecPerBlock: 16, groups: [[4, 27]] },
  7: { ecPerBlock: 18, groups: [[4, 31]] },
  8: {
    ecPerBlock: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
  },
  9: {
    ecPerBlock: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
  },
  10: {
    ecPerBlock: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
  },
};

const ALIGNMENT_CENTERS: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/**
 * Encode `text` into a QR matrix. Throws when the payload exceeds the byte
 * capacity of version 10 at level M — callers render a manual-entry fallback.
 */
export function buildQrMatrix(text: string): boolean[][] {
  const data = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (data.length <= BYTE_CAPACITY_M[v]) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new Error('Payload too large for supported QR versions.');

  const size = 17 + version * 4;
  const ec = EC_TABLE_M[version];

  // --- Build the data bit-stream (mode + count + bytes + terminator + pad). ---
  const totalDataCodewords = ec.groups.reduce((sum, [n, c]) => sum + n * c, 0);
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // byte mode
  pushBits(data.length, version <= 9 ? 8 : 16); // char-count indicator
  for (const b of data) pushBits(b, 8);
  const capacityBits = totalDataCodewords * 8;
  const term = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (bits.length < capacityBits) {
    pushBits(padBytes[pi % 2], 8);
    pi++;
  }
  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }

  // --- Split into blocks, compute EC, then interleave. ---
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const [numBlocks, dataPerBlock] of ec.groups) {
    for (let b = 0; b < numBlocks; b++) {
      const block = dataCodewords.slice(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      dataBlocks.push(block);
      ecBlocks.push(reedSolomon(block, ec.ecPerBlock));
    }
  }
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  const finalCodewords: number[] = [];
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) finalCodewords.push(block[i]);
  }
  for (let i = 0; i < ec.ecPerBlock; i++) {
    for (const block of ecBlocks) finalCodewords.push(block[i]);
  }

  // --- Lay out the matrix. ---
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array<boolean | null>(size).fill(null),
  );
  placeFunctionPatterns(modules, version, size);
  reserveFormatAreas(modules, size);

  // Place data with the zig-zag walk + mask 0.
  const finalBits: number[] = [];
  for (const cw of finalCodewords) for (let i = 7; i >= 0; i--) finalBits.push((cw >> i) & 1);

  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (modules[row][cc] !== null) continue;
        let dark = bitIdx < finalBits.length ? finalBits[bitIdx] === 1 : false;
        bitIdx++;
        if ((row + cc) % 2 === 0) dark = !dark; // mask pattern 0
        modules[row][cc] = dark;
      }
    }
    upward = !upward;
  }

  applyFormatInfo(modules, size);

  return modules.map((r) => r.map((m) => m === true));
}

function placeFinderPattern(m: (boolean | null)[][], top: number, left: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = top + r;
      const cc = left + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const isDark =
        inRing &&
        (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      m[rr][cc] = inRing ? isDark : false; // separators are light
    }
  }
}

function placeFunctionPatterns(m: (boolean | null)[][], version: number, size: number) {
  placeFinderPattern(m, 0, 0);
  placeFinderPattern(m, 0, size - 7);
  placeFinderPattern(m, size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = v;
    if (m[i][6] === null) m[i][6] = v;
  }

  // Dark module.
  m[size - 8][8] = true;

  // Alignment patterns.
  if (version >= 2) {
    const centers = ALIGNMENT_CENTERS[version] ?? [];
    for (const cr of centers) {
      for (const cc of centers) {
        if (
          (cr <= 8 && cc <= 8) ||
          (cr <= 8 && cc >= size - 9) ||
          (cr >= size - 9 && cc <= 8)
        ) {
          continue; // overlaps a finder pattern
        }
        placeAlignmentPattern(m, cr, cc);
      }
    }
  }
}

function placeAlignmentPattern(m: (boolean | null)[][], cr: number, cc: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = cr + r;
      const ccc = cc + c;
      if (rr < 0 || ccc < 0 || rr >= m.length || ccc >= m.length) continue;
      const ring = Math.max(Math.abs(r), Math.abs(c));
      m[rr][ccc] = ring !== 1; // dark border + centre, light ring at distance 1
    }
  }
}

function reserveFormatAreas(m: (boolean | null)[][], size: number) {
  // Reserve the 15 format-info modules so the data walk skips them.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      if (m[8][i] === null) m[8][i] = false;
      if (m[i][8] === null) m[i][8] = false;
    }
  }
  for (let i = size - 8; i < size; i++) {
    if (m[8][i] === null) m[8][i] = false;
    if (m[i][8] === null) m[i][8] = false;
  }
}

function applyFormatInfo(m: (boolean | null)[][], size: number) {
  // 15-bit format string for ECC level M, mask pattern 0.
  const FORMAT_M_MASK0 = 0b101010000010010;
  const bits: number[] = [];
  for (let i = 14; i >= 0; i--) bits.push((FORMAT_M_MASK0 >> i) & 1);

  // Copy 1 — around the top-left finder.
  let idx = 0;
  for (let r = 0; r <= 8; r++) {
    if (r === 6) continue;
    m[r][8] = bits[idx++] === 1;
  }
  for (let c = 7; c >= 0; c--) {
    if (c === 6) continue;
    m[8][c] = bits[idx++] === 1;
  }

  // Copy 2 — bottom-left (vertical) + top-right (horizontal).
  idx = 0;
  for (let r = size - 1; r >= size - 7; r--) {
    m[r][8] = bits[idx++] === 1;
  }
  for (let c = size - 8; c <= size - 1; c++) {
    m[8][c] = bits[idx++] === 1;
  }
}

// --- Reed-Solomon over GF(256) for QR error-correction codewords. ---
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGalois() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data: number[], ecLen: number): number[] {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < gen.length; i++) {
      res[i] ^= gfMul(gen[i], factor);
    }
  }
  return res.slice(0, ecLen);
}
