const fs = require('fs');
const path = require('path');
const { getWeChatProcesses, scanProcessForNeedles } = require('./winMemory');
const { buildPathNeedles } = require('./scanUtils');

function hasDecryptedStorage(wxDir) {
  const decDir = path.join(wxDir, 'db_storage_decrypted');
  return fs.existsSync(path.join(decDir, 'message'));
}

function getReadinessLevel({ running, dbPathInMemory, hasDecrypted }) {
  if (!running) return 'not_ready';
  if (dbPathInMemory) return 'ready';
  if (hasDecrypted) return 'fallback';
  return 'maybe';
}

function getReadinessHints(level) {
  switch (level) {
    case 'ready':
      return '微信已登录，可以开始扫描';
    case 'fallback':
      return '微信已登录';
    case 'maybe':
      return '建议先在微信中打开几个聊天窗口，再回来扫描';
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
