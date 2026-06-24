const fs = require('fs');
const path = require('path');

const dllPath = path.join(__dirname, '..', 'assets', 'dll', 'wexin_hook.dll');
const minSize = 32 * 1024;

if (!fs.existsSync(dllPath)) {
  console.error('打包前缺少 assets/dll/wexin_hook.dll');
  console.error('请先在本机执行: npm run build:hook');
  process.exit(1);
}

const size = fs.statSync(dllPath).size;
if (size < minSize) {
  console.error(`wexin_hook.dll 文件过小 (${size} 字节)，可能无效`);
  console.error('请重新执行: npm run build:hook');
  process.exit(1);
}

console.log(`wexin_hook.dll 就绪 (${Math.round(size / 1024)} KB)`);
