const { verifyEncKey } = require('./decryptDb');
const {
  buildPathNeedles,
  findNeedleHits,
  getPrioritySlices,
} = require('./scanUtils');
const {
  scanPassphraseNearNeedles,
  tryCachedPassphrase,
  saveCachedPassphrase,
  loadCachedPassphrase,
  getLastMatchedPassphrase,
} = require('./passphraseScan');
const {
  getWeChatVersion,
  isNewWeChatMemoryModel,
  sleep,
} = require('./wechatProcess');

const HEX_MARKER = Buffer.from("x'");

function processHexMatch(hexStr, addr, dbFiles, saltToDbs, keyMap, remainingSalts, pid, log) {
  const hexLen = hexStr.length;

  const tryMatch = (encKeyHex, saltHex, label) => {
    if (!remainingSalts.has(saltHex)) return false;
    const encKey = Buffer.from(encKeyHex, 'hex');
    for (const item of dbFiles) {
      if (item.salt === saltHex && verifyEncKey(encKey, item.page1)) {
        keyMap[saltHex] = encKeyHex;
        remainingSalts.delete(saltHex);
        log?.(`找到密钥 salt=${saltHex}${label ? ` (${label})` : ''} PID=${pid} @0x${addr.toString(16)}`);
        log?.(`  数据库: ${(saltToDbs[saltHex] || []).join(', ')}`);
        return true;
      }
    }
    return false;
  };

  if (hexLen === 96) {
    return tryMatch(hexStr.slice(0, 64), hexStr.slice(64)) ? 1 : 0;
  }

  if (hexLen === 64) {
    const encKeyHex = hexStr;
    for (const item of dbFiles) {
      if (remainingSalts.has(item.salt) && verifyEncKey(Buffer.from(encKeyHex, 'hex'), item.page1)) {
        keyMap[item.salt] = encKeyHex;
        remainingSalts.delete(item.salt);
        log?.(`找到密钥 salt=${item.salt} PID=${pid} @0x${addr.toString(16)}`);
        log?.(`  数据库: ${(saltToDbs[item.salt] || []).join(', ')}`);
        return 1;
      }
    }
    return 0;
  }

  if (hexLen > 96 && hexLen % 2 === 0) {
    return tryMatch(hexStr.slice(0, 64), hexStr.slice(-32), `long hex ${hexLen}`) ? 1 : 0;
  }

  return 0;
}

function countHexPatterns(buffer) {
  let count = 0;
  let pos = 0;
  while (pos < buffer.length) {
    const idx = buffer.indexOf(HEX_MARKER, pos);
    if (idx === -1) break;
    const start = idx + 2;
    let end = start;
    while (end < buffer.length && end - start <= 192) {
      const c = buffer[end];
      const isHex =
        (c >= 0x30 && c <= 0x39) ||
        (c >= 0x41 && c <= 0x46) ||
        (c >= 0x61 && c <= 0x66);
      if (!isHex) break;
      end += 1;
    }
    if (end < buffer.length && buffer[end] === 0x27 && end - start >= 64) {
      count += 1;
    }
    pos = idx + 2;
  }
  return count;
}

function scanHexPatterns(buffer, dbFiles, saltToDbs, keyMap, remainingSalts, baseAddr, pid, log) {
  let matches = 0;
  let pos = 0;

  while (pos < buffer.length) {
    const idx = buffer.indexOf(HEX_MARKER, pos);
    if (idx === -1) break;

    const start = idx + 2;
    let end = start;
    while (end < buffer.length && end - start <= 192) {
      const c = buffer[end];
      const isHex =
        (c >= 0x30 && c <= 0x39) ||
        (c >= 0x41 && c <= 0x46) ||
        (c >= 0x61 && c <= 0x66);
      if (!isHex) break;
      end += 1;
    }

    if (end < buffer.length && buffer[end] === 0x27 && end - start >= 64) {
      const hexStr = buffer.toString('ascii', start, end);
      matches += processHexMatch(
        hexStr,
        baseAddr + idx,
        dbFiles,
        saltToDbs,
        keyMap,
        remainingSalts,
        pid,
        log
      );
    }

    pos = idx + 2;
  }

  return matches;
}

function scanSaltBinary(buffer, dbFiles, saltToDbs, keyMap, remainingSalts, baseAddr, pid, log) {
  let matches = 0;
  const seenSalts = new Set();

  for (const item of dbFiles) {
    if (!remainingSalts.has(item.salt) || seenSalts.has(item.salt)) continue;
    const saltBytes = item.page1.subarray(0, 16);
    let pos = 0;

    while (pos < buffer.length) {
      const idx = buffer.indexOf(saltBytes, pos);
      if (idx === -1) break;

      const offsets = [16, 24, 32, 40, 48, 56, 64, 72, 80, 96, 128, 160];
      for (const offset of offsets) {
        if (idx < offset) continue;
        const candidate = buffer.subarray(idx - offset, idx - offset + 32);
        if (candidate.length !== 32) continue;
        if (verifyEncKey(candidate, item.page1)) {
          keyMap[item.salt] = candidate.toString('hex');
          remainingSalts.delete(item.salt);
          seenSalts.add(item.salt);
          matches += 1;
          log?.(`找到密钥(二进制邻近) salt=${item.salt} PID=${pid} @0x${(baseAddr + idx).toString(16)}`);
          log?.(`  数据库: ${(saltToDbs[item.salt] || []).join(', ')}`);
          break;
        }
      }

      pos = idx + 1;
      if (!remainingSalts.has(item.salt)) break;
    }
  }

  return matches;
}

function scanSaltHexAscii(buffer, dbFiles, saltToDbs, keyMap, remainingSalts, baseAddr, pid, log) {
  let matches = 0;

  for (const item of dbFiles) {
    if (!remainingSalts.has(item.salt)) continue;
    const saltAscii = Buffer.from(item.salt, 'ascii');
    let pos = 0;

    while (pos < buffer.length) {
      const idx = buffer.indexOf(saltAscii, pos);
      if (idx === -1) break;

      if (idx >= 64) {
        const maybeHex = buffer.toString('ascii', idx - 64, idx);
        if (/^[0-9a-fA-F]{64}$/.test(maybeHex)) {
          matches += processHexMatch(
            `${maybeHex}${item.salt}`,
            baseAddr + idx - 64,
            dbFiles,
            saltToDbs,
            keyMap,
            remainingSalts,
            pid,
            log
          );
        }
      }

      pos = idx + 1;
      if (!remainingSalts.has(item.salt)) break;
    }
  }

  return matches;
}

function scanBufferSlice(
  buffer,
  sliceStart,
  dbFiles,
  saltToDbs,
  keyMap,
  remainingSalts,
  baseAddr,
  pid,
  log
) {
  if (!buffer || buffer.length === 0 || remainingSalts.size === 0) return 0;

  let matches = 0;
  matches += scanHexPatterns(buffer, dbFiles, saltToDbs, keyMap, remainingSalts, baseAddr + sliceStart, pid, log);
  matches += scanSaltBinary(buffer, dbFiles, saltToDbs, keyMap, remainingSalts, baseAddr + sliceStart, pid, log);
  matches += scanSaltHexAscii(buffer, dbFiles, saltToDbs, keyMap, remainingSalts, baseAddr + sliceStart, pid, log);
  return matches;
}

function scanMemoryBuffer(buffer, dbFiles, saltToDbs, keyMap, remainingSalts, baseAddr, pid, log, needles, options = {}) {
  const hits = needles ? findNeedleHits(buffer, needles) : [];
  const slices = options.fullScan
    ? [{ start: 0, end: buffer.length, reason: 'full' }]
    : getPrioritySlices(buffer, hits, 262144);

  const ordered = options.fullScan
    ? slices
    : [
        ...slices.filter((s) => s.reason.startsWith('near:')),
        ...slices.filter((s) => !s.reason.startsWith('near:')),
      ];

  let matches = 0;
  for (const slice of ordered) {
    if (remainingSalts.size === 0) break;
    const chunk = buffer.subarray(slice.start, slice.end);
    matches += scanBufferSlice(
      chunk,
      slice.start,
      dbFiles,
      saltToDbs,
      keyMap,
      remainingSalts,
      baseAddr,
      pid,
      log
    );
  }

  if (options.includePassphrase && remainingSalts.size > 0 && hits.length > 0) {
    matches += scanPassphraseNearNeedles(
      buffer,
      hits,
      dbFiles,
      saltToDbs,
      keyMap,
      remainingSalts,
      log
    );
  }

  return matches;
}

function crossVerifyKeys(dbFiles, saltToDbs, keyMap, log) {
  const missing = new Set(Object.keys(saltToDbs).filter((salt) => !keyMap[salt]));
  if (missing.size === 0 || Object.keys(keyMap).length === 0) return;

  log?.(`还有 ${missing.size} 个 salt 未匹配，尝试交叉验证...`);
  for (const saltHex of [...missing]) {
    for (const item of dbFiles) {
      if (item.salt !== saltHex) continue;
      for (const knownKeyHex of Object.values(keyMap)) {
        if (verifyEncKey(Buffer.from(knownKeyHex, 'hex'), item.page1)) {
          keyMap[saltHex] = knownKeyHex;
          missing.delete(saltHex);
          log?.(`交叉验证成功: salt=${saltHex}`);
          break;
        }
      }
      if (keyMap[saltHex]) break;
    }
  }
}

function buildKeysJson(dbFiles, keyMap, dbDir, passphraseHex = null) {
  const result = { _db_dir: dbDir.replace(/\\/g, '/') };
  if (passphraseHex) {
    result._passphrase_hex = passphraseHex;
  }
  for (const item of dbFiles) {
    if (keyMap[item.salt]) {
      result[item.rel] = {
        enc_key: keyMap[item.salt],
        salt: item.salt,
        size_mb: Math.round((item.size / 1024 / 1024) * 10) / 10,
      };
    }
  }
  return result;
}

const PRIMARY_PROCESS_NAMES = new Set(['Weixin.exe', 'WeChat.exe']);

function sortProcesses(processes) {
  return [...processes].sort((a, b) => {
    const aPrimary = PRIMARY_PROCESS_NAMES.has(a.imageName) ? 1 : 0;
    const bPrimary = PRIMARY_PROCESS_NAMES.has(b.imageName) ? 1 : 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    return b.memKb - a.memKb;
  });
}

function splitProcesses(processes) {
  const primary = processes.filter((proc) => PRIMARY_PROCESS_NAMES.has(proc.imageName));
  const secondary = processes.filter((proc) => !PRIMARY_PROCESS_NAMES.has(proc.imageName));
  return { primary, secondary };
}

async function scanProcessForKeys({
  proc,
  dbFiles,
  saltToDbs,
  keyMap,
  remainingSalts,
  needles,
  onProgress,
  passLabel,
  scanOptions = {},
  stats,
}) {
  const {
    enumRegions,
    readProcessMemory,
    openProcess,
    closeProcess,
  } = require('./winMemory');

  const log = (message) => onProgress?.({ phase: 'keys', message });
  const handle = openProcess(proc.pid);
  if (!handle) {
    log(`无法打开进程 ${proc.imageName} PID=${proc.pid}，跳过`);
    return 0;
  }

  let allMatches = 0;
  try {
    const regions = enumRegions(handle);
    const totalBytes = regions.reduce((sum, r) => sum + r.size, 0);
    log(
      `${passLabel} 扫描 ${proc.imageName} PID=${proc.pid} (${(totalBytes / 1024 / 1024).toFixed(0)}MB, ${regions.length} 区域)...`
    );

    let scanned = 0;
    for (let i = 0; i < regions.length; i += 1) {
      if (remainingSalts.size === 0) break;

      const { base, size } = regions[i];
      const data = readProcessMemory(handle, base, size);
      scanned += size;

      if (data && data.length > 0) {
        if (stats) {
          stats.hexPatterns += countHexPatterns(data);
        }
        allMatches += scanMemoryBuffer(
          data,
          dbFiles,
          saltToDbs,
          keyMap,
          remainingSalts,
          Number(base),
          proc.pid,
          log,
          needles,
          scanOptions
        );
      }

      if ((i + 1) % 15 === 0) {
        await sleep(0);
      }

      if ((i + 1) % 150 === 0) {
        const progress = totalBytes ? ((scanned / totalBytes) * 100).toFixed(1) : '100.0';
        log(
          `${proc.imageName} 扫描 ${progress}% | 已匹配 ${Object.keys(keyMap).length}/${Object.keys(saltToDbs).length} 个 salt`
        );
      }
    }
  } finally {
    closeProcess(handle);
  }

  return allMatches;
}

async function runScanPass({
  processes,
  secondary,
  dbFiles,
  saltToDbs,
  keyMap,
  remainingSalts,
  needles,
  onProgress,
  passLabel,
  scanOptions,
  stats,
}) {
  const log = (message) => onProgress?.({ phase: 'keys', message });
  let matches = 0;
  for (const proc of processes) {
    if (remainingSalts.size === 0) break;
    matches += await scanProcessForKeys({
      proc,
      dbFiles,
      saltToDbs,
      keyMap,
      remainingSalts,
      needles,
      onProgress,
      passLabel,
      scanOptions,
      stats,
    });
  }

  if (remainingSalts.size > 0 && secondary.length > 0) {
    log(`主进程未找全密钥，扫描附属进程 (${secondary.length} 个)...`);
  }

  if (remainingSalts.size > 0 && secondary.length > 0) {
    for (const proc of secondary) {
      if (remainingSalts.size === 0) break;
      matches += await scanProcessForKeys({
        proc,
        dbFiles,
        saltToDbs,
        keyMap,
        remainingSalts,
        needles,
        onProgress,
        passLabel: `${passLabel}(附属)`,
        scanOptions,
        stats,
      });
    }
  }
  return matches;
}

async function extractKeysFromWeChat({ dbDir, wxDir, onProgress, loginCapture = true, keysPath = null }) {
  if (process.platform !== 'win32') {
    throw new Error('自动解密目前仅支持 Windows。');
  }

  const { collectDbFiles } = require('./decryptDb');
  const { getWeChatProcesses } = require('./winMemory');
  const { tryImportKeysFile, getDefaultKeysPath } = require('./keyImport');
  const { extractKeysViaDllHook, isDllHookAvailable, getLastHookPassphrase } = require('./wxKeyHook');
  const log = (message) => onProgress?.({ phase: 'keys', message });
  const { dbFiles, saltToDbs } = collectDbFiles(dbDir);
  if (dbFiles.length === 0) {
    throw new Error(`未在 ${dbDir} 找到 .db 文件`);
  }

  const wechatVersion = getWeChatVersion();
  const dllHookAvailable = isDllHookAvailable();
  const newMemoryModel =
    isNewWeChatMemoryModel(wechatVersion) || (!wechatVersion && dllHookAvailable);

  if (wechatVersion) {
    log(`微信版本: ${wechatVersion}`);
    if (newMemoryModel) {
      log('微信 4.1.10+ 已不再把密钥明文放在内存中，需使用 DLL Hook 或导入密钥');
    }
  } else if (newMemoryModel) {
    log('未能读取微信版本，将按新版微信流程尝试 Hook 捕获密钥');
  }

  log(`找到 ${dbFiles.length} 个数据库，${Object.keys(saltToDbs).length} 个不同 salt`);

  const keyMap = {};
  const remainingSalts = new Set(Object.keys(saltToDbs));
  const started = Date.now();

  const importPath = keysPath || getDefaultKeysPath(wxDir);
  const imported = tryImportKeysFile({
    keysPath: importPath,
    dbFiles,
    saltToDbs,
    log,
  });
  if (imported) {
    Object.assign(keyMap, imported);
    for (const salt of Object.keys(imported)) {
      remainingSalts.delete(salt);
    }
    crossVerifyKeys(dbFiles, saltToDbs, keyMap, log);
  }

  if (wxDir && remainingSalts.size > 0) {
    tryCachedPassphrase({ wxDir, dbFiles, saltToDbs, keyMap, remainingSalts, log });
    crossVerifyKeys(dbFiles, saltToDbs, keyMap, log);
  }

  if (remainingSalts.size > 0 && newMemoryModel && loginCapture) {
    if (dllHookAvailable) {
      try {
        await extractKeysViaDllHook({
          dbDir,
          dbFiles,
          saltToDbs,
          keyMap,
          remainingSalts,
          onProgress,
          wxDir,
        });
        crossVerifyKeys(dbFiles, saltToDbs, keyMap, log);
      } catch (err) {
        log(`自动获取密钥失败: ${err.message}`);
      }
    } else {
      log('内置解密模块未找到，请使用完整安装包或联系发布者');
    }
  }

  if (remainingSalts.size > 0 && !newMemoryModel) {
    const needles = wxDir ? buildPathNeedles(wxDir) : buildPathNeedles(dbDir.replace(/[/\\]db_storage$/, ''));
    const allProcesses = sortProcesses(getWeChatProcesses());
    const { primary, secondary } = splitProcesses(allProcesses);
    const processes = primary.length ? primary : allProcesses;
    const stats = { hexPatterns: 0 };
    await runScanPass({
      processes,
      secondary,
      dbFiles,
      saltToDbs,
      keyMap,
      remainingSalts,
      needles,
      onProgress,
      passLabel: '主进程',
      scanOptions: {},
      stats,
    });
    crossVerifyKeys(dbFiles, saltToDbs, keyMap, log);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  log(`密钥提取完成: ${elapsed}s, 找到 ${Object.keys(keyMap).length}/${Object.keys(saltToDbs).length}`);

  if (Object.keys(keyMap).length === 0) {
    let message;

    if (newMemoryModel) {
      if (!isDllHookAvailable()) {
        message =
          '内置解密模块缺失，请确认下载的是完整安装包。\n' +
          '若使用文件夹版，请保留整个 win-unpacked 目录，不要只复制 exe。';
      } else if (!loginCapture) {
        message =
          '微信 4.1.10+ 需要在登录时捕获密钥。\n' +
          '请重新扫描，并在看到「Hook 已就绪」后点击微信「登录」。';
      } else {
        message =
          '未能获取数据库密钥，请按以下步骤重试：\n' +
          '1. 右键本程序，选择「以管理员身份运行」\n' +
          '2. 确认微信已登录，并打开几个聊天窗口\n' +
          '3. 扫描时若微信被重启，等「Hook 已就绪」后再点击「登录」';
      }
    } else {
      message =
        '未能获取数据库密钥，请确认：\n' +
        '1. 微信已登录，并打开几个聊天窗口\n' +
        '2. 以管理员身份运行本程序后重试';
    }

    throw new Error(message);
  }

  const matchedPassphrase = getLastMatchedPassphrase() || getLastHookPassphrase();
  if (wxDir && matchedPassphrase && !loadCachedPassphrase(wxDir)) {
    saveCachedPassphrase(wxDir, matchedPassphrase);
    log('已缓存 passphrase，下次可直接派生密钥');
  }

  if (remainingSalts.size > 0) {
    log(`警告: 仍有 ${remainingSalts.size} 个数据库未匹配到独立密钥，将尝试交叉验证结果解密`);
  }

  const hookPassphrase = getLastHookPassphrase();
  const passphraseHex = hookPassphrase
    ? (Buffer.isBuffer(hookPassphrase) ? hookPassphrase : Buffer.from(hookPassphrase)).toString('hex')
    : matchedPassphrase
      ? (Buffer.isBuffer(matchedPassphrase) ? matchedPassphrase : Buffer.from(String(matchedPassphrase), 'utf8')).toString('hex')
      : null;

  return buildKeysJson(dbFiles, keyMap, dbDir, passphraseHex);
}

module.exports = {
  extractKeysFromWeChat,
};
