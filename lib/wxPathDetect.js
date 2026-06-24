const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanWeChatAccounts } = require('./exportCore');

function pathExists(dir) {
  try {
    return fs.existsSync(dir);
  } catch {
    return false;
  }
}

function hasWeChatAccounts(dir) {
  try {
    const scan = scanWeChatAccounts(dir);
    return scan.accounts.length > 0;
  } catch {
    return false;
  }
}

function buildCandidatePaths() {
  const home = os.homedir();
  const candidates = [];

  const push = (p, label) => {
    if (!p) return;
    candidates.push({ path: path.normalize(p), label });
  };

  push(path.join(home, 'Documents', 'WeChat Files'), 'Documents/WeChat Files');
  push(path.join(home, 'Documents', 'xwechat_files'), 'Documents/xwechat_files');
  push(path.join(home, 'xwechat_files'), '用户目录/xwechat_files');

  for (const drive of ['C', 'D', 'E', 'F']) {
    push(`${drive}:\\WeChat\\xwechat_files`, `${drive}:\\WeChat\\xwechat_files`);
    push(`${drive}:\\WeChat Files\\xwechat_files`, `${drive}:\\WeChat Files\\xwechat_files`);
    push(`${drive}:\\Program Files\\Tencent\\WeChat\\xwechat_files`, `${drive}:\\Tencent\\WeChat`);
    push(`${drive}:\\file\\WexinChat\\xwechat_files`, `${drive}:\\file\\WexinChat`);
  }

  const seen = new Set();
  return candidates.filter((item) => {
    const key = item.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectWeChatDataPaths() {
  const results = [];

  for (const candidate of buildCandidatePaths()) {
    if (!pathExists(candidate.path)) continue;

    if (hasWeChatAccounts(candidate.path)) {
      const scan = scanWeChatAccounts(candidate.path);
      results.push({
        path: candidate.path,
        label: candidate.label,
        accountCount: scan.accounts.length,
      });
      continue;
    }

    try {
      const entries = fs.readdirSync(candidate.path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(candidate.path, entry.name);
        if (entry.name === 'xwechat_files' && hasWeChatAccounts(nested)) {
          const scan = scanWeChatAccounts(nested);
          results.push({
            path: nested,
            label: `${candidate.label}/${entry.name}`,
            accountCount: scan.accounts.length,
          });
        }
      }
    } catch {
      // ignore unreadable directories
    }
  }

  return results;
}

module.exports = {
  detectWeChatDataPaths,
};
