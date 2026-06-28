const fs = require('fs');
const path = require('path');
const { getWeChatProcesses, scanProcessForNeedles } = require('./winMemory');
const { buildPathNeedles } = require('./scanUtils');

function hasDecryptedStorage(wxDir) {
  const direct = path.join(wxDir, 'db_storage_decrypted', 'message');
  if (fs.existsSync(direct)) return true;
  const nested = path.join(wxDir, 'db_storage', 'db_storage_decrypted', 'message');
  return fs.existsSync(nested);
}

function getReadinessLevel({ running, dbPathInMemory, hasDecrypted }) {
  if (dbPathInMemory) return 'ready';
  if (!running) {
    return hasDecrypted ? 'offline' : 'not_ready';
  }
  if (hasDecrypted) return 'fallback';
  return 'maybe';
}

function getReadinessHints(level) {
  switch (level) {
    case 'ready':
      return '微信已登录，可以开始扫描';
    case 'fallback':
      return '微信正在运行，但未检测到当前账号登录；可使用已解密数据扫描';
    case 'offline':
      return '微信未运行；可使用已解密数据扫描';
    case 'maybe':
      return '建议先在微信中登录并打开几个聊天窗口，再回来扫描';
    default:
      return '请先启动并登录微信';
  }
}

function checkWeChatReadiness(wxDir) {
  const needles = buildPathNeedles(wxDir);
  let processes = [];

  try {
    processes = getWeChatProcesses();
  } catch (err) {
    return {
      running: false,
      level: 'not_ready',
      processes: [],
      dbPathInMemory: false,
      hasDecrypted: hasDecryptedStorage(wxDir),
      hint: err.message,
      suggestions: [
        '启动微信 PC 版并完成登录',
        '保持微信窗口不要最小化到托盘后立即退出',
      ],
    };
  }

  let dbPathInMemory = false;
  let matchedPid = null;

  for (const proc of processes) {
    const result = scanProcessForNeedles(proc.pid, needles, 400);
    if (result.found) {
      dbPathInMemory = true;
      matchedPid = proc.pid;
      break;
    }
  }

  const hasDecrypted = hasDecryptedStorage(wxDir);
  const level = getReadinessLevel({ running: true, dbPathInMemory, hasDecrypted });

  const suggestions = [];
  if (level === 'not_ready') {
    suggestions.push('启动微信 PC 版并完成登录后再回来');
  } else if (level === 'fallback') {
    suggestions.push('如需导出最新聊天记录，请重新登录该微信账号');
  } else if (level === 'offline') {
    suggestions.push('如需导出最新聊天记录，请启动微信并登录该账号');
  } else if (level === 'maybe') {
    suggestions.push('在微信里点开几个最近聊天，等待几秒后再扫描');
  }

  return {
    running: true,
    level,
    processes: processes.map((p) => ({
      pid: p.pid,
      imageName: p.imageName,
      memMb: Math.max(1, Math.round(p.memKb / 1024)),
      isPrimary: p.pid === processes[0].pid,
    })),
    dbPathInMemory,
    matchedPid,
    hasDecrypted,
    hint: getReadinessHints(level),
    suggestions,
  };
}

module.exports = {
  checkWeChatReadiness,
};
