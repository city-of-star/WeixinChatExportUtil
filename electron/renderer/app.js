const STORAGE_KEY = 'wetrace.settings';

const wxDirInput = document.getElementById('wxDir');
const accountField = document.getElementById('accountField');
const accountList = document.getElementById('accountList');
const accountHint = document.getElementById('accountHint');
const multiAccountTip = document.getElementById('multiAccountTip');
const scanToast = document.getElementById('scanToast');
const scanToastTitle = document.getElementById('scanToastTitle');
const scanToastMessage = document.getElementById('scanToastMessage');
const cancelScanBtn = document.getElementById('cancelScanBtn');
const scanToastElapsed = document.getElementById('scanToastElapsed');
const scanToastNote = document.getElementById('scanToastNote');
const cacheSection = document.getElementById('cacheSection');
const cacheList = document.getElementById('cacheList');
const outputDirInput = document.getElementById('outputDir');
const wxDirHint = document.getElementById('wxDirHint');
const readinessPanel = document.getElementById('readinessPanel');
const readinessBadge = document.getElementById('readinessBadge');
const readinessHint = document.getElementById('readinessHint');
const readinessSuggestions = document.getElementById('readinessSuggestions');
const preflightModal = document.getElementById('preflightModal');
const preflightModalTitle = document.getElementById('preflightModalTitle');
const preflightModalLoading = document.getElementById('preflightModalLoading');
const preflightModalList = document.getElementById('preflightModalList');
const preflightModalPrimaryBtn = document.getElementById('preflightModalPrimaryBtn');
const preflightModalCancelBtn = document.getElementById('preflightModalCancelBtn');
const autoDetectBtn = document.getElementById('autoDetectBtn');
const refreshAccountsBtn = document.getElementById('refreshAccountsBtn');
const resetDecryptBtn = document.getElementById('resetDecryptBtn');
const resetAllToolTracesBtn = document.getElementById('resetAllToolTracesBtn');
const scanBtn = document.getElementById('scanBtn');
const step1Panel = document.getElementById('step1Panel');
const step2Panel = document.getElementById('step2Panel');
const step3Panel = document.getElementById('step3Panel');
const step4Panel = document.getElementById('step4Panel');
const step5Panel = document.getElementById('step5Panel');
const disclaimerAccepted = document.getElementById('disclaimerAccepted');
const welcomeNextBtn = document.getElementById('welcomeNextBtn');
const accountBackBtn = document.getElementById('accountBackBtn');
const exportBackBtn = document.getElementById('exportBackBtn');
const toExportBtn = document.getElementById('toExportBtn');
const openIndexBtn = document.getElementById('openIndexBtn');
const outputGuide = document.getElementById('outputGuide');
const convList = document.getElementById('convList');
const convSummary = document.getElementById('convSummary');
const exportSummary = document.getElementById('exportSummary');
const exportEstimateLine = document.getElementById('exportEstimateLine');
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
const voiceTranscriptionBlock = document.getElementById('voiceTranscriptionBlock');
const voiceTranscriptionInput = document.getElementById('voiceTranscription');
const voiceTimeHint = document.getElementById('voiceTimeHint');

let whisperModelBundled = false;
const appVersion = document.getElementById('appVersion');
const stepEls = [...document.querySelectorAll('.step')];
const appNotice = document.getElementById('appNotice');
const appNoticeIcon = document.getElementById('appNoticeIcon');
const appNoticeTitle = document.getElementById('appNoticeTitle');
const appNoticeMessage = document.getElementById('appNoticeMessage');
const appNoticeDetail = document.getElementById('appNoticeDetail');
const appNoticeBtn = document.getElementById('appNoticeBtn');
const appNoticeCancelBtn = document.getElementById('appNoticeCancelBtn');

let currentStep = 1;
let noticeResolve = null;
let noticeMode = 'alert';
let lastOutputDir = '';
let lastHtmlIndexPath = '';
let scannedAccounts = [];
let conversationItems = [];
let resolvedAccountPath = null;
let selectedAccountPath = null;
let exportRunning = false;
let scanRunning = false;
let userCancelledScan = false;
let scanElapsedTimer = null;
let scanStartedAt = 0;
let currentConversationCache = null;
let outputDirNonEmptyAcknowledged = null;
let conversationCacheEntries = [];
const accountProfileCache = new Map();
let profileLoadToken = 0;
let estimateRequestId = 0;
let exportStartedAt = 0;
let exportTaskTotal = 0;
let exportTaskExported = 0;
let exportTaskVoiceEnabled = false;
let exportTaskVoiceTotal = 0;
let exportTaskVoiceDone = 0;
let exportTaskMessageTotal = 0;
let exportTaskMessageDone = 0;
let exportTaskMessagePartial = 0;
let exportPrepRatio = 0;
let exportDisplayPercent = 0;
let exportEtaSmoothSec = null;
let exportEtaDisplayed = null;
let exportEtaLastUpdate = 0;
let exportLastEtaPercent = 0;

const EXPORT_PREP_MAX = 10;
const EXPORT_WORK_SPAN = 88;
const EXPORT_ETA_MIN_ELAPSED_SEC = 15;
const EXPORT_ETA_UPDATE_MS = 5000;

function isRealDisplayName(displayName, wxid) {
  return Boolean(displayName && displayName !== wxid);
}

function mergeAccountProfile(account, cached) {
  if (!cached) return account;

  const wxid = account.wxid;
  const cachedName = isRealDisplayName(cached.displayName, wxid) ? cached.displayName : null;
  const accountName = isRealDisplayName(account.displayName, wxid) ? account.displayName : null;

  return {
    ...account,
    displayName: accountName || cachedName || account.displayName || cached.displayName || wxid,
    avatar: account.avatar || cached.avatar || null,
  };
}

function cacheAccountProfiles(accounts) {
  for (const account of accounts) {
    const prev = accountProfileCache.get(account.path);
    const wxid = account.wxid;
    const nextName = isRealDisplayName(account.displayName, wxid)
      ? account.displayName
      : isRealDisplayName(prev?.displayName, wxid)
        ? prev.displayName
        : account.displayName;
    const nextAvatar = account.avatar || prev?.avatar || null;

    if (!isRealDisplayName(nextName, wxid) && !nextAvatar && prev) {
      continue;
    }

    accountProfileCache.set(account.path, {
      displayName: nextName,
      avatar: nextAvatar,
    });
  }
}

function applyProfileCache(accounts) {
  return accounts.map((account) => mergeAccountProfile(account, accountProfileCache.get(account.path)));
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
    formats: getSelectedFormats(),
    voiceTranscription: whisperModelBundled && Boolean(voiceTranscriptionInput?.checked),
    accountPath: selectedAccountPath,
    disclaimerAccepted: disclaimerAccepted.checked,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.exporter.saveSettings(settings).catch(() => {});
}

function applySettingsToForm(settings) {
  if (settings.wxDir) wxDirInput.value = settings.wxDir;
  if (settings.outputDir) outputDirInput.value = settings.outputDir;
  if (Array.isArray(settings.formats)) {
    for (const input of document.querySelectorAll('input[name="format"]')) {
      input.checked = settings.formats.includes(input.value);
    }
  }
  if (voiceTranscriptionInput && whisperModelBundled) {
    voiceTranscriptionInput.checked = Boolean(settings.voiceTranscription);
  }
  if (settings.accountPath) {
    selectedAccountPath = settings.accountPath;
  }
  if (typeof settings.disclaimerAccepted === 'boolean') {
    disclaimerAccepted.checked = settings.disclaimerAccepted;
    welcomeNextBtn.disabled = !settings.disclaimerAccepted;
  }
}

function getSelectedFormats() {
  return [...document.querySelectorAll('input[name="format"]:checked')].map((el) => el.value);
}

function updateVoiceTranscriptionUI() {
  if (voiceTranscriptionBlock) {
    voiceTranscriptionBlock.classList.toggle('hidden', !whisperModelBundled);
  }
  const progressStepNum = document.getElementById('step4BlockProgressNum');
  if (progressStepNum) {
    progressStepNum.textContent = whisperModelBundled ? '5' : '4';
  }
  if (!whisperModelBundled && voiceTranscriptionInput) {
    voiceTranscriptionInput.checked = false;
  }
}

function isVoiceTranscriptionEnabled() {
  return whisperModelBundled && Boolean(voiceTranscriptionInput?.checked);
}

function getStepBlockedReason(step) {
  if (scanRunning) {
    return '正在扫描会话，请稍候完成后再切换步骤。';
  }
  if (exportRunning) {
    return '正在导出，请稍候完成或取消后再切换步骤。';
  }
  if (step === 2 && !disclaimerAccepted.checked) {
    return '请先勾选页面下方的免责声明，再点击「开始导出」按钮。';
  }
  if (step === 3 && !conversationItems.length) {
    return '请先选择微信账号并点击「扫描会话」，或加载历史扫描结果。';
  }
  if (step === 4 && !conversationItems.length) {
    return '请先完成会话扫描。';
  }
  if (step === 4 && !getSelectedUsernames().length) {
    return '请至少勾选一个要导出的会话，再点击「下一步」。';
  }
  if (step === 5 && !lastOutputDir) {
    return '请先完成导出，才能查看完成页。';
  }
  return null;
}

function canNavigateToStep(step) {
  if (step === currentStep || step < 1 || step > 5) {
    return false;
  }
  if (scanRunning || exportRunning) {
    return false;
  }
  if (step < currentStep) {
    return true;
  }
  return !getStepBlockedReason(step);
}

function updateStepNavUI() {
  if (refreshAccountsBtn) {
    refreshAccountsBtn.disabled = scanRunning;
  }
  stepEls.forEach((el) => {
    const n = Number(el.dataset.step);
    const clickable = canNavigateToStep(n);
    el.classList.toggle('clickable', clickable);
    el.classList.toggle('locked', !clickable && n !== currentStep);
    el.setAttribute('aria-current', n === currentStep ? 'step' : 'false');
    el.setAttribute('aria-disabled', clickable || n === currentStep ? 'false' : 'true');
    el.title = clickable
      ? `前往：${el.textContent.trim()}`
      : n === currentStep
        ? '当前步骤'
        : getStepBlockedReason(n) || '请先完成前面的步骤';
  });

  welcomeNextBtn.classList.toggle('cta-pulse', currentStep === 1 && disclaimerAccepted.checked);
}

function setStep(step) {
  const wasStep = currentStep;
  currentStep = step;
  step1Panel.classList.toggle('hidden', step !== 1);
  step2Panel.classList.toggle('hidden', step !== 2);
  step3Panel.classList.toggle('hidden', step !== 3);
  step4Panel.classList.toggle('hidden', step !== 4);
  step5Panel.classList.toggle('hidden', step !== 5);

  stepEls.forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
  if (step === 2 && wasStep > 2) {
    void refreshWxAccountList({ silent: true });
  }
  if (step === 4) {
    void refreshSelectionSummary();
  }
  updateStepNavUI();
}

async function navigateToStep(step) {
  if (step === currentStep) {
    return;
  }
  if (!canNavigateToStep(step)) {
    const reason = getStepBlockedReason(step);
    if (reason) {
      await showFriendlyError('还差一步', reason, null, 'guide');
    }
    return;
  }
  if (step === 2) {
    void refreshConversationCacheHint();
  }
  setStep(step);
}

function appendLog(message) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(percent, text) {
  progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressText.textContent = text;
  progressText.classList.remove('running', 'done');
  if (percent >= 100) {
    progressText.classList.add('done');
  } else if (percent > 0 || exportRunning) {
    progressText.classList.add('running');
  }
}

function formatRemaining(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 45) {
    return '即将完成';
  }
  const mins = Math.ceil(seconds / 60);
  if (mins <= 1) {
    return '约 1 分钟';
  }
  if (mins < 60) {
    return `约还需 ${mins} 分钟`;
  }
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (restMins === 0) {
    return `约还需 ${hours} 小时`;
  }
  return `约还需 ${hours} 小时 ${restMins} 分钟`;
}

function getSelectionStats() {
  const selected = getSelectedUsernames();
  const items = conversationItems.filter((item) => selected.includes(item.username));
  return {
    conversationCount: items.length,
    messageCount: items.reduce((sum, item) => sum + item.messageCount, 0),
    voiceCount: items.reduce((sum, item) => sum + (item.voiceCount || 0), 0),
  };
}

function buildSelectionLine(stats) {
  if (!stats.conversationCount) {
    return '';
  }
  const voicePart = stats.voiceCount > 0 ? `，${formatCount(stats.voiceCount)} 条语音` : '';
  return `已选 ${stats.conversationCount} / ${conversationItems.length} 个会话，约 ${formatCount(stats.messageCount)} 条消息${voicePart}`;
}

function formatConvCountLabel(conv) {
  const messagePart = `${formatCount(conv.messageCount)} 条`;
  if (!conv.voiceCount) {
    return messagePart;
  }
  return `${messagePart} · ${formatCount(conv.voiceCount)} 语音`;
}

function formatScanStatsSummary(result) {
  const voiceTotal =
    result.totalVoiceMessages ??
    (result.conversations || []).reduce((sum, item) => sum + (item.voiceCount || 0), 0);
  const voicePart = voiceTotal > 0 ? `，${formatCount(voiceTotal)} 条语音` : '';
  return `${result.conversationCount} 个会话，${formatCount(result.totalMessages)} 条消息${voicePart}`;
}

function formatEstimateSnippet(estimate, { withVoiceTag = false } = {}) {
  if (!estimate?.rangeText) {
    return '';
  }
  const level = estimate.perfLevel ? `（本机 Lv.${estimate.perfLevel}）` : '';
  const voiceTag = withVoiceTag ? ' · 含语音转写' : '';
  return `预计导出耗时 ${estimate.rangeText}${level}${voiceTag}`;
}

function pulseSummaryLine() {
  if (currentStep !== 4 || !exportEstimateLine) {
    return;
  }
  exportEstimateLine.classList.add('summary-highlight');
  window.setTimeout(() => exportEstimateLine.classList.remove('summary-highlight'), 700);
}

function renderVoiceTimeHint({ voiceOn, voiceEstimate, stats }) {
  if (!voiceTimeHint) {
    return;
  }
  voiceTimeHint.textContent = '';
  if (!whisperModelBundled || currentStep !== 4 || voiceOn || !stats.voiceCount || !voiceEstimate?.rangeText) {
    return;
  }
  voiceTimeHint.textContent = `→ ${voiceEstimate.rangeText}`;
}

function applySelectionSummary({ baseEstimate, voiceEstimate, voiceOn, stats }) {
  const selectionLine = buildSelectionLine(stats);
  const step4Estimate = voiceOn && voiceEstimate ? voiceEstimate : baseEstimate;
  const estimateSnippet = formatEstimateSnippet(step4Estimate, {
    withVoiceTag: voiceOn && stats.voiceCount > 0,
  });

  if (convSummary && currentStep === 3) {
    convSummary.textContent = selectionLine || '—';
  }
  if (exportSummary && currentStep === 4) {
    exportSummary.textContent = selectionLine || '确认保存位置与格式，然后开始导出。';
  }
  if (exportEstimateLine && currentStep === 4) {
    exportEstimateLine.textContent = estimateSnippet;
    exportEstimateLine.classList.toggle('hidden', !estimateSnippet);
  }
  renderVoiceTimeHint({ voiceOn, voiceEstimate, stats });
}

async function refreshSelectionSummary({ voiceTranscription = null, highlight = false } = {}) {
  const stats = getSelectionStats();
  const requestId = ++estimateRequestId;

  if (!stats.conversationCount || !stats.messageCount) {
    if (convSummary) convSummary.textContent = '—';
    if (exportSummary) exportSummary.textContent = '确认保存位置与格式，然后开始导出。';
    if (exportEstimateLine) {
      exportEstimateLine.textContent = '';
      exportEstimateLine.classList.add('hidden');
    }
    if (voiceTimeHint) voiceTimeHint.textContent = '';
    return null;
  }

  if (currentStep === 3) {
    if (convSummary) convSummary.textContent = buildSelectionLine(stats);
    if (exportEstimateLine) {
      exportEstimateLine.textContent = '';
      exportEstimateLine.classList.add('hidden');
    }
    if (voiceTimeHint) voiceTimeHint.textContent = '';
    return null;
  }

  const formatCount = Math.max(1, getSelectedFormats().length);
  const voiceOn =
    voiceTranscription === null ? isVoiceTranscriptionEnabled() : Boolean(voiceTranscription);
  const showVoiceOn = currentStep === 4 && voiceOn;

  try {
    const estimateParams = { ...stats, formatCount };
    const [baseEstimate, voiceEstimate] = await Promise.all([
      window.exporter.estimateExport({ ...estimateParams, voiceTranscription: false }),
      whisperModelBundled && stats.voiceCount > 0
        ? window.exporter.estimateExport({ ...estimateParams, voiceTranscription: true })
        : Promise.resolve(null),
    ]);

    if (requestId !== estimateRequestId) {
      return null;
    }

    applySelectionSummary({
      baseEstimate,
      voiceEstimate,
      voiceOn: showVoiceOn,
      stats,
    });

    if (highlight) {
      pulseSummaryLine();
    }

    return showVoiceOn && voiceEstimate ? voiceEstimate : baseEstimate;
  } catch {
    const fallback = buildSelectionLine(stats);
    if (convSummary && currentStep === 3) convSummary.textContent = fallback || '—';
    if (exportSummary && currentStep === 4) {
      exportSummary.textContent = fallback || '确认保存位置与格式，然后开始导出。';
    }
    if (exportEstimateLine) {
      exportEstimateLine.textContent = '';
      exportEstimateLine.classList.add('hidden');
    }
    if (voiceTimeHint) voiceTimeHint.textContent = '';
    return null;
  }
}

function resetExportTaskProgress() {
  exportTaskTotal = 0;
  exportTaskExported = 0;
  exportTaskVoiceEnabled = false;
  exportTaskVoiceTotal = 0;
  exportTaskVoiceDone = 0;
  exportTaskMessageTotal = 0;
  exportTaskMessageDone = 0;
  exportTaskMessagePartial = 0;
  exportPrepRatio = 0;
  exportDisplayPercent = 0;
  exportEtaSmoothSec = null;
  exportEtaDisplayed = null;
  exportEtaLastUpdate = 0;
  exportLastEtaPercent = 0;
}

function initExportTaskProgress(options, stats) {
  exportTaskTotal = Math.max(1, options.selectedUsernames?.length || 0);
  exportTaskExported = 0;
  exportTaskVoiceEnabled = Boolean(options.voiceTranscription);
  exportTaskVoiceTotal = exportTaskVoiceEnabled ? Math.max(0, stats.voiceCount || 0) : 0;
  exportTaskVoiceDone = 0;
  exportTaskMessageTotal = Math.max(1, stats.messageCount || 0);
  exportTaskMessageDone = 0;
  exportTaskMessagePartial = 0;
  exportPrepRatio = 0;
  exportDisplayPercent = 0;
  exportEtaSmoothSec = null;
  exportEtaDisplayed = null;
  exportEtaLastUpdate = 0;
  exportLastEtaPercent = 0;
}

function updateExportTaskFromEvent(event) {
  const phase = event?.phase || '';

  if (phase === 'init') {
    exportPrepRatio = Math.max(exportPrepRatio, 0.03);
    return;
  }
  if (phase === 'keys') {
    exportPrepRatio = Math.max(exportPrepRatio, 0.06);
    return;
  }
  if (phase === 'decrypt') {
    if (event.current && event.total) {
      exportPrepRatio = event.current / event.total;
    } else {
      exportPrepRatio = Math.max(exportPrepRatio, 0.08);
    }
    return;
  }
  if (phase === 'voice-transcription' || phase === 'exporting' || phase === 'done') {
    exportPrepRatio = 1;
  }
  if (phase === 'exporting') {
    exportTaskTotal = event.totalCandidates || exportTaskTotal;
    if (event.subphase === 'reading' && event.chatMessagesTotal) {
      exportTaskMessagePartial = event.chatMessagesDone || 0;
    } else if (event.subphase === 'start') {
      exportTaskMessagePartial = 0;
    } else if (!event.subphase || event.subphase === 'writing') {
      exportTaskExported = event.current || exportTaskExported;
      exportTaskMessageDone = event.totalMessages ?? exportTaskMessageDone;
      exportTaskMessagePartial = 0;
    }
    return;
  }
  if (phase === 'voice-transcription') {
    if (event.subphase === 'transcribing' && event.total) {
      exportTaskVoiceDone = event.current || 0;
      exportTaskVoiceTotal = Math.max(exportTaskVoiceTotal, event.total);
    } else if (event.subphase === 'done') {
      exportTaskVoiceDone = exportTaskVoiceTotal;
    }
    return;
  }
  if (phase === 'done') {
    exportTaskExported = event.conversationCount || exportTaskExported;
  }
}

function getMessageWorkRatio() {
  if (exportTaskMessageTotal <= 0) {
    return exportTaskTotal > 0 ? exportTaskExported / exportTaskTotal : 0;
  }
  const done = exportTaskMessageDone + exportTaskMessagePartial;
  return Math.min(1, done / exportTaskMessageTotal);
}

function computeExportWorkRatio() {
  const messageRatio = getMessageWorkRatio();
  const convRatio = exportTaskTotal > 0 ? exportTaskExported / exportTaskTotal : 0;
  if (exportTaskVoiceEnabled && exportTaskVoiceTotal > 0) {
    const voiceRatio = exportTaskVoiceDone / exportTaskVoiceTotal;
    return messageRatio * 0.08 + voiceRatio * 0.88 + convRatio * 0.04;
  }
  return messageRatio;
}

function computeRawExportPercent() {
  const workRatio = computeExportWorkRatio();
  const prepPart =
    workRatio > 0 || exportPrepRatio >= 1
      ? EXPORT_PREP_MAX
      : exportPrepRatio * EXPORT_PREP_MAX;
  const workPart = workRatio * EXPORT_WORK_SPAN;
  return Math.min(98, prepPart + workPart);
}

function bumpExportDisplayPercent(rawPercent) {
  exportDisplayPercent = Math.max(exportDisplayPercent, rawPercent);
  return exportDisplayPercent;
}

function buildExportProgressText(event) {
  const phase = event?.phase || '';
  const pct = Math.round(exportDisplayPercent);

  if (phase === 'init' || phase === 'keys') {
    return `总进度 ${pct}% · ${event.message || '准备中…'}`;
  }
  if (phase === 'decrypt') {
    if (event.current && event.total) {
      return `总进度 ${pct}% · 解密数据（${event.current}/${event.total}）`;
    }
    return `总进度 ${pct}% · ${event.message || '正在解密…'}`;
  }
  if (phase === 'voice-transcription') {
    if (event.subphase === 'model-load') {
      return `总进度 ${pct}% · 正在加载语音识别模型…`;
    }
    if (event.subphase === 'transcribing' && event.total) {
      const detail =
        exportTaskTotal > 0
          ? `会话 ${exportTaskExported}/${exportTaskTotal} · 语音 ${event.current}/${event.total}`
          : `语音 ${event.current}/${event.total}`;
      return `总进度 ${pct}% · ${detail}`;
    }
    return `总进度 ${pct}% · ${event.message || '语音转写…'}`;
  }
  if (phase === 'exporting') {
    if (event.subphase === 'reading' && event.chatMessagesTotal) {
      return `总进度 ${pct}% · 正在读取 ${event.displayName}（${formatCount(event.chatMessagesDone)}/${formatCount(event.chatMessagesTotal)} 条）`;
    }
    if (event.subphase === 'start') {
      return `总进度 ${pct}% · 正在处理 ${event.displayName}（${event.scanned}/${event.totalCandidates}）`;
    }
    return `总进度 ${pct}% · 已处理 ${formatCount(exportTaskMessageDone)} 条 · ${event.displayName || ''}`;
  }
  if (phase === 'done') {
    return `总进度 100% · 完成 ${event.conversationCount} 个会话，${formatCount(event.totalMessages)} 条消息`;
  }
  return `总进度 ${pct}%`;
}

function computeExportTotalProgress(event) {
  updateExportTaskFromEvent(event);
  const phase = event?.phase || '';

  if (phase === 'done') {
    exportDisplayPercent = 100;
    return {
      percent: 100,
      text: buildExportProgressText(event),
    };
  }

  const percent = bumpExportDisplayPercent(computeRawExportPercent());
  return {
    percent,
    text: buildExportProgressText(event),
  };
}

function getDynamicEtaSuffix() {
  if (!exportRunning || !exportStartedAt) {
    return null;
  }

  const elapsedSec = (Date.now() - exportStartedAt) / 1000;
  if (elapsedSec < EXPORT_ETA_MIN_ELAPSED_SEC || exportDisplayPercent < 5) {
    return null;
  }

  const ratio = exportDisplayPercent / 100;
  if (ratio < 0.05 || ratio >= 0.99) {
    return null;
  }

  if (exportDisplayPercent <= exportLastEtaPercent) {
    return exportEtaDisplayed;
  }

  const rawRemaining = (elapsedSec / ratio) * (1 - ratio);
  if (!Number.isFinite(rawRemaining) || rawRemaining <= 0) {
    return exportEtaDisplayed;
  }

  exportLastEtaPercent = exportDisplayPercent;

  if (exportEtaSmoothSec === null) {
    exportEtaSmoothSec = rawRemaining;
  } else {
    const blended = exportEtaSmoothSec * 0.75 + rawRemaining * 0.25;
    exportEtaSmoothSec = Math.max(exportEtaSmoothSec * 0.92, blended);
  }

  const now = Date.now();
  if (exportEtaDisplayed && now - exportEtaLastUpdate < EXPORT_ETA_UPDATE_MS) {
    return exportEtaDisplayed;
  }

  exportEtaLastUpdate = now;
  exportEtaDisplayed = formatRemaining(exportEtaSmoothSec);
  return exportEtaDisplayed;
}

function setProgressWithEta(percent, text) {
  const eta = getDynamicEtaSuffix();
  setProgress(percent, eta ? `${text} · ${eta}` : text);
}

function getSelectedAccountPath() {
  return selectedAccountPath;
}

function updateAccountCardSelection() {
  for (const card of accountList.querySelectorAll('.account-card')) {
    card.classList.toggle('selected', card.dataset.path === selectedAccountPath);
  }
}

function formatRelativeActivityTime(ms) {
  if (!ms) {
    return '暂无数据活动记录';
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return '暂无数据活动记录';
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) {
    return '刚刚有数据活动';
  }
  if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)} 分钟前有数据活动`;
  }
  if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)} 小时前有数据活动`;
  }
  if (diffSec < 86400 * 30) {
    return `${Math.floor(diffSec / 86400)} 天前有数据活动`;
  }

  const label = date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  return `${label} 有数据活动`;
}

function updateMultiAccountTip(accounts) {
  if (!multiAccountTip) return;
  const show = accounts.length > 1;
  multiAccountTip.classList.toggle('hidden', !show);
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
    updateMultiAccountTip([]);
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

    const header = document.createElement('div');
    header.className = 'account-header';

    const nameEl = document.createElement('div');
    nameEl.className = 'account-name';
    nameEl.textContent = account.displayName || account.wxid;
    nameEl.title = nameEl.textContent;

    const statusEl = document.createElement('span');
    statusEl.className = `account-status ${getAccountStatusClass(account)}`;
    statusEl.textContent = account.description || '未知状态';

    header.appendChild(nameEl);
    header.appendChild(statusEl);

    const meta = document.createElement('div');
    meta.className = 'account-meta';

    if (isRealDisplayName(account.displayName, account.wxid)) {
      const wxidEl = document.createElement('div');
      wxidEl.className = 'account-wxid';
      wxidEl.textContent = account.wxid;
      wxidEl.title = account.wxid;
      meta.appendChild(wxidEl);
    }

    const activityEl = document.createElement('div');
    activityEl.className = 'account-activity';
    activityEl.textContent = formatRelativeActivityTime(account.lastActivityAt);
    activityEl.title = account.lastActivityAtIso || activityEl.textContent;
    meta.appendChild(activityEl);

    info.appendChild(header);
    info.appendChild(meta);
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
  updateMultiAccountTip(scannedAccounts);
  accountHint.textContent =
    scannedAccounts.length > 1 && !selectedAccountPath ? '请选择要导出的账号' : '';
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
    for (const account of result.accounts) {
      if (isRealDisplayName(account.displayName, account.wxid)) {
        window.exporter.patchConversationCacheLabel({
          accountPath: account.path,
          displayName: account.displayName,
        }).catch(() => {});
      }
    }
    void refreshConversationCacheHint();
  }
}

function updateAccountProfileHint(accounts) {
  if (accounts.length > 1 && !selectedAccountPath) {
    accountHint.textContent = '请选择要导出的账号';
    accountHint.className = 'hint';
  } else {
    accountHint.textContent = '';
    accountHint.className = 'hint';
  }
}

function selectAccount(accountPath) {
  selectedAccountPath = accountPath;
  resolvedAccountPath = accountPath;
  updateAccountCardSelection();
  saveSettings();
  accountHint.textContent = '';
  renderReadiness(null);
  void refreshConversationCacheHint();
}

function renderReadiness(readiness) {
  if (!readiness || readiness.level === 'ready') {
    readinessPanel.classList.add('hidden');
    return;
  }

  readinessPanel.classList.remove('hidden');
  const levelMap = {
    ready: { text: '微信已登录', className: 'ready' },
    fallback: { text: '未登录此账号', className: 'fallback' },
    offline: { text: '可离线扫描', className: 'fallback' },
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
  readinessSuggestions.style.display = readinessSuggestions.children.length ? '' : 'none';
}

async function validateWxDir(dir, accountPath = null) {
  if (!dir) {
    wxDirHint.textContent = '通常位于 Documents 或 D:\\WeChat\\xwechat_files';
    wxDirHint.className = 'hint';
    renderAccountOptions([]);
    renderReadiness(null);
    resolvedAccountPath = null;
    void refreshConversationCacheHint();
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
    void refreshConversationCacheHint();
    return null;
  }

  renderAccountOptions(result.accounts || [], result.resolved || accountPath || selectedAccountPath);
  void loadAccountProfiles(result.accounts || []);

  if (result.needsAccountSelection) {
    wxDirHint.textContent = '';
    wxDirHint.className = 'hint';
    renderReadiness(null);
    resolvedAccountPath = null;
    void refreshConversationCacheHint();
    return result;
  }

  resolvedAccountPath = result.resolved;
  selectedAccountPath = result.resolved;
  updateAccountCardSelection();
  wxDirHint.textContent = '';
  wxDirHint.className = 'hint';
  renderReadiness(null);
  void refreshConversationCacheHint();
  return result;
}

async function refreshWxAccountList({ silent = false } = {}) {
  const rootDir = wxDirInput.value.trim();
  if (!rootDir) {
    if (!silent) {
      wxDirHint.textContent = '请先选择微信数据目录';
      wxDirHint.className = 'hint error';
    }
    return;
  }
  if (scanRunning) {
    return;
  }

  const accountPath = getSelectedAccountPath();

  if (!silent) {
    refreshAccountsBtn.disabled = true;
    refreshAccountsBtn.textContent = '刷新中…';
  }

  try {
    await validateWxDir(rootDir, accountPath);
  } finally {
    if (!silent) {
      refreshAccountsBtn.disabled = scanRunning;
      refreshAccountsBtn.textContent = '刷新';
    }
  }
}

function resetOutputDirNonEmptyAck() {
  outputDirNonEmptyAcknowledged = null;
}

const OUTPUT_DIR_NON_EMPTY_NOTICE = {
  title: '文件夹不为空',
  message: '所选导出目录已有文件，导出时可能会覆盖同名文件。',
  detail: '建议选择空文件夹，以免意外覆盖已有内容。',
};

async function confirmOutputDirIfNotEmpty(dirPath) {
  if (!dirPath) return true;
  if (outputDirNonEmptyAcknowledged === dirPath) return true;

  const check = await window.exporter.isDirectoryEmpty(dirPath);
  if (!check.ok || check.empty) return true;

  const proceed = await showConfirmDialog({
    ...OUTPUT_DIR_NON_EMPTY_NOTICE,
    tone: 'warn',
    confirmLabel: '继续导出',
    cancelLabel: '取消',
    preferCancel: true,
  });
  if (proceed) {
    outputDirNonEmptyAcknowledged = dirPath;
  }
  return proceed;
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
    } else if (targetInput === outputDirInput) {
      resetOutputDirNonEmptyAck();
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
    count.textContent = formatConvCountLabel(conv);

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

  const summaryText = buildSelectionLine({
    conversationCount: selected.length,
    messageCount: selectedMessages,
  });
  convSummary.textContent = summaryText || '—';
  if (exportSummary) {
    exportSummary.textContent = summaryText || '确认保存位置与格式，然后开始导出。';
  }
  void refreshSelectionSummary();
  toExportBtn.disabled = selected.length === 0;
  startBtn.disabled = exportRunning;
  updateStepNavUI();
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

function inferNoticeTone(title, message) {
  const text = `${title} ${message || ''}`;
  if (/失败|错误|无法删除|无法扫描|导出失败|扫描失败|检测失败|删除失败/.test(text)) {
    return 'error';
  }
  if (/请先|请选择|未选择|未找到|还差|暂时|建议|确认/.test(text)) {
    return 'guide';
  }
  return 'warn';
}

const NOTICE_ICON = {
  guide: 'i',
  warn: '!',
  error: '!',
};

function finishAppNotice(result) {
  appNotice.classList.add('hidden');
  appNoticeCancelBtn.classList.add('hidden');
  appNoticeCancelBtn.classList.remove('primary');
  appNoticeCancelBtn.classList.add('secondary');
  appNoticeActions.classList.remove('confirm-mode');
  appNoticeBtn.classList.remove('danger', 'secondary');
  appNoticeBtn.classList.add('primary');
  appNoticeBtn.textContent = '知道了';
  noticeMode = 'alert';
  if (noticeResolve) {
    noticeResolve(result);
    noticeResolve = null;
  }
}

const appNoticeActions = appNotice.querySelector('.app-notice-actions');

function dismissAppNotice() {
  finishAppNotice(noticeMode === 'confirm' ? false : undefined);
}

function confirmAppNotice() {
  finishAppNotice(noticeMode === 'confirm' ? true : undefined);
}

function showAppNotice({
  title,
  message,
  detail,
  tone = 'guide',
  confirm = false,
  confirmLabel = '确定',
  cancelLabel = '取消',
  dangerConfirm = false,
  preferCancel = false,
}) {
  return new Promise((resolve) => {
    noticeResolve = resolve;
    noticeMode = confirm ? 'confirm' : 'alert';
    appNoticeTitle.textContent = title || '提示';
    appNoticeMessage.textContent = message || '';
    if (detail) {
      appNoticeDetail.textContent = detail;
      appNoticeDetail.classList.remove('hidden');
    } else {
      appNoticeDetail.textContent = '';
      appNoticeDetail.classList.add('hidden');
    }
    appNoticeIcon.textContent = NOTICE_ICON[tone] || NOTICE_ICON.guide;
    appNoticeIcon.className = `app-notice-icon ${tone}`;

    if (confirm) {
      appNoticeCancelBtn.textContent = cancelLabel;
      appNoticeCancelBtn.classList.remove('hidden');
      appNoticeActions.classList.add('confirm-mode');
      appNoticeBtn.textContent = confirmLabel;
      if (preferCancel) {
        appNoticeCancelBtn.classList.remove('secondary');
        appNoticeCancelBtn.classList.add('primary');
        appNoticeBtn.classList.remove('primary', 'danger');
        appNoticeBtn.classList.add('secondary');
      } else {
        appNoticeCancelBtn.classList.remove('primary');
        appNoticeCancelBtn.classList.add('secondary');
        appNoticeBtn.classList.remove('secondary');
        appNoticeBtn.classList.toggle('primary', !dangerConfirm);
        appNoticeBtn.classList.toggle('danger', dangerConfirm);
      }
    }

    appNotice.classList.remove('hidden');
    const focusTarget = confirm ? (preferCancel ? appNoticeCancelBtn : appNoticeBtn) : appNoticeBtn;
    focusTarget.focus();
  });
}

async function showConfirmDialog({
  title,
  message,
  detail,
  tone = 'warn',
  confirmLabel = '确定',
  cancelLabel = '取消',
  dangerConfirm = false,
  preferCancel = false,
}) {
  return showAppNotice({
    title,
    message,
    detail,
    tone,
    confirm: true,
    confirmLabel,
    cancelLabel,
    dangerConfirm,
    preferCancel,
  });
}

async function showFriendlyError(title, message, detail, tone) {
  const resolvedTone = tone || inferNoticeTone(title, message);
  await showAppNotice({
    title,
    message,
    detail,
    tone: resolvedTone,
  });
}

function buildScanFailureDetail(result) {
  const parts = [];
  if (result.feedbackSummary) {
    parts.push(result.feedbackSummary);
  } else if (result.logFileName) {
    parts.push(`日志文件：${result.logFileName}`);
  }
  return parts.join('\n\n') || null;
}

async function showScanFailure(result) {
  const errorInfo = result.errorInfo || {
    code: 'WTR-E099',
    title: '扫描失败',
    userMessage: result.error || '扫描失败',
  };
  const action = await showAppNotice({
    title: `${errorInfo.title}（${errorInfo.code}）`,
    message: errorInfo.userMessage,
    detail: buildScanFailureDetail(result),
    tone: 'error',
    confirm: true,
    confirmLabel: '知道了',
    cancelLabel: '打开日志文件夹',
  });

  if (action === false) {
    await window.exporter.openLogDir();
  }
}

let preflightModalResolve = null;
let preflightModalSession = 0;

function renderPreflightModalList(checks) {
  preflightModalList.innerHTML = '';
  const markMap = { pass: '✓', warn: '!', fail: '✕' };
  for (const check of checks || []) {
    const li = document.createElement('li');
    li.className = `preflight-item ${check.level}`;
    const mark = document.createElement('span');
    mark.className = 'preflight-mark';
    mark.textContent = markMap[check.level] || '•';
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = check.label;
    body.appendChild(title);
    if (check.detail && check.level !== 'pass') {
      const detail = document.createElement('span');
      detail.textContent = check.detail;
      body.appendChild(detail);
    }
    li.appendChild(mark);
    li.appendChild(body);
    preflightModalList.appendChild(li);
  }
}

function closePreflightModal() {
  preflightModal.classList.add('hidden');
  preflightModalLoading.classList.add('hidden');
  preflightModalList.classList.add('hidden');
  preflightModalResolve = null;
}

function setPreflightModalButtons({ showStart = true, startEnabled = true } = {}) {
  preflightModalPrimaryBtn.textContent = '开始扫描';
  preflightModalCancelBtn.textContent = '取消';
  preflightModalPrimaryBtn.classList.toggle('hidden', !showStart);
  preflightModalPrimaryBtn.disabled = !startEnabled;
  preflightModalCancelBtn.classList.remove('hidden');
}

function openPreflightModalLoading() {
  const session = ++preflightModalSession;
  preflightModalTitle.textContent = '环境检查';
  preflightModalLoading.classList.remove('hidden');
  preflightModalList.classList.add('hidden');
  setPreflightModalButtons({ showStart: false });
  preflightModal.classList.remove('hidden');
  preflightModalCancelBtn.classList.remove('hidden');
  return session;
}

function showPreflightModalChecks(preflight) {
  preflightModalLoading.classList.add('hidden');
  preflightModalList.classList.remove('hidden');
  renderPreflightModalList(preflight.checks);
  setPreflightModalButtons({
    showStart: Boolean(preflight.ok),
    startEnabled: Boolean(preflight.ok),
  });
}

function showPreflightModalError(message) {
  preflightModalLoading.classList.add('hidden');
  preflightModalList.classList.remove('hidden');
  preflightModalList.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'preflight-item fail';
  const mark = document.createElement('span');
  mark.className = 'preflight-mark';
  mark.textContent = '✕';
  const body = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = '检查失败';
  const detail = document.createElement('span');
  detail.textContent = message;
  body.appendChild(title);
  body.appendChild(detail);
  li.appendChild(mark);
  li.appendChild(body);
  preflightModalList.appendChild(li);
  setPreflightModalButtons({ showStart: false });
}

function waitForPreflightModal(session) {
  return new Promise((resolve) => {
    if (session !== preflightModalSession) {
      resolve(false);
      return;
    }
    preflightModalResolve = resolve;
  });
}

function finishPreflightModal(proceed) {
  const resolve = preflightModalResolve;
  preflightModalSession += 1;
  closePreflightModal();
  resolve?.(proceed);
}

function onPreflightModalPrimary() {
  finishPreflightModal(true);
}

function onPreflightModalCancel() {
  finishPreflightModal(false);
}

function onPreflightModalBackdrop(event) {
  if (event.target?.matches?.('[data-preflight-dismiss]')) {
    onPreflightModalCancel();
  }
}

preflightModalPrimaryBtn.addEventListener('click', onPreflightModalPrimary);
preflightModalCancelBtn.addEventListener('click', onPreflightModalCancel);
preflightModal.addEventListener('click', onPreflightModalBackdrop);

async function runDecryptPreflightGate(rootDir, accountPath) {
  const session = openPreflightModalLoading();

  let readiness = null;
  try {
    const status = await window.exporter.checkWeChatStatus({
      wxDir: rootDir,
      accountPath,
    });
    readiness = status.ok ? status.readiness : null;
  } catch {
    readiness = null;
  }

  if (session !== preflightModalSession) {
    return false;
  }

  const result = await window.exporter.runPreflight({
    wxDir: rootDir,
    accountPath,
    readiness,
  });

  if (session !== preflightModalSession) {
    return false;
  }

  if (!result.checks?.length) {
    showPreflightModalError(result.error || '无法完成环境检查');
  } else {
    showPreflightModalChecks(result);
  }

  const proceed = await waitForPreflightModal(session);
  return proceed && result.ok;
}

function getExportOptions(extra = {}) {
  const accountPath = resolvedAccountPath || getSelectedAccountPath();
  const account = scannedAccounts.find((item) => item.path === accountPath);
  const cachedProfile = accountPath ? accountProfileCache.get(accountPath) : null;
  const rawName = cachedProfile?.displayName || account?.displayName || null;
  const wxid = account?.wxid || null;
  return {
    wxDir: wxDirInput.value.trim(),
    accountPath,
    displayName: isRealDisplayName(rawName, wxid) ? rawName : null,
    outputDir: outputDirInput.value.trim(),
    selfWxid: null,
    forceDecrypt: false,
    loginCapture: true,
    keysPath: null,
    formats: getSelectedFormats(),
    selectedUsernames: getSelectedUsernames(),
    voiceTranscription: isVoiceTranscriptionEnabled(),
    ...extra,
  };
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min} 分 ${sec.toString().padStart(2, '0')} 秒` : `${sec} 秒`;
}

function formatCacheTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sanitizeScanMessage(msg) {
  return msg
    .replace(/db_storage[^\s]*/g, '数据')
    .replace(/\.wexin_passphrase/g, '密钥')
    .replace(/Weixin\.dll/g, '微信组件')
    .replace(/Weixin\.exe/g, '微信');
}

function friendlyScanMessage(event) {
  const msg = event?.message || '';
  const phase = event?.phase || '';

  if (phase === 'scan' && event.subphase === 'counting' && event.total) {
    const current = event.current || 0;
    if (event.countingScope === 'message_dbs') {
      if (msg.includes('增量更新')) {
        return msg;
      }
      return `正在统计消息库 ${current} / ${event.total}`;
    }
    if (event.countingScope === 'sessions' && current >= event.total) {
      return event.message || `已统计 ${formatCount(current)} 个会话候选`;
    }
    return `已统计 ${formatCount(current)} / ${formatCount(event.total)} 个会话`;
  }

  if (phase === 'decrypt' && event.current && event.total) {
    return `正在解密数据（${event.current}/${event.total}）…`;
  }

  if (phase === 'keys' && msg) {
    if (msg.includes('Hook 已就绪') || msg.includes('请点击「登录」') || msg.includes('点击「登录」')) {
      return 'Hook 已就绪，请在微信窗口点击「登录」（通常无需扫码）';
    }
    if (msg.includes('正在准备 Hook 环境') || msg.includes('Hook 环境准备完成')) {
      return sanitizeScanMessage(msg);
    }
    if (msg.includes('请先不要点击') || msg.includes('不要点击登录') || msg.includes('等待提示后再点击')) {
      return '正在安装 Hook，请先不要点击「登录」…';
    }
    if (msg.includes('等待密钥') || msg.includes('仍在捕获') || msg.includes('等待捕获密钥')) {
      return sanitizeScanMessage(msg);
    }
    if (msg.includes('正在安装 Hook') || msg.includes('Hook 尚未就绪') || msg.includes('等待微信组件')) {
      return '正在安装 Hook，请先不要点击「登录」…';
    }
    if (msg.includes('已启动微信') || msg.includes('等待微信启动') || msg.includes('未检测到 Weixin')) {
      return sanitizeScanMessage(msg);
    }
    if (msg.includes('已结束进程') || msg.includes('重新启动') || msg.includes('关闭微信')) {
      return '正在重启微信以捕获密钥…';
    }
    if (msg.includes('管理员')) {
      return sanitizeScanMessage(msg);
    }
    if (msg.includes('提取') || msg.includes('密钥') || msg.includes('Hook') || msg.includes('捕获')) {
      return sanitizeScanMessage(msg);
    }
  }

  if (msg.includes('正在从微信进程内存提取数据库密钥')) {
    return '正在准备获取解密密钥…';
  }
  if (msg.includes('解密数据库文件') || msg.startsWith('解密中')) {
    return '正在解密聊天记录…';
  }
  if (msg.includes('解密完成')) {
    return '解密完成，正在整理会话…';
  }
  if (msg.includes('跳过解密')) {
    return '正在读取已有数据…';
  }
  if (msg.includes('会话列表') || msg.includes('统计会话')) {
    return '正在整理会话列表…';
  }
  if (msg.includes('未找到已解密') || msg.includes('首次扫描需要解密')) {
    return '首次扫描需要解密，可能需要几分钟…';
  }
  return sanitizeScanMessage(msg) || '处理中…';
}

function friendlyScanTitle(event) {
  const phase = event?.phase || '';
  const msg = event?.message || '';
  if (phase === 'scan' && event.subphase === 'counting') return '正在统计会话';
  if (phase === 'keys') return '正在获取密钥';
  if (phase === 'decrypt') {
    if (msg.includes('解密中') || msg.includes('解密数据库')) return '正在解密';
    if (msg.includes('提取') || msg.includes('密钥')) return '正在获取密钥';
    return '正在解密';
  }
  return '正在扫描';
}

function friendlyScanNote(event) {
  const msg = event?.message || '';
  const phase = event?.phase || '';

  if (phase === 'keys') {
    if (msg.includes('Hook 已就绪') || msg.includes('等待密钥') || msg.includes('仍在捕获') || msg.includes('点击「登录」')) {
      return '请在弹出的微信窗口点击「登录」。若长时间无响应，请右键本程序「以管理员身份运行」后重试。';
    }
    if (msg.includes('正在准备 Hook 环境') || msg.includes('Hook 环境准备完成')) {
      return '正在加载解密模块并定位微信路径，此阶段不会关闭微信。准备完成后才会重启微信。';
    }
    if (
      msg.includes('请先不要点击') ||
      msg.includes('不要点击登录') ||
      msg.includes('正在安装 Hook') ||
      msg.includes('Hook 尚未就绪') ||
      msg.includes('后台启动')
    ) {
      return '微信已重启，正在安装 Hook。看到「Hook 已就绪」后再点击「登录」，否则无法捕获密钥。';
    }
    if (msg.includes('管理员') || msg.includes('安装 Hook')) {
      return '获取密钥需要管理员权限。请关闭本程序，右键「以管理员身份运行」后再扫描。';
    }
    return '工具会暂时关闭并重启微信，Hook 就绪后再点击「登录」。整个过程通常 1～3 分钟。';
  }

  if (phase === 'decrypt' && (msg.includes('提取') || msg.includes('密钥'))) {
    return '首次扫描需要获取解密密钥。若弹出微信，请点击「登录」。';
  }

  if (phase === 'scan' && event.subphase === 'counting') {
    return '正在逐个统计消息数量，数据量较大时可能需要较长时间，请耐心等待。';
  }

  if (phase === 'scan' && msg.includes('有更新')) {
    return '正在重新解密微信数据库以同步最新聊天记录，请保持微信处于登录状态。';
  }

  return '首次扫描可能需要几分钟。若弹出微信，请点击「登录」';
}

function startScanElapsedTimer() {
  stopScanElapsedTimer();
  scanStartedAt = Date.now();
  scanToastElapsed.textContent = '已等待 0 秒';
  scanElapsedTimer = setInterval(() => {
    scanToastElapsed.textContent = `已等待 ${formatElapsed(Date.now() - scanStartedAt)}`;
  }, 1000);
}

function stopScanElapsedTimer() {
  if (scanElapsedTimer) {
    clearInterval(scanElapsedTimer);
    scanElapsedTimer = null;
  }
  scanToastElapsed.textContent = '';
}

function getParentDir(filePath) {
  const normalized = filePath.replace(/[/\\]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return idx >= 0 ? normalized.slice(0, idx) : normalized;
}

function getWxidFromPath(accountPath, selfWxid = null) {
  if (selfWxid) return selfWxid;
  const folderName = accountPath.split(/[/\\]/).pop() || accountPath;
  const match = folderName.match(/^(.+?)_c[a-f0-9]+$/i);
  return match ? match[1] : folderName;
}

function getAccountLabel(accountPath, hints = null) {
  let selfWxid = null;
  let displayName = null;

  if (typeof hints === 'string') {
    selfWxid = hints;
  } else if (hints && typeof hints === 'object') {
    selfWxid = hints.selfWxid || null;
    displayName = hints.displayName || null;
  }

  const wxid = getWxidFromPath(accountPath, selfWxid);

  if (isRealDisplayName(displayName, wxid)) {
    return displayName;
  }

  const profile = accountProfileCache.get(accountPath);
  if (isRealDisplayName(profile?.displayName, wxid)) {
    return profile.displayName;
  }

  const account = scannedAccounts.find((item) => item.path === accountPath);
  if (isRealDisplayName(account?.displayName, wxid)) {
    return account.displayName;
  }

  const folderName = accountPath.split(/[/\\]/).pop() || accountPath;
  const match = folderName.match(/^(.+?)_c[a-f0-9]+$/i);
  const fromFolder = match ? match[1] : folderName;
  if (fromFolder && !/^wxid_/i.test(fromFolder)) {
    return fromFolder;
  }

  return wxid;
}

async function enrichCacheAccountProfiles(caches) {
  const missing = [];

  for (const cache of caches) {
    const wxid = getWxidFromPath(cache.accountPath, cache.selfWxid);
    if (isRealDisplayName(cache.displayName, wxid)) {
      continue;
    }
    const profile = accountProfileCache.get(cache.accountPath);
    if (isRealDisplayName(profile?.displayName, wxid)) {
      cache.displayName = profile.displayName;
      window.exporter.patchConversationCacheLabel({
        accountPath: cache.accountPath,
        displayName: profile.displayName,
      }).catch(() => {});
      continue;
    }
    missing.push({ path: cache.accountPath, wxid });
  }

  if (!missing.length) {
    return;
  }

  try {
    const result = await window.exporter.enrichAccounts({ accounts: missing });
    if (!result.ok || !result.accounts?.length) {
      return;
    }

    cacheAccountProfiles(result.accounts);
    for (const account of result.accounts) {
      const cache = caches.find((item) => item.accountPath === account.path);
      if (!cache || !isRealDisplayName(account.displayName, account.wxid)) {
        continue;
      }
      cache.displayName = account.displayName;
      window.exporter.patchConversationCacheLabel({
        accountPath: account.path,
        displayName: account.displayName,
      }).catch(() => {});
    }
  } catch {
    // ignore profile enrichment failures
  }
}

async function refreshConversationCacheHint() {
  const selectedPath = getSelectedAccountPath();
  const result = await window.exporter.listConversationCaches();
  const allCaches = result.ok && result.caches?.length ? result.caches : [];
  conversationCacheEntries = allCaches;

  if (!selectedPath || !allCaches.length) {
    currentConversationCache = null;
    cacheSection.classList.add('hidden');
    cacheList.innerHTML = '';
    scanBtn.textContent = '扫描会话';
    return;
  }

  const accountCaches = allCaches.filter((item) => item.accountPath === selectedPath);
  if (!accountCaches.length) {
    currentConversationCache = null;
    cacheSection.classList.add('hidden');
    cacheList.innerHTML = '';
    scanBtn.textContent = '扫描会话';
    return;
  }

  currentConversationCache = accountCaches[0] || null;

  await enrichCacheAccountProfiles(accountCaches);
  renderConversationCacheList(accountCaches);
  cacheSection.classList.remove('hidden');
  scanBtn.textContent = '重新扫描';
}

function renderConversationCacheList(caches) {
  cacheList.innerHTML = '';

  for (const cache of caches) {
    const item = document.createElement('div');
    item.className = 'cache-item';

    const label = getAccountLabel(cache.accountPath, cache);
    const profile = accountProfileCache.get(cache.accountPath);
    const scannedAt = formatCacheTime(cache.scannedAt);

    if (profile?.avatar) {
      const img = document.createElement('img');
      img.className = 'account-avatar cache-item-avatar';
      img.src = profile.avatar;
      img.alt = '';
      item.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'account-avatar placeholder cache-item-avatar';
      placeholder.textContent = label.slice(0, 1).toUpperCase();
      item.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'cache-item-info';

    const title = document.createElement('div');
    title.className = 'cache-item-title';
    title.textContent = scannedAt || label;

    const meta = document.createElement('div');
    meta.className = 'cache-item-meta';
    meta.textContent = formatScanStatsSummary(cache);

    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'cache-item-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'btn secondary';
    useBtn.type = 'button';
    useBtn.textContent = '使用';
    useBtn.addEventListener('click', () => useCachedConversations(cache.accountPath, cache.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn ghost danger-text';
    deleteBtn.type = 'button';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', () => deleteConversationCache(cache.accountPath, cache.id));

    actions.appendChild(useBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);
    cacheList.appendChild(item);
  }
}

async function handleResetAccountDecryptData() {
  if (scanRunning || exportRunning) {
    await showFriendlyError('请稍候', '请等待当前任务结束。');
    return;
  }

  const accountPath = getSelectedAccountPath();
  if (!accountPath) {
    await showFriendlyError('请选择账号', '请先选择微信账号。');
    return;
  }

  const label = getAccountLabel(accountPath, {});
  const confirmed = await showConfirmDialog({
    title: '重置解密数据',
    message: `清除「${label}」的密钥与解密缓存？此操作用于故障排查，完成后需重新解密。`,
    tone: 'warn',
    confirmLabel: '重置',
    dangerConfirm: true,
  });
  if (!confirmed) {
    return;
  }

  const result = await window.exporter.resetAccountDecryptData({ accountPath });
  if (!result.ok) {
    await showFriendlyError('重置失败', result.error || '操作失败');
    return;
  }

  if (getSelectedAccountPath() === accountPath) {
    currentConversationCache = null;
  }

  const rootDir = wxDirInput.value.trim();
  if (rootDir) {
    await validateWxDir(rootDir, accountPath);
  }
  void refreshConversationCacheHint();

  await showAppNotice({
    title: '已重置',
    message: '解密缓存已清除。请重新点击「扫描会话」完成解密。',
    tone: 'guide',
  });
}

async function handleResetAllToolTraces() {
  if (scanRunning || exportRunning) {
    await showFriendlyError('请稍候', '请等待当前任务结束。');
    return;
  }

  const selectedAccountPath = getSelectedAccountPath();

  const confirmed = await showConfirmDialog({
    title: '清除全部工具痕迹',
    message:
      '将清除所有曾扫描账号目录中的密钥、解密库与语音转写缓存，并清除 App 设置、扫描记录与诊断日志。不会删除已导出的聊天记录。此操作不可恢复。',
    tone: 'warn',
    confirmLabel: '清除',
    dangerConfirm: true,
  });
  if (!confirmed) {
    return;
  }

  const additionalAccountPaths = selectedAccountPath ? [selectedAccountPath] : [];
  const result = await window.exporter.resetAllToolTraces({ additionalAccountPaths });
  if (!result.ok) {
    await showFriendlyError('清除失败', result.error || '操作失败');
    return;
  }

  applyLocalAppReset({ persistSettingsFile: false });

  const action = await showAppNotice({
    title: '已清除',
    message:
      '若需彻底卸载，请先关闭应用，再手动删除 App 数据目录中的所有文件。',
    tone: 'guide',
    confirm: true,
    confirmLabel: '知道了',
    cancelLabel: '打开 App 数据目录',
  });

  if (action === false) {
    await window.exporter.openUserDataDir();
  }
}

function applyLocalAppReset({ persistSettingsFile = true } = {}) {
  wxDirInput.value = '';
  outputDirInput.value = '';
  selectedAccountPath = null;
  resolvedAccountPath = null;
  currentConversationCache = null;
  conversationCacheEntries = [];
  accountProfileCache.clear();
  accountField.classList.add('hidden');
  cacheSection.classList.add('hidden');
  cacheList.innerHTML = '';
  accountList.innerHTML = '';
  accountHint.textContent = '';
  readinessPanel.classList.add('hidden');

  for (const input of document.querySelectorAll('input[name="format"]')) {
    input.checked = input.value === 'html';
  }
  if (voiceTranscriptionInput) {
    voiceTranscriptionInput.checked = false;
  }

  const minimalSettings = { disclaimerAccepted: disclaimerAccepted.checked };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(minimalSettings));
  if (persistSettingsFile) {
    window.exporter.saveSettings(minimalSettings).catch(() => {});
  }
}

async function deleteConversationCache(accountPath, scanId) {
  let cache =
    conversationCacheEntries.find((item) => item.accountPath === accountPath && item.id === scanId) ||
    conversationCacheEntries.find((item) => item.accountPath === accountPath);
  const wxid = getWxidFromPath(accountPath, cache?.selfWxid);
  if (
    cache &&
    !isRealDisplayName(cache.displayName, wxid) &&
    !isRealDisplayName(accountProfileCache.get(accountPath)?.displayName, wxid)
  ) {
    await enrichCacheAccountProfiles([cache]);
    cache =
      conversationCacheEntries.find((item) => item.accountPath === accountPath && item.id === scanId) ||
      cache;
  }
  const label = getAccountLabel(accountPath, cache || {});
  const scannedAt = formatCacheTime(cache?.scannedAt);
  const confirmed = await showConfirmDialog({
    title: '确认删除',
    message: scannedAt
      ? `确定删除「${label}」在 ${scannedAt} 的扫描记录吗？`
      : `确定删除「${label}」的这条扫描记录吗？`,
    tone: 'warn',
    confirmLabel: '删除',
    dangerConfirm: true,
  });
  if (!confirmed) {
    return;
  }

  const result = await window.exporter.clearConversationCache({ accountPath, scanId });
  if (!result.ok) {
    await showFriendlyError('删除失败', result.error || '无法删除扫描缓存');
    return;
  }

  if (currentConversationCache?.id === scanId) {
    currentConversationCache = null;
  }
  void refreshConversationCacheHint();
}

function applyConversationScanResult(result, { fromCache = false, unchanged = false, incremental = null } = {}) {
  renderConversationList(result.conversations || []);
  setStep(3);

  let logMessage;
  if (unchanged) {
    logMessage = `数据未变化，已复用上次的会话列表：${formatScanStatsSummary(result)}`;
  } else if (fromCache) {
    logMessage = `已加载缓存：${formatScanStatsSummary(result)}`;
  } else if (incremental?.reusedDbCount > 0) {
    logMessage = `增量扫描完成（复用 ${incremental.reusedDbCount} 个消息库）：${formatScanStatsSummary(result)}`;
  } else {
    logMessage = `扫描完成：${formatScanStatsSummary(result)}`;
  }

  appendLog(logMessage);
  void refreshSelectionSummary();
}

function renderOutputGuide(formats) {
  const items = [];
  if (formats.includes('html')) {
    items.push('<strong>index.html</strong> — 用浏览器打开，浏览所有会话');
    items.push('<strong>chats/*.html</strong> — 每个会话的网页版聊天记录');
  }
  if (formats.includes('json')) {
    items.push('<strong>conversations.json</strong> — 会话索引');
    items.push('<strong>contacts.json</strong> — 联系人昵称');
    items.push('<strong>chats/*.json</strong> — 每个会话的完整数据');
  }
  if (formats.includes('txt')) {
    items.push('<strong>chats/*.txt</strong> — 纯文本格式，方便阅读');
  }
  if (formats.includes('csv')) {
    items.push('<strong>messages.csv</strong> — 全部消息汇总，可用 Excel 打开');
  }

  if (!items.length) {
    outputGuide.innerHTML = '';
    return;
  }

  outputGuide.innerHTML = `<strong>文件说明</strong><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

async function useCachedConversations(accountPath = null, scanId = null) {
  const targetPath = accountPath || getSelectedAccountPath();
  if (!targetPath) {
    await showFriendlyError('请选择账号', '请先选择要导出的微信账号。');
    return;
  }

  const rootDir = wxDirInput.value.trim();
  if (!rootDir) {
    const parentDir = getParentDir(targetPath);
    wxDirInput.value = parentDir;
    saveSettings();
    await validateWxDir(parentDir, targetPath);
  } else if (targetPath !== getSelectedAccountPath()) {
    await selectAccount(targetPath);
  }

  const cacheResult = await window.exporter.loadConversationCache({
    accountPath: targetPath,
    scanId: scanId || null,
  });
  if (!cacheResult.ok || !cacheResult.cache?.conversations?.length) {
    await showFriendlyError('缓存不可用', '未找到该扫描记录，请重新扫描。');
    void refreshConversationCacheHint();
    return;
  }

  currentConversationCache = cacheResult.cache;
  applyConversationScanResult(
    {
      conversations: cacheResult.cache.conversations,
      conversationCount: cacheResult.cache.conversationCount,
      totalMessages: cacheResult.cache.totalMessages,
    },
    { fromCache: true }
  );
}

function showScanToast(title, message, note = null) {
  scanToast.classList.remove('hidden');
  scanToastTitle.textContent = title;
  scanToastMessage.textContent = message;
  scanToastNote.textContent = note || scanToastNote.textContent;
  scanToastNote.classList.remove('hidden');
}

function hideScanToast() {
  scanToast.classList.add('hidden');
  stopScanElapsedTimer();
}

async function scanConversations() {
  const rootDir = wxDirInput.value.trim();

  if (!rootDir) {
    await showFriendlyError('请选择目录', '请选择微信数据目录。');
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

  const requirements = await window.exporter.getScanRequirements({
    accountPath,
    forceDecrypt: false,
  });
  if (!requirements.ok) {
    await showFriendlyError('无法扫描', requirements.error || '请重新选择账号');
    return;
  }

  let clientPreflightOk = false;
  if (requirements.needsDecrypt) {
    const passed = await runDecryptPreflightGate(rootDir, accountPath);
    if (!passed) {
      return;
    }
    clientPreflightOk = true;
  }

  userCancelledScan = false;
  scanRunning = true;
  updateStepNavUI();
  scanBtn.disabled = true;
  scanBtn.textContent = '扫描中…';
  showScanToast('正在扫描', '正在准备，请稍候…');
  startScanElapsedTimer();

  const result = await window.exporter.scanConversations(
    getExportOptions({ clientPreflightOk })
  );

  scanRunning = false;
  updateStepNavUI();
  scanBtn.disabled = false;
  hideScanToast();
  void refreshConversationCacheHint();

  if (result.cancelled || userCancelledScan) {
    scanBtn.textContent = currentConversationCache ? '重新扫描' : '扫描会话';
    return;
  }

  if (!result.ok) {
    scanBtn.textContent = currentConversationCache ? '重新扫描' : '扫描会话';
    await showScanFailure(result);
    return;
  }

  applyConversationScanResult(result, {
    fromCache: Boolean(result.fromCache),
    unchanged: Boolean(result.unchanged),
    incremental: result.incremental || null,
  });
  scanBtn.textContent = '重新扫描';

  if (rootDir && resolvedAccountPath) {
    const status = await window.exporter.validateWxDir({
      wxDir: rootDir,
      accountPath: resolvedAccountPath,
    });
    if (status.ok && status.accounts?.length) {
      await loadAccountProfiles(status.accounts);
    } else {
      void refreshConversationCacheHint();
    }
  }
}

async function startExport() {
  const options = getExportOptions();

  if (!options.outputDir) {
    await showFriendlyError('请选择保存位置', '请选择导出文件的保存目录。');
    return;
  }

  if (!options.formats.length) {
    await showFriendlyError('请选择导出格式', '至少勾选一种导出格式（JSON / HTML / TXT / CSV）。');
    return;
  }

  if (!options.selectedUsernames.length) {
    await showFriendlyError('未选择会话', '请至少选择一个要导出的会话。');
    return;
  }

  const canProceed = await confirmOutputDirIfNotEmpty(options.outputDir);
  if (!canProceed) {
    return;
  }

  exportRunning = true;
  exportStartedAt = Date.now();
  const exportStats = getSelectionStats();
  resetExportTaskProgress();
  initExportTaskProgress(options, exportStats);
  updateStepNavUI();
  startBtn.disabled = true;
  cancelBtn.classList.remove('hidden');
  openOutputBtn.disabled = true;
  logEl.textContent = '';
  setProgress(0, '总进度 0% · 准备中…');
  appendLog('开始导出…');
  saveSettings();
  const preEstimate = await window.exporter.estimateExport({
    ...exportStats,
    formatCount: Math.max(1, options.formats.length),
    voiceTranscription: options.voiceTranscription,
  }).catch(() => null);
  if (preEstimate?.rangeText) {
    appendLog(`预计耗时 ${preEstimate.rangeText}`);
  }

  const exportStartedAtMs = exportStartedAt;
  const result = await window.exporter.startExport({
    wxDir: resolvedAccountPath,
    outputDir: options.outputDir,
    selfWxid: options.selfWxid,
    forceDecrypt: options.forceDecrypt,
    loginCapture: options.loginCapture,
    keysPath: options.keysPath,
    formats: options.formats,
    selectedUsernames: options.selectedUsernames,
    voiceTranscription: options.voiceTranscription,
  });

  const exportDurationSec = Math.max(1, (Date.now() - exportStartedAtMs) / 1000);
  exportRunning = false;
  exportStartedAt = 0;
  updateStepNavUI();
  cancelBtn.classList.add('hidden');
  startBtn.disabled = false;

  if (result.ok) {
    void window.exporter.recordExportPerf({
      durationSec: exportDurationSec,
      messageCount: result.result.totalMessages || exportStats.messageCount,
      voiceCount: exportStats.voiceCount,
      voiceTranscription: options.voiceTranscription,
    }).catch(() => {});
    resetOutputDirNonEmptyAck();
    lastOutputDir = result.result.outputDir;
    lastHtmlIndexPath = result.result.htmlIndexPath || '';
    openOutputBtn.disabled = false;
    if (lastHtmlIndexPath) {
      openIndexBtn.classList.remove('hidden');
    } else {
      openIndexBtn.classList.add('hidden');
    }
    setProgress(100, '总进度 100% · 导出完成');
    successSummary.textContent = `共导出 ${result.result.conversationCount} 个会话，${formatCount(result.result.totalMessages)} 条消息${result.result.voiceTranscription ? '（含语音转文字）' : ''}。\n文件已保存到：${result.result.outputDir}`;
    renderOutputGuide(options.formats);
    setStep(5);
    resetExportTaskProgress();
  } else if (result.cancelled) {
    const partial = exportTaskExported;
    const outputDir = options.outputDir;
    if (partial > 0) {
      setProgress(exportDisplayPercent, `已取消 · 已导出 ${partial}/${exportTaskTotal} 个会话`);
      appendLog(`导出已取消。已完成的 ${partial} 个会话文件仍保留在：${outputDir}`);
      appendLog('未生成完整的 index.html / conversations.json，重新导出可补全。');
      const open = await showConfirmDialog({
        title: '导出已取消',
        message: `已成功导出 ${partial} 个会话，文件保留在所选目录。`,
        detail:
          '未生成完整的 index.html / conversations.json。如需完整备份，可重新导出（建议选空文件夹，或确认不会覆盖需要的文件）。',
        tone: 'guide',
        confirmLabel: '打开文件夹',
        cancelLabel: '知道了',
        preferCancel: true,
      });
      if (open) {
        window.exporter.openPath(outputDir);
      }
    } else {
      setProgress(0, '已取消');
      appendLog('导出已取消');
    }
    resetExportTaskProgress();
  } else {
    setProgress(0, '导出失败');
    appendLog(`错误: ${result.error}`);
    resetExportTaskProgress();
    await showFriendlyError(
      '导出失败',
      result.error,
      '常见原因：微信未登录、密钥未加载、目录无写入权限。\n建议先打开几个聊天窗口，或以管理员身份运行后重试。'
    );
  }
}

async function initApp() {
  const info = await window.exporter.getAppInfo();
  appVersion.textContent = `v${info.version}`;
  whisperModelBundled = Boolean(info.voiceTranscriptionAvailable ?? info.whisperModelBundled);
  updateVoiceTranscriptionUI();

  const settings = await loadSettings();
  applySettingsToForm(settings);

  setStep(settings.disclaimerAccepted ? 2 : 1);
  setProgress(0, '等待开始');

  if (settings.wxDir) {
    void validateWxDir(settings.wxDir, settings.accountPath || null);
    if (settings.wxDir || settings.outputDir) {
      window.exporter.saveSettings(settings).catch(() => {});
    }
  } else {
    void refreshConversationCacheHint();
  }
}

document.getElementById('pickWxDir').addEventListener('click', () => {
  pickDirectory('选择 xwechat_files 目录', wxDirInput);
});

document.getElementById('pickOutputDir').addEventListener('click', () => {
  pickDirectory('选择导出目录', outputDirInput);
});

outputDirInput.addEventListener('change', () => {
  resetOutputDirNonEmptyAck();
  saveSettings();
});

wxDirInput.addEventListener('change', () => {
  saveSettings();
  void validateWxDir(wxDirInput.value.trim());
});

refreshAccountsBtn.addEventListener('click', () => {
  void refreshWxAccountList();
});

resetDecryptBtn?.addEventListener('click', () => {
  void handleResetAccountDecryptData();
});

resetAllToolTracesBtn?.addEventListener('click', () => {
  void handleResetAllToolTraces();
});

autoDetectBtn.addEventListener('click', async () => {
  autoDetectBtn.disabled = true;
  autoDetectBtn.textContent = '检测中…';
  const result = await window.exporter.detectWxPaths();
  autoDetectBtn.disabled = false;
  autoDetectBtn.textContent = '自动检测';

  if (!result.ok) {
    await showFriendlyError('检测失败', result.error || '无法扫描常见微信目录');
    return;
  }

  const paths = result.paths || [];
  if (!paths.length) {
    wxDirHint.textContent = '未在常见位置找到微信数据，请手动浏览选择';
    wxDirHint.className = 'hint';
    return;
  }

  const detected = paths[0];
  wxDirInput.value = detected.path;
  saveSettings();
  await validateWxDir(detected.path);
});

scanBtn.addEventListener('click', () => scanConversations());

disclaimerAccepted.addEventListener('change', () => {
  welcomeNextBtn.disabled = !disclaimerAccepted.checked;
  saveSettings();
  updateStepNavUI();
});

stepEls.forEach((el) => {
  el.addEventListener('click', () => {
    void navigateToStep(Number(el.dataset.step));
  });
});

appNoticeBtn.addEventListener('click', confirmAppNotice);
appNoticeCancelBtn.addEventListener('click', dismissAppNotice);
appNotice.querySelector('[data-notice-dismiss]').addEventListener('click', dismissAppNotice);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !appNotice.classList.contains('hidden')) {
    dismissAppNotice();
  }
});

welcomeNextBtn.addEventListener('click', () => {
  if (!disclaimerAccepted.checked) return;
  saveSettings();
  setStep(2);
  void refreshConversationCacheHint();
});

accountBackBtn.addEventListener('click', () => setStep(1));
exportBackBtn.addEventListener('click', () => setStep(3));

cancelScanBtn.addEventListener('click', async () => {
  userCancelledScan = true;
  await window.exporter.cancelScan();
  scanRunning = false;
  updateStepNavUI();
  scanBtn.disabled = false;
  scanBtn.textContent = currentConversationCache ? '重新扫描' : '扫描会话';
  hideScanToast();
});
backBtn.addEventListener('click', () => setStep(2));
toExportBtn.addEventListener('click', async () => {
  if (!getSelectedUsernames().length) {
    await showFriendlyError('未选择会话', '请至少选择一个要导出的会话。');
    return;
  }
  setStep(4);
  void refreshSelectionSummary({ highlight: true });
});
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

openIndexBtn.addEventListener('click', () => {
  if (lastHtmlIndexPath) {
    window.exporter.openPath(lastHtmlIndexPath);
  }
});

restartBtn.addEventListener('click', () => {
  setStep(2);
  setProgress(0, '等待开始');
  logEl.textContent = '';
  outputGuide.innerHTML = '';
});

document.querySelectorAll('input[name="format"]').forEach((input) => {
  input.addEventListener('change', () => {
    saveSettings();
    void refreshSelectionSummary();
  });
});

voiceTranscriptionInput?.addEventListener('change', () => {
  saveSettings();
  void refreshSelectionSummary({ highlight: true });
});

window.exporter.onProgress((event) => {
  const phase = event.phase;

  if (phase === 'scan' || phase === 'init' || phase === 'decrypt' || phase === 'keys') {
    if (scanRunning) {
      showScanToast(
        friendlyScanTitle(event),
        friendlyScanMessage(event),
        friendlyScanNote(event)
      );
    }
    if (exportRunning) {
      const progress = computeExportTotalProgress(event);
      if (progress) {
        setProgressWithEta(progress.percent, progress.text);
      }
      if (event.message) {
        appendLog(event.message);
      }
    } else if (phase !== 'scan' && event.message) {
      appendLog(event.message);
    }
    return;
  }

  if (exportRunning && (phase === 'exporting' || phase === 'voice-transcription' || phase === 'done')) {
    const progress = computeExportTotalProgress(event);
    if (progress) {
      setProgressWithEta(progress.percent, progress.text);
    }
    if (phase === 'exporting' && event.current % 5 === 0) {
      appendLog(`已导出 ${event.current} 个会话，累计 ${formatCount(event.totalMessages)} 条消息`);
    } else if (phase === 'voice-transcription' && event.message) {
      appendLog(event.message);
    }
    return;
  }

  if (phase === 'error') {
    appendLog(`错误: ${event.message}`);
  }
});

initApp();
