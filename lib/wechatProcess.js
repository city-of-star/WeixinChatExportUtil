const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PRIMARY_EXE_NAMES = ['Weixin.exe', 'WeChat.exe'];

const WECHAT_INSTALL_CANDIDATES = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tencent', 'Weixin', 'Weixin.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tencent', 'WeChat', 'WeChat.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tencent', 'Weixin', 'Weixin.exe'),
  'D:\\other\\Tencent\\Weixin\\Weixin.exe',
  'D:\\Program Files\\Tencent\\Weixin\\Weixin.exe',
  'D:\\Tencent\\Weixin\\Weixin.exe',
];

let cachedWeixinExePath = null;

function runPowerShell(script) {
  try {
    return execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout: 12000,
    }).trim();
  } catch {
    return '';
  }
}

function getRunningWeixinExePath() {
  const fromPs = runPowerShell(
    '(Get-Process -Name Weixin -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 1 -ExpandProperty Path)'
  );
  if (fromPs && fs.existsSync(fromPs)) {
    return fromPs;
  }

  for (const imageName of PRIMARY_EXE_NAMES) {
    try {
      const output = execSync(
        `wmic process where "name='${imageName}'" get ExecutablePath /format:list`,
        { encoding: 'utf8', timeout: 8000 }
      );
      const match = output.match(/ExecutablePath=(.+)/i);
      if (match) {
        const exePath = match[1].trim();
        if (exePath && fs.existsSync(exePath)) {
          return exePath;
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function getWeixinPathFromRegistry() {
  const keys = [
    'HKCU:\\Software\\Tencent\\Weixin',
    'HKLM:\\Software\\Tencent\\Weixin',
    'HKCU:\\Software\\Tencent\\WeChat',
    'HKLM:\\Software\\WOW6432Node\\Tencent\\WeChat',
  ];

  for (const key of keys) {
    const installPath = runPowerShell(`(Get-ItemProperty '${key}' -ErrorAction SilentlyContinue).InstallPath`);
    if (!installPath) continue;

    for (const name of PRIMARY_EXE_NAMES) {
      const exePath = path.join(installPath.replace(/[/\\]+$/, ''), name);
      if (fs.existsSync(exePath)) {
        return exePath;
      }
    }
  }

  return null;
}

function resolveWeixinExecutable(log) {
  if (cachedWeixinExePath && fs.existsSync(cachedWeixinExePath)) {
    return cachedWeixinExePath;
  }

  const running = getRunningWeixinExePath();
  if (running) {
    cachedWeixinExePath = running;
    return running;
  }

  const fromRegistry = getWeixinPathFromRegistry();
  if (fromRegistry) {
    cachedWeixinExePath = fromRegistry;
    return fromRegistry;
  }

  for (const candidate of WECHAT_INSTALL_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) {
      cachedWeixinExePath = candidate;
      return candidate;
    }
  }

  log?.('未能自动定位 Weixin.exe，请确认微信已安装');
  return null;
}

function rememberWeixinExecutable() {
  const exePath = getRunningWeixinExePath() || getWeixinPathFromRegistry();
  if (exePath) {
    cachedWeixinExePath = exePath;
    return exePath;
  }
  return resolveWeixinExecutable(() => {});
}

function readExeProductVersion(exePath) {
  if (!exePath || !fs.existsSync(exePath)) return null;
  try {
    const escaped = exePath.replace(/'/g, "''");
    const version = execSync(
      `powershell -NoProfile -Command "(Get-Item '${escaped}').VersionInfo.ProductVersion"`,
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    return version || null;
  } catch {
    return null;
  }
}

function getWeChatVersion() {
  if (process.platform !== 'win32') return null;
  try {
    const script =
      '(Get-Process Weixin -ErrorAction SilentlyContinue | Select-Object -First 1).MainModule.FileVersionInfo.ProductVersion';
    const version = execSync(`powershell -NoProfile -Command "${script}"`, {
      encoding: 'utf8',
      timeout: 8000,
    }).trim();
    if (version) return version;
  } catch {
    // fall through to installed exe
  }

  const exePath =
    getRunningWeixinExePath() ||
    getWeixinPathFromRegistry() ||
    resolveWeixinExecutable(() => {});
  return readExeProductVersion(exePath);
}

function isNewWeChatMemoryModel(version) {
  if (!version) return false;
  const parts = version.split('.').map(Number);
  if (parts[0] > 4) return true;
  if (parts[0] === 4 && parts[1] > 1) return true;
  if (parts[0] === 4 && parts[1] === 1 && parts[2] >= 10) return true;
  return false;
}

function killProcessByName(imageName, log) {
  try {
    execSync(`taskkill /F /IM ${imageName} /T`, {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    log?.(`已结束进程 ${imageName}`);
    return true;
  } catch {
    return false;
  }
}

async function terminateWeChatProcesses(log) {
  if (process.platform !== 'win32') return;

  for (const imageName of PRIMARY_EXE_NAMES) {
    killProcessByName(imageName, log);
  }
  await sleep(1500);
  killProcessByName('WeChatAppEx.exe', log);
}

function findWeChatExecutable() {
  return resolveWeixinExecutable(() => {});
}

function launchWeChat(log, exePath, options = {}) {
  const target = exePath || resolveWeixinExecutable(log);
  if (!target) {
    log?.('未找到微信安装路径，请手动双击 Weixin.exe 启动并登录');
    return false;
  }

  cachedWeixinExePath = target;

  try {
    const escaped = target.replace(/'/g, "''");
    execSync(
      `powershell -NoProfile -Command "Start-Process -FilePath '${escaped}' -WindowStyle Normal"`,
      { timeout: 15000, stdio: 'ignore' }
    );
    log?.(`已启动微信: ${target}`);
    if (!options.deferLoginHint) {
      log?.('请在弹出的微信窗口中完成扫码/登录');
    }
    return true;
  } catch (err) {
    try {
      execSync(`"${target}"`, { timeout: 10000, stdio: 'ignore' });
      log?.(`已启动微信: ${target}`);
      if (!options.deferLoginHint) {
        log?.('请在弹出的微信窗口中完成扫码/登录');
      }
      return true;
    } catch (err2) {
      log?.(`启动微信失败: ${err2.message}`);
      return false;
    }
  }
}

async function focusWeChatWindow(log, options = {}) {
  if (process.platform !== 'win32') return false;

  const { retries = 15, intervalMs = 600 } = options;
  const focusScript = [
    "Add-Type 'using System;using System.Runtime.InteropServices;public class WetraceWin{",
    '[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);',
    '[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);',
    '[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);',
    '[DllImport("user32.dll")]public static extern bool BringWindowToTop(IntPtr h);',
    "}'",
    '$p=Get-Process -Name Weixin -ErrorAction SilentlyContinue|Sort-Object WorkingSet64 -Descending|Select-Object -First 1;',
    'if($null -eq $p){exit 1};',
    '$h=$p.MainWindowHandle;',
    'if($h -eq [IntPtr]::Zero){exit 2};',
    'if([WetraceWin]::IsIconic($h)){[WetraceWin]::ShowWindow($h,9)|Out-Null};',
    '[WetraceWin]::ShowWindow($h,5)|Out-Null;',
    '[WetraceWin]::BringWindowToTop($h)|Out-Null;',
    '[WetraceWin]::SetForegroundWindow($h)|Out-Null;',
    'exit 0',
  ].join(' ');

  for (let i = 0; i < retries; i += 1) {
    try {
      execSync(`powershell -NoProfile -Command "${focusScript.replace(/"/g, '\\"')}"`, {
        timeout: 8000,
        stdio: 'ignore',
      });
      log?.('已将微信窗口置于最前，请点击「登录」');
      return true;
    } catch {
      await sleep(intervalMs);
    }
  }

  log?.('未能自动置顶微信窗口，请手动切换到微信');
  return false;
}

async function launchWeChatAndFocus(log, exePath) {
  const launched = launchWeChat(log, exePath);
  if (!launched) return false;
  await sleep(1200);
  await focusWeChatWindow(log);
  return true;
}

function isWeixinRunning() {
  try {
    const output = execSync('tasklist /FI "IMAGENAME eq Weixin.exe" /FO CSV /NH', {
      encoding: 'utf8',
      timeout: 5000,
    });
    return /Weixin\.exe/i.test(output);
  } catch {
    return false;
  }
}

function waitForWeChatProcess(timeoutMs = 90000, pollMs = 500) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (isWeixinRunning()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  getWeChatVersion,
  isNewWeChatMemoryModel,
  terminateWeChatProcesses,
  findWeChatExecutable,
  resolveWeixinExecutable,
  rememberWeixinExecutable,
  launchWeChat,
  launchWeChatAndFocus,
  focusWeChatWindow,
  waitForWeChatProcess,
  isWeixinRunning,
  sleep,
};
