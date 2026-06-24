import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '..', 'build');
const svgPath = path.join(buildDir, 'logo.svg');

if (!fs.existsSync(svgPath)) {
  console.error('未找到 build/logo.svg');
  process.exit(1);
}

const sizes = [16, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  sizes.map((size) => sharp(svgPath).resize(size, size).png().toBuffer())
);

fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBuffers[sizes.indexOf(256)]);
const ico = await pngToIco(pngBuffers);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);

console.log('已生成 build/icon.png 和 build/icon.ico');
