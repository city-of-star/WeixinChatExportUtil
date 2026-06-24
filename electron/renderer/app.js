const STORAGE_KEY = 'wetrace.settings';

const wxDirInput = document.getElementById('wxDir');
const accountField = document.getElementById('accountField');
const accountList = document.getElementById('accountList');
const accountHint = document.getElementById('accountHint');
const scanToast = document.getElementById('scanToast');
const scanToastTitle = document.getElementById('scanToastTitle');
const scanToastMessage = document.getElementById('scanToastMessage');
const cancelScanBtn = document.getElementById('cancelScanBtn');
const keysPathInput = document.getElementById('keysPath');
const outputDirInput = document.getElementById('outputDir');
const selfWxidInput = document.getElementById('selfWxid');
const wxDirHint = document.getElementById('wxDirHint');
const readinessPanel = document.getElementById('readinessPanel');
const readinessBadge = document.getElementById('readinessBadge');
const readinessHint = document.getElementById('readinessHint');
const readinessSuggestions = document.getElementById('readinessSuggestions');
const detectResults = document.getElementById('detectResults');
const autoDetectBtn = document.getElementById('autoDetectBtn');
const scanBtn = document.getElementById('scanBtn');
const step1Panel = document.getElementById('step1Panel');
const step2Panel = document.getElementById('step2Panel');
const step3Panel = document.getElementById('step3Panel');
const convList = document.getElementById('convList');
const convSummary = document.getElementById('convSummary');
const convSearch = document.getElementById('convSearch');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectNoneBtn = document.getElementById('selectNoneBtn');
const backBtn = document.getElementById('backBtn');
const startBtn = document.getElementById('startBtn');
const cancelBtn = document.getElementById('cancelBtn');
const openOutputBtn = document.getElementById('openOutputBtn');
const restartBtn = document.getElementById('restartBtn');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const logEl = document.getElementById('log');
const successSummary = document.getElementById('successSummary');
const appVersion = document.getElementById('appVersion');
const stepEls = [...document.querySelectorAll('.step')];

let lastOutputDir = '';
let scannedAccounts = [];
let conversationItems = [];
let resolvedAccountPath = null;
let selectedAccountPath = null;
let exportRunning = false;
let scanRunning = false;
const accountProfileCache = new Map();
let profileLoadToken = 0;

function cacheAccountProfiles(accounts) {
  for (const account of accounts) {
    accountProfileCache.set(account.path, {
      displayName: account.displayName,
      avatar: account.avatar,
    });
  }
}

function applyProfileCache(accounts) {
  return accounts.map((account) => {
    const cached = accountProfileCache.get(account.path);
    if (!cached) return account;
    return {
      ...account,
      displayName: cached.displayName || account.displayName || account.wxid,
      avatar: cached.avatar || account.avatar,
    };
  });
}

function loadSettingsLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

async function loadSettings() {
  const local = loadSettingsLocal();
  try {
    const saved = await window.exporter.loadSettings();
    if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
      return { ...local, ...saved };
    }
  } catch {
    // fall back to localStorage
  }
  return local;
}

function saveSettings() {
  const settings = {
    wxDir: wxDirInput.value.trim(),
    outputDir: outputDirInput.value.trim(),
    selfWxid: selfWxidInput.value.trim(),
    keysPath: keysPathInput.value.trim(),
    loginCapture: document.getElementById('loginCapture').checked,
    forceDecrypt: document.getElementById('forceDecrypt').checked,
    formats: getSelectedFormats(),
    accountPath: selectedAccountPath,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.exporter.saveSettings(settings).catch(() => {});
}

function applySettingsToForm(settings) {
  if (settings.wxDir) wxDirInput.value = settings.wxDir;
  if (settings.outputDir) outputDirInput.value = settings.outputDir;
  if (settings.selfWxid) selfWxidInput.value = settings.selfWxid;
  if (settings.keysPath) keysPathInput.value = settings.keysPath;
  if (typeof settings.loginCapture === 'boolean') {
    document.getElementById('loginCapture').checked = settings.loginCapture;
  }
  if (typeof settings.forceDecrypt === 'boolean') {
    document.getElementById('forceDecrypt').checked = settings.forceDecrypt;
  }
  if (Array.isArray(settings.formats)) {
    for (const input of document.querySelectorAll('input[name="format"]')) {
      input.checked = settings.formats.includes(input.value);
    }
  }
  if (settings.accountPath) {
    selectedAccountPath = settings.accountPath;
  }
}

function getSelectedFormats() {
  return [...document.querySelectorAll('input[name="format"]:checked')].map((el) => el.value);
}

function setStep(step) {
  step1Panel.classList.toggle('hidden', step !== 1);
  step2Panel.classList.toggle('hidden', step !== 2);
  step3Panel.classList.toggle('hidden', step !== 3);

  stepEls.forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
}

function appendLog(message) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(percent, text) {
  progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressText.textContent = text;
}

function getSelectedAccountPath() {
  return selectedAccountPath;
}

function updateAccountCardSelection() {
  for (const card of accountList.querySelectorAll('.account-card')) {
    card.classList.toggle('selected', card.dataset.path === selectedAccountPath);
  }
}

function getAccountStatusClass(account) {
  if (account.mode === 'decrypted') return 'decrypted';
  if (account.mode === 'encrypted') return 'encrypted';
  return '';
}

function renderAccountOptions(accounts, selectedPath = null) {
  scannedAccounts = applyProfileCache(accounts);
  accountList.innerHTML = '';

  if (!accounts.length) {
    accountField.classList.add('hidden');
    selectedAccountPath = null;
    accountHint.textContent = '';
    return;
  }

  accountField.classList.remove('hidden');

  for (const account of scannedAccounts) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'account-card';
    card.dataset.path = account.path;

    if (account.avatar) {
      const img = document.createElement('img');
      img.className = 'account-avatar';
      img.src = account.avatar;
      img.alt = '';
      card.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'account-avatar placeholder';
      placeholder.textContent = (account.displayName || account.wxid || '?').slice(0, 1).toUpperCase();
      card.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'account-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'account-name';
    nameEl.textContent = account.displayName || account.wxid;
    nameEl.title = nameEl.textContent;

    const wxidEl = document.createElement('div');
    wxidEl.className = 'account-wxid';
    wxidEl.textContent = account.wxid;
    wxidEl.title = account.wxid;

    const statusEl = document.createElement('span');
    statusEl.className = `account-status ${getAccountStatusClass(account)}`;
    statusEl.textContent = account.description || '未知状态';

    info.appendChild(nameEl);
    info.appendChild(wxidEl);
    info.appendChild(statusEl);
    card.appendChild(info);

    card.addEventListener('click', () => selectAccount(account.path));
    accountList.appendChild(card);
  }

  const defaultPath =
    selectedPath || (scannedAccounts.length === 1 ? scannedAccounts[0].path : selectedAccountPath);
  if (defaultPath) {
    selectedAccountPath = defaultPath;
  } else if (!scannedAccounts.some((item) => item.path === selectedAccountPath)) {
    selectedAccountPath = null;
  }

  updateAccountCardSelection();
  accountHint.textContent =
    scannedAccounts.length > 1 && !selectedAccountPath ? '请点击选择要导出的账号' : '';
}

async function loadAccountProfiles(accounts) {
  if (!accounts.length) return;

  const token = ++profileLoadToken;
  const pathsKey = accounts.map((a) => a.path).join('|');

  for (const card of accountList.querySelectorAll('.account-card')) {
    card.classList.add('loading');
  }

  let result;
  try {
    result = await window.exporter.enrichAccounts({ accounts });
  } finally {
    if (token === profileLoadToken) {
      for (const card of accountList.querySelectorAll('.account-card')) {
        card.classList.remove('loading');
      }
    }
  }

  if (token !== profileLoadToken) return;
  if (pathsKey !== accounts.map((a) => a.path).join('|')) return;

  if (result.ok && result.accounts?.length) {
    cacheAccountProfiles(result.accounts);
    renderAccountOptions(result.accounts, selectedAccountPath);
    updateAccountProfileHint(result.accounts);
  }
}

function updateAccountProfileHint(accounts) {
  const selected = accounts.find((item) => item.path === selectedAccountPath) || accounts[0];
  if (!selected) return;

  const hasRealName = selected.displayName && selected.displayName !== selected.wxid;
  const hasAvatar = Boolean(selected.avatar);
  const noDecrypted = selected.mode === 'encrypted' || (selected.hasEncrypted && !selected.hasDecrypted);

  if (noDecrypted && !hasRealName && !hasAvatar) {
    accountHint.textContent = '昵称/头像需解密数据库后显示；扫描会话时会自动解密';
    accountHint.className = 'hint';
  } else if (selected.passphraseCachePath) {
    accountHint.textContent = `密钥已缓存在账号目录下的 .wexin_passphrase`;
    accountHint.className = 'hint ok';
  } else {
    accountHint.textContent = accounts.length > 1 && !selectedAccountPath ? '请点击选择要导出的账号' : '';
    accountHint.className = 'hint';
  }
}

async function selectAccount(accountPath) {
  selectedAccountPath = accountPath;
  resolvedAccountPath = accountPath;
  updateAccountCardSelection();
  saveSettings();
  accountHint.textContent = '';

  const rootDir = wxDirInput.value.trim();
  if (!rootDir) return;

  const account = scannedAccounts.find((item) => item.path === accountPath);
  applySelectedAccount(account);

  const status = await window.exporter.checkWeChatStatus({
    wxDir: rootDir,
    accountPath,
  });
  if (status.ok) {
    renderReadiness(status.readiness);
  } else {
    renderReadiness(null);
  }
}

function applySelectedAccount(account) {
  if (!account) return;
  if (!selfWxidInput.value.trim()) {
    selfWxidInput.placeholder = account.wxid;
  }
}

function renderReadiness(readiness) {
  if (!readiness) {
    readinessPanel.classList.add('hidden');
    return;
  }

  readinessPanel.classList.remove('hidden');
  const levelMap = {
    ready: { text: '可导出', className: 'ready' },
    fallback: { text: '可导出', className: 'fallback' },
    maybe: { text: '建议预热', className: 'maybe' },
    not_ready: { text: '微信未运行', className: 'not-ready' },
  };
  const badge = levelMap[readiness.level] || levelMap.not_ready;
  readinessBadge.textContent = badge.text;
  readinessBadge.className = `readiness-badge ${badge.className}`;
  readinessHint.textContent = readiness.hint || '';

  readinessSuggestions.innerHTML = '';
  for (const tip of readiness.suggestions || []) {
    const li = document.createElement('li');
    li.textContent = tip;
    readinessSuggestions.appendChild(li);
  }
}

async function validateWxDir(dir, accountPath = null) {
  if (!dir) {
    wxDirHint.textContent = '通常位于 Documents 或 D:\\WeChat\\xwechat_files';
    wxDirHint.className = 'hint';
    renderAccountOptions([]);
    renderReadiness(null);
    resolvedAccountPath = null;
    return null;
  }

  const result = await window.exporter.validateWxDir({
    wxDir: dir,
    accountPath: accountPath || undefined,
  });

  if (!result.ok) {
    wxDirHint.textContent = result.error;
    wxDirHint.className = 'hint error';
    renderAccountOptions([]);
    renderReadiness(null);
    resolvedAccountPath = null;
    return null;
  }

  renderAccountOptions(result.accounts || [], result.resolved || accountPath || selectedAccountPath);
  void loadAccountProfiles(result.accounts || []);

  if (result.needsAccountSelection) {
    wxDirHint.textContent = result.hint;
    wxDirHint.className = 'hint';
    renderReadiness(null);
    resolvedAccountPath = null;
    return result;
  }

  resolvedAccountPath = result.resolved;
  selectedAccountPath = result.resolved;
  updateAccountCardSelection();
  wxDirHint.textContent = result.hint || '已识别微信账号';
  wxDirHint.className = 'hint ok';
  applySelectedAccount(result.selectedAccount);
  renderReadiness(result.readiness);
  return result;
}

async function pickDirectory(title, targetInput) {
  const selected = await window.exporter.pickDirectory({
    title,
    defaultPath: targetInput.value || undefined,
  });
  if (selected) {
    targetInput.value = selected;
    saveSettings();
    if (targetInput === wxDirInput) {
      void validateWxDir(selected);
    }
  }
}

function formatCount(n) {
  return n.toLocaleString('zh-CN');
}

function renderConversationList(conversations) {
  conversationItems = conversations;
  convList.innerHTML = '';

  if (!conversations.length) {
    convList.innerHTML = '<div class="conv-item"><div class="conv-name">未找到可导出的会话</div></div>';
    updateConvSummary();
    return;
  }

  for (const conv of conversations) {
    const item = document.createElement('label');
    item.className = 'conv-item';
    item.dataset.name = conv.displayName.toLowerCase();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.username = conv.username;
    checkbox.addEventListener('change', updateConvSummary);

    const main = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'conv-name';
    name.textContent = conv.displayName;

    const tag = document.createElement('span');
    tag.className = `type-tag ${conv.type === 'group' ? 'group' : ''}`;
    tag.textContent = conv.type === 'group' ? '群聊' : '私聊';
    name.appendChild(tag);

    const meta = document.createElement('div');
    meta.className = 'conv-meta';
    meta.textContent = conv.summary || conv.username;

    main.appendChild(name);
    main.appendChild(meta);

    const count = document.createElement('div');
    count.className = 'conv-count';
    count.textContent = `${formatCount(conv.messageCount)} 条`;

    item.appendChild(checkbox);
    item.appendChild(main);
    item.appendChild(count);
    convList.appendChild(item);
  }

  updateConvSummary();
}

function getVisibleConvCheckboxes() {
  return [...convList.querySelectorAll('.conv-item:not(.hidden-by-search) input[type="checkbox"]')];
}

function getSelectedUsernames() {
  return [...convList.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.dataset.username);
}

function updateConvSummary() {
  const selected = getSelectedUsernames();
  const selectedMessages = conversationItems
    .filter((item) => selected.includes(item.username))
    .reduce((sum, item) => sum + item.messageCount, 0);

  convSummary.textContent = `已选 ${selected.length} / ${conversationItems.length} 个会话，约 ${formatCount(selectedMessages)} 条消息`;
  startBtn.disabled = selected.length === 0 || exportRunning;
}

function setConvSelection(checked) {
  for (const checkbox of getVisibleConvCheckboxes()) {
    checkbox.checked = checked;
  }
  updateConvSummary();
}

function filterConversations(keyword) {
  const q = keyword.trim().toLowerCase();
  for (const item of convList.querySelectorAll('.conv-item')) {
    const name = item.dataset.name || '';
    item.classList.toggle('hidden-by-search', q && !name.includes(q));
  }
  updateConvSummary();
}

async function showFriendlyError(title, message, detail) {
  await window.exporter.showErrorDialog({ title, message, detail });
}

function getExportOptions() {
  return {
    wxDir: wxDirInput.value.trim(),
    accountPath: resolvedAccountPath || getSelectedAccountPath(),
    outputDir: outputDirInput.value.trim(),
    selfWxid: selfWxidInput.value.trim() || null,
    forceDecrypt: document.getElementById('forceDecrypt').checked,
    loginCapture: document.getElementById('loginCapture').checked,
    keysPath: keysPathInput.value.trim() || null,
    formats: getSelectedFormats(),
    selectedUsernames: getSelectedUsernames(),
  };
}

function showScanToast(title, message) {
  scanToast.classList.remove('hidden');
  scanToastTitle.textContent = title;
  scanToastMessage.textContent = message;
}

function hideScanToast() {
  scanToast.classList.add('hidden');
}

async function scanConversations() {
  const rootDir = wxDirInput.value.trim();
  const outputDir = outputDirInput.value.trim();
  const formats = getSelectedFormats();

  if (!rootDir || !outputDir) {
    await showFriendlyError('请先完成设置', '请选择微信数据目录和导出保存位置。');
    return;
  }

  if (formats.length === 0) {
    await showFriendlyError('请选择导出格式', '至少勾选一种导出格式（JSON / HTML / TXT / CSV）。');
    return;
  }

  const accountPath = getSelectedAccountPath();
  const validation = await validateWxDir(rootDir, accountPath);
  if (!validation || validation.needsAccountSelection || !accountPath) {
    await showFriendlyError('请选择账号', '请点击头像卡片，选择要导出的微信账号。');
    return;
  }

  resolvedAccountPath = accountPath;
  saveSettings();

  scanRunning = true;
  scanBtn.disabled = true;
  scanBtn.textContent = '扫描中…';
  showScanToast('正在扫描', '后台处理中，界面仍可操作…');

  const result = await window.exporter.scanConversations(getExportOptions());

  scanRunning = false;
  scanBtn.disabled = false;
  scanBtn.textContent = '扫描会话';
  hideScanToast();

  if (result.cancelled) {
    return;
  }

  if (!result.ok) {
    await showFriendlyError(
      '扫描失败',
      result.error,
      '请确认微信已登录，并在微信中打开几个聊天窗口后重试。\n若仍失败，可展开「高级选项」勾选「登录时自动获取解密密钥」，并以管理员身份运行本程序。'
    );
    return;
  }

  renderConversationList(result.conversations || []);
  setStep(2);
  appendLog(`扫描完成：${result.conversationCount} 个会话，${formatCount(result.totalMessages)} 条消息`);

  if (rootDir && resolvedAccountPath) {
    const status = await window.exporter.validateWxDir({
      wxDir: rootDir,
      accountPath: resolvedAccountPath,
    });
    if (status.ok && status.accounts?.length) {
      void loadAccountProfiles(status.accounts);
    }
  }
}

async function startExport() {
  const options = getExportOptions();
  if (!options.selectedUsernames.length) {
    await showFriendlyError('未选择会话', '请至少选择一个要导出的会话。');
    return;
  }

  exportRunning = true;
  startBtn.disabled = true;
  cancelBtn.classList.remove('hidden');
  openOutputBtn.disabled = true;
  logEl.textContent = '';
  setProgress(0, '准备中…');
  appendLog('开始导出…');
  saveSettings();

  const result = await window.exporter.startExport({
    wxDir: resolvedAccountPath,
    outputDir: options.outputDir,
    selfWxid: options.selfWxid,
    forceDecrypt: options.forceDecrypt,
    loginCapture: options.loginCapture,
    keysPath: options.keysPath,
    formats: options.formats,
    selectedUsernames: options.selectedUsernames,
  });

  exportRunning = false;
  cancelBtn.classList.add('hidden');
  startBtn.disabled = false;

  if (result.ok) {
    lastOutputDir = result.result.outputDir;
    openOutputBtn.disabled = false;
    setProgress(100, '导出完成');
    successSummary.textContent = `共导出 ${result.result.conversationCount} 个会话，${formatCount(result.result.totalMessages)} 条消息。\n文件已保存到：${result.result.outputDir}`;
    setStep(3);
  } else if (result.cancelled) {
    setProgress(0, '已取消');
    appendLog('导出已取消');
  } else {
    setProgress(0, '导出失败');
    appendLog(`错误: ${result.error}`);
    await showFriendlyError(
      '导出失败',
      result.error,
      '常见原因：微信未登录、密钥未加载、目录无写入权限。\n建议先打开几个聊天窗口，或以管理员身份运行后重试。'
    );
  }
}

function renderDetectResults(paths) {
  detectResults.innerHTML = '';
  if (!paths.length) {
    detectResults.classList.add('hidden');
    return;
  }

  detectResults.classList.remove('hidden');
  for (const item of paths) {
    const row = document.createElement('div');
    row.className = 'detect-item';
    row.innerHTML = `<div><strong>${item.label}</strong><br><code>${item.path}</code></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn ghost';
    btn.type = 'button';
    btn.textContent = '使用';
    btn.addEventListener('click', async () => {
      wxDirInput.value = item.path;
      saveSettings();
      await validateWxDir(item.path);
    });
    row.appendChild(btn);
    detectResults.appendChild(row);
  }
}

async function initApp() {
  const info = await window.exporter.getAppInfo();
  appVersion.textContent = `v${info.version}`;

  const settings = await loadSettings();
  applySettingsToForm(settings);

  setStep(1);
  setProgress(0, '等待开始');

  if (settings.wxDir) {
    void validateWxDir(settings.wxDir, settings.accountPath || null);
    if (settings.wxDir || settings.outputDir) {
      window.exporter.saveSettings(settings).catch(() => {});
    }
  }
}

document.getElementById('pickKeysPath').addEventListener('click', async () => {
  const selected = await window.exporter.pickFile({
    title: '选择密钥 JSON 文件',
    defaultPath: keysPathInput.value || undefined,
  });
  if (selected) {
    keysPathInput.value = selected;
    saveSettings();
  }
});

document.getElementById('pickWxDir').addEventListener('click', () => {
  pickDirectory('选择 xwechat_files 目录', wxDirInput);
});

document.getElementById('pickOutputDir').addEventListener('click', () => {
  pickDirectory('选择导出目录', outputDirInput);
});

wxDirInput.addEventListener('change', () => {
  saveSettings();
  void validateWxDir(wxDirInput.value.trim());
});

autoDetectBtn.addEventListener('click', async () => {
  autoDetectBtn.disabled = true;
  autoDetectBtn.textContent = '检测中…';
  const result = await window.exporter.detectWxPaths();
  autoDetectBtn.disabled = false;
  autoDetectBtn.textContent = '自动检测微信目录';

  if (!result.ok) {
    await showFriendlyError('检测失败', result.error || '无法扫描常见微信目录');
    return;
  }

  renderDetectResults(result.paths || []);
  if (!result.paths?.length) {
    wxDirHint.textContent = '未在常见位置找到微信数据，请手动浏览选择';
    wxDirHint.className = 'hint';
  }
});

scanBtn.addEventListener('click', scanConversations);
cancelScanBtn.addEventListener('click', async () => {
  await window.exporter.cancelScan();
  scanRunning = false;
  scanBtn.disabled = false;
  scanBtn.textContent = '扫描会话';
  hideScanToast();
});
backBtn.addEventListener('click', () => setStep(1));
startBtn.addEventListener('click', startExport);
cancelBtn.addEventListener('click', async () => {
  await window.exporter.cancelExport();
});
selectAllBtn.addEventListener('click', () => setConvSelection(true));
selectNoneBtn.addEventListener('click', () => setConvSelection(false));
convSearch.addEventListener('input', () => filterConversations(convSearch.value));

openOutputBtn.addEventListener('click', () => {
  if (lastOutputDir) {
    window.exporter.openPath(lastOutputDir);
  }
});

restartBtn.addEventListener('click', () => {
  setStep(1);
  setProgress(0, '等待开始');
  logEl.textContent = '';
});

document.querySelectorAll('input[name="format"]').forEach((input) => {
  input.addEventListener('change', saveSettings);
});

document.getElementById('loginCapture').addEventListener('change', saveSettings);
document.getElementById('forceDecrypt').addEventListener('change', saveSettings);
selfWxidInput.addEventListener('change', saveSettings);

window.exporter.onProgress((event) => {
  if (event.phase === 'scan') {
    if (scanRunning) {
      showScanToast('正在扫描', event.message || '后台处理中…');
    }
  } else if (event.phase === 'init' || event.phase === 'decrypt' || event.phase === 'keys') {
    if (scanRunning) {
      showScanToast(event.phase === 'decrypt' ? '正在解密' : '正在扫描', event.message || '请稍候…');
    }
    appendLog(event.message);
    if (event.phase === 'decrypt' && event.current && event.total) {
      const percent = Math.round((event.current / event.total) * 25);
      setProgress(percent, event.message);
    } else if (event.phase === 'keys' || event.phase === 'decrypt') {
      setProgress(8, event.message);
    }
  } else if (event.phase === 'exporting') {
    const percent = event.totalCandidates
      ? 25 + Math.round((event.scanned / event.totalCandidates) * 75)
      : 25;
    setProgress(
      percent,
      `正在导出 ${event.displayName}（${event.current}/${event.totalCandidates}）`
    );
    if (event.current % 5 === 0) {
      appendLog(`已导出 ${event.current} 个会话，累计 ${formatCount(event.totalMessages)} 条消息`);
    }
  } else if (event.phase === 'done') {
    setProgress(100, `完成：${event.conversationCount} 个会话，${formatCount(event.totalMessages)} 条消息`);
  } else if (event.phase === 'error') {
    appendLog(`错误: ${event.message}`);
  }
});

initApp();
