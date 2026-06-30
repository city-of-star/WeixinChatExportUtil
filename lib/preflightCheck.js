const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getWxDirStatus } = require('./exportCore');
const { checkWeChatReadiness } = require('./wechatStatus');
const { getWeChatVersion, isNewWeChatMemoryModel, resolveWeixinExecutable } = require('./wechatProcess');
const { hasDecryptedStorage } = require('./decryptCore');
const { maskPath } = require('./sessionLog');

const MIN_FREE_GB = 2;

function isRunningAsAdmin() {
  if (process.platform !== 'win32') return true;
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getFreeDiskGb(targetPath) {
  try {
    if (typeof fs.statfsSync === 'function') {
      const resolved = path.resolve(targetPath);
      const statPath = fs.existsSync(resolved) ? resolved : path.parse(resolved).root;
      const { bavail, bsize } = fs.statfsSync(statPath);
      if (Number.isFinite(bavail) && Number.isFinite(bsize) && bsize > 0) {
        return (bavail * bsize) / 1024 / 1024 / 1024;
      }
    }
  } catch {
    // fall through
  }

  if (process.platform !== 'win32') return null;
  try {
    const root = path.parse(path.resolve(targetPath)).root || 'C:\\';
    const script = `(Get-PSDrive -Name '${root.replace(':\\', '').replace(':', '')}' -ErrorAction SilentlyContinue).Free`;
    const output = execSync(`powershell -NoProfile -Command "${script}"`, {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    const freeBytes = Number(output);
    if (!Number.isFinite(freeBytes) || freeBytes <= 0) return null;
    return freeBytes / 1024 / 1024 / 1024;
  } catch {
    return null;
  }
}

function makeCheck(id, level, label, detail) {
  return { id, level, label, detail: detail || '' };
}

function runPreflightChecks({ wxDir, accountPath = null, readiness: readinessInput = null }) {
  const checks = [];
  let resolvedAccount = accountPath;

  const isAdmin = isRunningAsAdmin();
  checks.push(
    makeCheck(
      'admin',
      isAdmin ? 'pass' : 'fail',
      isAdmin ? '已以管理员身份运行' : '未以管理员身份运行',
      isAdmin
        ? 'Hook 注入权限正常'
        : '微信 4.1.10+ 解密需要 Hook，请右键 exe 选择「以管理员身份运行」'
    )
  );

  let wechatVersion = null;
  try {
    wechatVersion = getWeChatVersion();
  } catch {
    wechatVersion = null;
  }
  const weixinExe = resolveWeixinExecutable();
  const newMemoryModel = isNewWeChatMemoryModel(wechatVersion);

  if (wechatVersion) {
    checks.push(
      makeCheck(
        'wechat_version',
        'pass',
        `微信版本 ${wechatVersion}`,
        newMemoryModel
          ? '4.1.10+ 需在 Hook 就绪后点击「登录」捕获密钥'
          : '将尝试从已登录的微信进程内存读取密钥'
      )
    );
  } else if (weixinExe) {
    checks.push(
      makeCheck(
        'wechat_version',
        'warn',
        '未能读取微信版本号',
        `已找到微信程序：${maskPath(weixinExe)}`
      )
    );
  } else {
    checks.push(
      makeCheck(
        'wechat_version',
        'warn',
        '未检测到微信安装',
        '若已有解密数据可离线扫描；首次使用请先安装并登录微信 PC 版'
      )
    );
  }

  let accountStatus = null;
  try {
    accountStatus = getWxDirStatus(wxDir, { accountPath });
    resolvedAccount = accountStatus.selectedPath || accountPath || resolvedAccount;
    if (accountStatus.needsAccountSelection && !accountPath) {
      checks.push(
        makeCheck(
          'account_dir',
          'fail',
          '尚未选择微信账号',
          '该目录下有多个账号，请点击要导出的账号卡片'
        )
      );
    } else if (accountStatus.resolved) {
      checks.push(
        makeCheck(
          'account_dir',
          'pass',
          '微信数据目录有效',
          maskPath(accountStatus.resolved)
        )
      );
    }
  } catch (err) {
    checks.push(
      makeCheck(
        'account_dir',
        'fail',
        '微信数据目录无效',
        err.message
      )
    );
  }

  const targetForDisk = resolvedAccount || wxDir || os.homedir();
  const freeGb = getFreeDiskGb(targetForDisk);
  if (freeGb != null) {
    checks.push(
      makeCheck(
        'disk_space',
        freeGb >= MIN_FREE_GB ? 'pass' : 'fail',
        freeGb >= MIN_FREE_GB ? `磁盘剩余 ${freeGb.toFixed(1)} GB` : `磁盘剩余仅 ${freeGb.toFixed(1)} GB`,
        freeGb >= MIN_FREE_GB
          ? '空间足够完成解密'
          : `解密至少需要约 ${MIN_FREE_GB} GB 可用空间，请清理后再试`
      )
    );
  } else {
    checks.push(
      makeCheck(
        'disk_space',
        'warn',
        '未能检测磁盘空间',
        '若解密失败，请检查目标磁盘是否有足够空间'
      )
    );
  }

  let readiness = readinessInput;
  if (resolvedAccount) {
    try {
      if (!readiness) {
        readiness = checkWeChatReadiness(resolvedAccount);
      }
      const hasDecrypted = hasDecryptedStorage(resolvedAccount);
      if (readiness.level === 'ready') {
        checks.push(
          makeCheck('wechat_login', 'pass', '微信已登录当前账号', readiness.hint)
        );
      } else if (hasDecrypted) {
        checks.push(
          makeCheck(
            'wechat_login',
            'warn',
            '微信未登录或未检测到当前账号',
            '可使用已有解密数据扫描；如需最新聊天记录，请先登录微信'
          )
        );
      } else if (newMemoryModel) {
        checks.push(
          makeCheck(
            'wechat_login',
            'warn',
            '首次解密建议先登录微信',
            '扫描时程序会重启微信并在 Hook 就绪后提示你点击「登录」'
          )
        );
      } else {
        checks.push(
          makeCheck(
            'wechat_login',
            'warn',
            '建议先登录微信',
            readiness.hint || '请启动微信并打开几个聊天窗口后再扫描'
          )
        );
      }

      if (hasDecrypted) {
        checks.push(
          makeCheck(
            'decrypted_cache',
            'pass',
            '已有本地解密数据',
            '若数据未过期，扫描会更快；如需最新记录可强制重新解密'
          )
        );
      }
    } catch (err) {
      checks.push(
        makeCheck(
          'wechat_login',
          'warn',
          '未能检测微信登录状态',
          err.message
        )
      );
    }
  }

  const blocking = checks.filter((item) => item.level === 'fail');
  const warnings = checks.filter((item) => item.level === 'warn');
  const ok = blocking.length === 0;

  let blockingMessage = '';
  if (!ok) {
    blockingMessage = blocking.map((item) => `• ${item.label}${item.detail ? `：${item.detail}` : ''}`).join('\n');
  }

  let warningSummary = '';
  if (warnings.length > 0) {
    warningSummary = warnings.map((item) => `• ${item.label}`).join('\n');
  }

  return {
    ok,
    hasWarnings: warnings.length > 0,
    checks,
    blocking,
    warnings,
    blockingMessage,
    warningSummary,
    resolvedAccount,
    environment: {
      isAdmin,
      wechatVersion,
      newMemoryModel,
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      totalMemGb: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
      freeDiskGb: freeGb != null ? Math.round(freeGb * 10) / 10 : null,
    },
  };
}

module.exports = {
  runPreflightChecks,
  isRunningAsAdmin,
};
