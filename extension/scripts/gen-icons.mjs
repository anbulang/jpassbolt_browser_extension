// Rasterizer: turns the selected production brand master into MV3 icon sizes.
// Run with: node scripts/gen-icons.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src', 'icons');
const master = join(iconsDir, 'icon-master.png');
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const out = join(iconsDir, `icon-${size}.png`);
  await sharp(master)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote ${out}`);
}
