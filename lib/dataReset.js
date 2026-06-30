const fs = require('fs');
const path = require('path');
const { isWeChatAccountDir } = require('./exportCore');
const { getLogDir } = require('./sessionLog');

const PASSPHRASE_FILE = '.wexin_passphrase';
const VOICE_CACHE_FILE = '.wetrace_voice_transcriptions.json';

function removePath(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return false;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function getAccountDecryptTargets(accountDir) {
  const resolved = path.resolve(accountDir);
  return [
    { id: 'passphrase', label: '密钥缓存', path: path.join(resolved, PASSPHRASE_FILE) },
    { id: 'decrypted', label: '解密数据库', path: path.join(resolved, 'db_storage_decrypted') },
    {
      id: 'decrypted_nested',
      label: '解密数据库（嵌套）',
      path: path.join(resolved, 'db_storage', 'db_storage_decrypted'),
    },
    { id: 'voice_cache', label: '语音转写缓存', path: path.join(resolved, VOICE_CACHE_FILE) },
  ];
}

function resetAccountDecryptData(accountDir) {
  const resolved = path.resolve(accountDir);
  if (!isWeChatAccountDir(resolved)) {
    throw new Error('所选目录不是有效的微信账号目录');
  }

  const removed = [];
  const skipped = [];

  for (const target of getAccountDecryptTargets(resolved)) {
    if (removePath(target.path)) {
      removed.push(target.id);
    } else {
      skipped.push(target.id);
    }
  }

  return {
    accountPath: resolved,
    removed,
    skipped,
  };
}

function resetAppData(userDataPath, { conversationCachePath, settingsPath } = {}) {
  const resolvedUserData = path.resolve(userDataPath);
  const cachePath = conversationCachePath || path.join(resolvedUserData, 'conversation-cache.json');
  const settingsFile = settingsPath || path.join(resolvedUserData, 'wetrace-settings.json');
  const logDir = getLogDir(resolvedUserData);

  const targets = [
    { id: 'conversation_cache', label: '会话扫描缓存', path: cachePath },
    { id: 'settings', label: '应用设置', path: settingsFile },
    { id: 'logs', label: '诊断日志', path: logDir },
  ];

  const removed = [];
  const skipped = [];

  for (const target of targets) {
    if (removePath(target.path)) {
      removed.push(target.id);
    } else {
      skipped.push(target.id);
    }
  }

  return {
    userDataPath: resolvedUserData,
    removed,
    skipped,
  };
}

module.exports = {
  resetAccountDecryptData,
  resetAppData,
  getAccountDecryptTargets,
};
