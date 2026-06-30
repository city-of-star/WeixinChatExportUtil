const { app, BrowserWindow, dialog, ipcMain, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { resolveWxDir, getWxDirStatus } = require('../lib/exportCore');
const { detectWeChatDataPaths } = require('../lib/wxPathDetect');
const {
  getConversationCache,
  saveConversationCache,
  clearConversationCache,
  listConversationCaches,
  updateCacheDisplayName,
} = require('../lib/conversationCache');
const { createScanSession, getLogDir, maskPath } = require('../lib/sessionLog');
const { classifyScanError, buildFeedbackSummary } = require('../lib/errorCatalog');
const { runPreflightChecks } = require('../lib/preflightCheck');

let mainWindow = null;
let exportRunning = false;
let scanRunning = false;
let scanCancelRequested = false;
let exportCancelRequested = false;
let currentWorker = null;
let scanWorker = null;

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'wetrace-settings.json');
}

function getConversationCachePath() {
  return path.join(app.getPath('userData'), 'conversation-cache.json');
}

function getDiagnosticsLogDir() {
  return getLogDir(app.getPath('userData'));
}

function buildScanSessionMeta(options = {}) {
  const pkg = require('../package.json');
  const { isDllHookAvailable } = require('../lib/wxKeyHook');
  return {
    app_version: app.getVersion() || pkg.version,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    hook_dll: isDllHookAvailable() ? 'ok' : 'missing',
    wx_dir: maskPath(options.wxDir || ''),
    account_path: maskPath(options.accountPath || ''),
    force_decrypt: options.forceDecrypt ? 'true' : 'false',
    login_capture: options.loginCapture !== false ? 'true' : 'false',
  };
}

function resolveAppIconPath() {
  const candidates = ['icon.ico', 'icon.png', 'logo.svg'];
  for (const name of candidates) {
    const candidate = path.join(__dirname, '..', 'build', name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function createWindow() {
  const iconPath = resolveAppIconPath();
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 920,
    height: 820,
    minWidth: 720,
    minHeight: 680,
    title: '微迹 Wetrace',
    icon: icon && !icon.isEmpty() ? icon : iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('export-progress', payload);
  }
}

function runScanWorker(options, scanSession = null) {
  return new Promise((resolve, reject) => {
    if (scanWorker) {
      scanWorker.terminate().catch(() => {});
      scanWorker = null;
    }

    scanCancelRequested = false;
    let settled = false;
    const worker = new Worker(path.join(__dirname, 'scanWorker.js'), {
      workerData: { options },
    });
    scanWorker = worker;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      if (scanWorker === worker) {
        scanWorker = null;
      }
      worker.terminate().catch(() => {});
      handler(value);
    };

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        scanSession?.append('progress', {
          phase: msg.event?.phase || '',
          subphase: msg.event?.subphase || '',
          current: msg.event?.current || '',
          total: msg.event?.total || '',
          message: msg.event?.message || '',
        });
        sendProgress(msg.event);
      } else if (msg.type === 'done') {
        finish(resolve, msg);
      }
    });

    worker.on('error', (err) => {
      scanSession?.append('worker_error', { message: err.message, stack: err.stack || '' });
      finish(reject, err);
    });

    worker.on('exit', (code) => {
      if (settled) return;
      if (scanCancelRequested) {
        finish(resolve, { ok: false, cancelled: true, error: '扫描已取消' });
        return;
      }
      if (code !== 0) {
        const err = new Error(`扫描任务异常退出 (code ${code})`);
        scanSession?.append('worker_exit', { code: String(code), message: err.message });
        finish(reject, err);
      }
    });
  });
}

let profileWorkerChain = Promise.resolve();

function runProfileWorkerOnce(accounts) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(path.join(__dirname, 'profileWorker.js'), {
      workerData: { accounts: accounts || [] },
    });

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      handler(value);
    };

    worker.on('message', (msg) => {
      if (msg.type === 'done') {
        finish(resolve, msg);
      }
    });

    worker.on('error', (err) => {
      finish(reject, err);
    });

    worker.on('exit', (code) => {
      if (!settled && code !== 0) {
        finish(reject, new Error(`资料加载任务异常退出 (code ${code})`));
      }
    });
  });
}

function runProfileWorker(accounts) {
  const job = profileWorkerChain.then(() => runProfileWorkerOnce(accounts));
  profileWorkerChain = job.catch(() => {});
  return job;
}

ipcMain.handle('load-settings', async () => {
  const settingsPath = getSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch {
    // ignore broken settings file
  }
  return {};
});

ipcMain.handle('save-settings', async (_event, settings) => {
  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings || {}, null, 2), 'utf8');
  return { ok: true };
});

ipcMain.handle('get-app-info', async () => {
  const pkg = require('../package.json');
  const { isWhisperModelBundled, isVoiceTranscriptionAvailable } = require('../lib/voiceTranscription');
  const { getPerfProfile } = require('../lib/exportEstimate');
  const whisperModelBundled = isWhisperModelBundled();
  return {
    name: app.getName() || pkg.build?.productName || '微迹 Wetrace',
    version: app.getVersion() || pkg.version,
    description: '珍藏每一段对话',
    whisperModelBundled,
    voiceTranscriptionAvailable: isVoiceTranscriptionAvailable(),
    perfProfile: getPerfProfile(),
  };
});

ipcMain.handle('estimate-export', async (_event, params) => {
  const { estimateExportDuration, getPerfProfile } = require('../lib/exportEstimate');
  const settingsPath = getSettingsPath();
  let learned = null;
  try {
    if (fs.existsSync(settingsPath)) {
      learned = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).exportPerf || null;
    }
  } catch {
    // ignore broken settings
  }
  return estimateExportDuration({
    perfProfile: getPerfProfile(),
    ...(params || {}),
    learned,
  });
});

ipcMain.handle('record-export-perf', async (_event, sample) => {
  const { recordExportSample } = require('../lib/exportEstimate');
  const settingsPath = getSettingsPath();
  let settings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch {
    // ignore broken settings
  }
  settings.exportPerf = recordExportSample(settings.exportPerf, sample || {});
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return { ok: true, exportPerf: settings.exportPerf };
});

ipcMain.handle('detect-wx-paths', async () => {
  try {
    return { ok: true, paths: detectWeChatDataPaths() };
  } catch (err) {
    return { ok: false, error: err.message, paths: [] };
  }
});

ipcMain.handle('pick-file', async (_event, { title, filters, defaultPath }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    defaultPath,
    properties: ['openFile'],
    filters: filters || [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('pick-directory', async (_event, { title, defaultPath }) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('is-directory-empty', async (_event, dirPath) => {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) {
      return { ok: true, empty: true };
    }
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: '路径不是文件夹' };
    }
    const entries = fs.readdirSync(dirPath);
    return { ok: true, empty: entries.length === 0, count: entries.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('validate-wx-dir', async (_event, payload) => {
  const wxDir = typeof payload === 'string' ? payload : payload?.wxDir;
  const accountPath = typeof payload === 'object' ? payload?.accountPath : null;
  try {
    const status = getWxDirStatus(wxDir, { accountPath });
    if (status.needsAccountSelection) {
      return { ok: true, ...status, readiness: null };
    }
    return { ok: true, ...status, readiness: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('enrich-accounts', async (_event, { accounts }) => {
  try {
    const msg = await runProfileWorker(accounts || []);
    if (msg.ok) {
      return { ok: true, accounts: msg.accounts || [] };
    }
    return { ok: false, error: msg.error, accounts: accounts || [] };
  } catch (err) {
    return { ok: false, error: err.message, accounts: accounts || [] };
  }
});

ipcMain.handle('check-wechat-status', async (_event, payload) => {
  const wxDir = typeof payload === 'string' ? payload : payload?.wxDir;
  const accountPath = typeof payload === 'object' ? payload?.accountPath : null;
  try {
    const { checkWeChatReadiness } = require('../lib/wechatStatus');
    const { scanWeChatAccounts } = require('../lib/exportCore');
    let resolved = accountPath || null;
    if (!resolved && wxDir) {
      const scan = scanWeChatAccounts(wxDir);
      resolved = scan.selectedPath;
    }
    if (!resolved && wxDir) {
      resolved = resolveWxDir(wxDir, { accountPath });
    }
    const readiness = checkWeChatReadiness(resolved || wxDir);
    return { ok: true, readiness, resolved };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('load-conversation-cache', async (_event, { accountPath }) => {
  try {
    const cache = getConversationCache(getConversationCachePath(), accountPath);
    if (!cache) {
      return { ok: true, cache: null };
    }
    return { ok: true, cache };
  } catch (err) {
    return { ok: false, error: err.message, cache: null };
  }
});

ipcMain.handle('clear-conversation-cache', async (_event, { accountPath }) => {
  try {
    clearConversationCache(getConversationCachePath(), accountPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('patch-conversation-cache-label', async (_event, { accountPath, displayName }) => {
  try {
    const updated = updateCacheDisplayName(getConversationCachePath(), accountPath, displayName);
    return { ok: updated };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('list-conversation-caches', async () => {
  try {
    const caches = listConversationCaches(getConversationCachePath());
    return { ok: true, caches };
  } catch (err) {
    return { ok: false, error: err.message, caches: [] };
  }
});

ipcMain.handle('get-scan-requirements', async (_event, payload) => {
  try {
    const { needsDecrypt, hasDecryptedStorage } = require('../lib/decryptCore');
    const accountPath = payload?.accountPath;
    if (!accountPath) {
      return { ok: false, error: '未选择账号' };
    }
    const forceDecrypt = Boolean(payload?.forceDecrypt);
    return {
      ok: true,
      accountPath,
      needsDecrypt: needsDecrypt(accountPath, forceDecrypt),
      hasDecrypted: hasDecryptedStorage(accountPath),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('run-preflight', async (_event, payload) => {
  try {
    const result = runPreflightChecks({
      wxDir: payload?.wxDir,
      accountPath: payload?.accountPath || null,
      readiness: payload?.readiness || null,
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message, checks: [] };
  }
});

ipcMain.handle('get-log-dir', async () => {
  const logDir = getDiagnosticsLogDir();
  fs.mkdirSync(logDir, { recursive: true });
  return { ok: true, logDir };
});

ipcMain.handle('open-log-dir', async () => {
  const logDir = getDiagnosticsLogDir();
  fs.mkdirSync(logDir, { recursive: true });
  await shell.openPath(logDir);
  return { ok: true, logDir };
});

ipcMain.handle('reset-account-decrypt-data', async (_event, payload) => {
  if (scanRunning || exportRunning) {
    return { ok: false, error: '扫描或导出进行中，请稍后再试' };
  }
  try {
    const accountPath = payload?.accountPath;
    if (!accountPath) {
      return { ok: false, error: '未选择账号' };
    }
    const { resetAccountDecryptData } = require('../lib/dataReset');
    const result = resetAccountDecryptData(accountPath);
    clearConversationCache(getConversationCachePath(), result.accountPath);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('reset-app-data', async () => {
  if (scanRunning || exportRunning) {
    return { ok: false, error: '扫描或导出进行中，请稍后再试' };
  }
  try {
    const { resetAppData } = require('../lib/dataReset');
    const userDataPath = app.getPath('userData');
    const result = resetAppData(userDataPath, {
      conversationCachePath: getConversationCachePath(),
      settingsPath: getSettingsPath(),
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('scan-conversations', async (_event, options) => {
  if (scanRunning) {
    return { ok: false, error: '扫描正在进行中' };
  }

  scanRunning = true;
  const scanSession = createScanSession(app.getPath('userData'), buildScanSessionMeta(options));
  scanSession.append('scan_start', { message: '开始扫描会话' });

  const { needsDecrypt } = require('../lib/decryptCore');
  const accountPath = options?.accountPath || null;
  const mustDecrypt =
    accountPath && needsDecrypt(accountPath, Boolean(options?.forceDecrypt));
  const clientPreflightOk = Boolean(options?.clientPreflightOk);

  let preflight = null;
  if (mustDecrypt && !clientPreflightOk) {
    try {
      preflight = runPreflightChecks({
        wxDir: options?.wxDir,
        accountPath,
      });
      scanSession.append('preflight', {
        ok: preflight.ok ? 'true' : 'false',
        blocking: preflight.blocking.map((item) => item.id).join(','),
        warnings: preflight.warnings.map((item) => item.id).join(','),
      });
      for (const check of preflight.checks) {
        scanSession.append('preflight_check', {
          id: check.id,
          level: check.level,
          label: check.label,
          detail: check.detail,
        });
      }

      if (!preflight.ok) {
        const errorInfo = {
          code: 'WTR-P001',
          title: '环境检查未通过',
          userMessage:
            '扫描前环境检查未通过，请先处理以下问题：\n\n' +
            preflight.blockingMessage,
          suggestions: preflight.blocking.map((item) => item.detail || item.label).filter(Boolean),
          rawMessage: preflight.blockingMessage,
        };
        scanSession.finalize({
          ok: false,
          code: errorInfo.code,
          message: errorInfo.rawMessage,
        });
        return {
          ok: false,
          error: errorInfo.userMessage,
          errorInfo,
          feedbackSummary: buildFeedbackSummary(errorInfo, scanSession.fileName),
          logFileName: scanSession.fileName,
          logDir: scanSession.logDir,
          preflight,
          preflightBlocked: true,
        };
      }
    } catch (err) {
      scanSession.append('preflight_error', { message: err.message });
    }
  } else {
    scanSession.append('preflight', {
      skipped: mustDecrypt ? 'client_verified' : 'decrypt_not_required',
      needs_decrypt: mustDecrypt ? 'true' : 'false',
    });
  }

  try {
    const msg = await runScanWorker(options, scanSession);
    if (msg.ok) {
      scanSession.finalize({ ok: true, code: 'OK', message: 'scan completed' });
      const accountPath = options.accountPath || msg.wxDir;
      saveConversationCache(getConversationCachePath(), accountPath, {
        conversationCount: msg.conversationCount,
        totalMessages: msg.totalMessages,
        totalVoiceMessages: msg.totalVoiceMessages,
        selfWxid: msg.selfWxid,
        displayName: options.displayName || null,
        conversations: msg.conversations,
      });
      return {
        ok: true,
        conversations: msg.conversations,
        conversationCount: msg.conversationCount,
        totalMessages: msg.totalMessages,
        totalVoiceMessages: msg.totalVoiceMessages,
        wxDir: msg.wxDir,
        selfWxid: msg.selfWxid,
        logFileName: scanSession.fileName,
        logDir: scanSession.logDir,
      };
    }

    const errorInfo = classifyScanError(new Error(msg.error || '扫描失败'));
    scanSession.append('scan_error', {
      code: errorInfo.code,
      raw: errorInfo.rawMessage,
      message: msg.error || '',
    });
    scanSession.finalize({
      ok: false,
      code: errorInfo.code,
      message: errorInfo.rawMessage,
      cancelled: Boolean(msg.cancelled),
    });

    return {
      ok: false,
      error: errorInfo.userMessage,
      errorInfo,
      feedbackSummary: buildFeedbackSummary(errorInfo, scanSession.fileName),
      cancelled: Boolean(msg.cancelled),
      logFileName: scanSession.fileName,
      logDir: scanSession.logDir,
      preflight,
    };
  } catch (err) {
    if (scanCancelRequested) {
      scanSession.finalize({ ok: false, code: 'WTR-E009', message: '扫描已取消', cancelled: true });
      return {
        ok: false,
        cancelled: true,
        error: '扫描已取消',
        logFileName: scanSession.fileName,
        logDir: scanSession.logDir,
      };
    }

    const errorInfo = classifyScanError(err);
    scanSession.append('scan_error', {
      code: errorInfo.code,
      raw: errorInfo.rawMessage,
      message: err.message,
      stack: err.stack || '',
    });
    scanSession.finalize({
      ok: false,
      code: errorInfo.code,
      message: errorInfo.rawMessage,
    });

    return {
      ok: false,
      error: errorInfo.userMessage,
      errorInfo,
      feedbackSummary: buildFeedbackSummary(errorInfo, scanSession.fileName),
      logFileName: scanSession.fileName,
      logDir: scanSession.logDir,
      preflight,
    };
  } finally {
    scanRunning = false;
    scanWorker = null;
  }
});

ipcMain.handle('cancel-scan', async () => {
  scanCancelRequested = true;
  scanRunning = false;
  const worker = scanWorker;
  if (!worker) {
    return { ok: true, cancelled: true };
  }
  worker.postMessage({ type: 'cancel' });
  await worker.terminate().catch(() => {});
  if (scanWorker === worker) {
    scanWorker = null;
  }
  return { ok: true, cancelled: true };
});

function runExportInWorker(options) {
  return new Promise((resolve, reject) => {
    exportCancelRequested = false;
    let settled = false;
    const worker = new Worker(path.join(__dirname, 'exportWorker.js'), {
      workerData: {
        wxDir: options.wxDir,
        outputDir: options.outputDir,
        selfWxid: options.selfWxid,
        forceDecrypt: options.forceDecrypt,
        loginCapture: options.loginCapture,
        keysPath: options.keysPath,
        formats: options.formats,
        selectedUsernames: options.selectedUsernames,
        voiceTranscription: options.voiceTranscription,
      },
    });
    currentWorker = worker;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      if (currentWorker === worker) {
        currentWorker = null;
      }
      worker.terminate().catch(() => {});
      handler(value);
    };

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        sendProgress(msg.event);
      } else if (msg.type === 'done') {
        finish(resolve, msg);
      }
    });

    worker.on('error', (err) => {
      finish(reject, err);
    });

    worker.on('exit', (code) => {
      if (settled) return;
      if (exportCancelRequested) {
        finish(resolve, { ok: false, cancelled: true, error: '导出已取消' });
        return;
      }
      if (code !== 0) {
        finish(reject, new Error(`导出任务异常退出 (code ${code})`));
      }
    });
  });
}

ipcMain.handle('start-export', async (_event, options) => {
  if (exportRunning) {
    return { ok: false, error: '导出任务正在进行中' };
  }

  exportRunning = true;
  try {
    const msg = await runExportInWorker({
      wxDir: options.wxDir,
      outputDir: options.outputDir,
      selfWxid: options.selfWxid || null,
      forceDecrypt: Boolean(options.forceDecrypt),
      loginCapture: options.loginCapture !== false,
      keysPath: options.keysPath || null,
      formats: options.formats || ['json'],
      selectedUsernames: options.selectedUsernames || null,
      voiceTranscription: Boolean(options.voiceTranscription),
    });
    if (msg.ok) {
      return { ok: true, result: msg.result };
    }
    if (!msg.cancelled) {
      sendProgress({ phase: 'error', message: msg.error });
    }
    return { ok: false, error: msg.error, cancelled: Boolean(msg.cancelled) };
  } catch (err) {
    if (exportCancelRequested) {
      return { ok: false, cancelled: true, error: '导出已取消' };
    }
    sendProgress({ phase: 'error', message: err.message });
    return { ok: false, error: err.message };
  } finally {
    exportRunning = false;
    currentWorker = null;
  }
});

ipcMain.handle('cancel-export', async () => {
  exportCancelRequested = true;
  exportRunning = false;
  const worker = currentWorker;
  if (!worker) {
    return { ok: true, cancelled: true };
  }
  worker.postMessage({ type: 'cancel' });
  await worker.terminate().catch(() => {});
  if (currentWorker === worker) {
    currentWorker = null;
  }
  return { ok: true, cancelled: true };
});

ipcMain.handle('open-path', async (_event, targetPath) => {
  await shell.openPath(targetPath);
});

ipcMain.handle('show-error-dialog', async (_event, { title, message, detail }) => {
  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: title || '操作失败',
    message,
    detail: detail || '',
    buttons: ['知道了'],
  });
});

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.wetrace.exporter');
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
