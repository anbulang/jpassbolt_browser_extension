// One-off rasterizer: turns src/icons/icon.svg into PNGs at the MV3 icon sizes.
// Run with: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src', 'icons');
const svg = readFileSync(join(iconsDir, 'icon.svg'));
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const out = join(iconsDir, `icon-${size}.png`);
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log(`wrote ${out}`);
}
