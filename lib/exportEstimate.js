const os = require('os');

const MIN_LEVEL = 1;
const MAX_LEVEL = 10;
const FASTEST_MULTIPLIER = 0.58;
const SLOWEST_MULTIPLIER = 1.72;

function levelToLabel(level) {
  if (level >= 9) return '很快';
  if (level >= 7) return '较快';
  if (level >= 5) return '中等';
  if (level >= 3) return '偏慢';
  return '较慢';
}

function levelToMultiplier(level) {
  const clamped = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
  return SLOWEST_MULTIPLIER - ((clamped - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)) * (SLOWEST_MULTIPLIER - FASTEST_MULTIPLIER);
}

function computePerfLevel(cores, model) {
  let level = 4;

  if (cores >= 24) level += 4;
  else if (cores >= 16) level += 3;
  else if (cores >= 12) level += 2;
  else if (cores >= 8) level += 1;
  else if (cores >= 6) level += 0;
  else if (cores >= 4) level -= 1;
  else level -= 2;

  if (/threadripper|xeon.*(gold|platinum)|epyc|ultra 9|m4 max|m3 max|i9-1[45]|ryzen 9 79|ryzen 9 99/.test(model)) {
    level += 4;
  } else if (/i9|ryzen 9|ultra 7|m4 pro|m3 pro|m4 |m3 /.test(model)) {
    level += 3;
  } else if (/i7-1[34]|i7-12|ryzen 7 [579]|ryzen 7 5|ryzen 7 7|xeon|m2 pro|m1 pro|m2 |m1 max/.test(model)) {
    level += 2;
  } else if (/i7|ryzen 7|m1 /.test(model)) {
    level += 1;
  } else if (/i5-1[34]|i5-13|i5-12|ryzen 5 7|ryzen 5 6|ryzen 5 5/.test(model)) {
    level += 1;
  } else if (/i5|ryzen 5|core i5/.test(model)) {
    level += 0;
  } else if (/i3|ryzen 3|athlon|pentium|celeron/.test(model)) {
    level -= 2;
  }

  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
}

function getPerfProfile() {
  const cpus = os.cpus() || [];
  const cores = cpus.length || 4;
  const model = (cpus[0]?.model || '').toLowerCase();
  const level = computePerfLevel(cores, model);

  return {
    cores,
    model: cpus[0]?.model || '',
    level,
    levelLabel: levelToLabel(level),
    multiplier: levelToMultiplier(level),
  };
}

function roundDurationSec(sec) {
  if (sec < 60) {
    return Math.max(5, Math.round(sec / 5) * 5);
  }
  if (sec < 3600) {
    return Math.max(60, Math.round(sec / 30) * 30);
  }
  return Math.round(sec / 60) * 60;
}

function formatDurationSec(sec) {
  const rounded = roundDurationSec(sec);
  if (rounded < 60) {
    return `${rounded} 秒`;
  }
  if (rounded < 3600) {
    const min = Math.round(rounded / 60);
    return `${Math.max(1, min)} 分钟`;
  }
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.round((rounded % 3600) / 60);
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function formatDurationRange(minSec, maxSec) {
  const lo = Math.max(1, minSec);
  const hi = Math.max(lo + 1, maxSec);
  if (roundDurationSec(lo) === roundDurationSec(hi)) {
    return `约 ${formatDurationSec(lo)}`;
  }
  return `约 ${formatDurationSec(lo)}–${formatDurationSec(hi)}`;
}

function formatRemaining(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 20) {
    return '即将完成';
  }
  if (seconds < 120) {
    const rounded = Math.max(20, Math.round(seconds / 10) * 10);
    return `约还需 ${rounded} 秒`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `约还需 ${minutes} 分钟`;
}

function estimateExportDuration({
  messageCount = 0,
  conversationCount = 0,
  voiceCount = 0,
  formatCount = 1,
  voiceTranscription = false,
  perfProfile = getPerfProfile(),
  learned = null,
}) {
  if (messageCount <= 0 || conversationCount <= 0) {
    return {
      minSec: 0,
      maxSec: 0,
      rangeText: '',
      summaryText: '',
      voiceNote: null,
      perfLevel: perfProfile?.level ?? null,
    };
  }

  const mult = perfProfile?.multiplier ?? 1;
  const formatMult = 1 + Math.max(0, formatCount - 1) * 0.22;
  const initSec = 5 * mult;
  const convOverhead = conversationCount * 0.35 * mult;

  let messagesPerSec = learned?.messagesPerSec ?? 520 / mult;
  messagesPerSec = Math.max(80, Math.min(2000, messagesPerSec));

  const exportBodySec = (messageCount / messagesPerSec) * formatMult + convOverhead;
  let minSec = initSec + exportBodySec * 0.75;
  let maxSec = initSec + exportBodySec * 1.35;

  let voiceNote = null;

  if (voiceTranscription && voiceCount > 0) {
    const modelLoadMin = 12 * mult;
    const modelLoadMax = 35 * mult;
    const baseSecPerVoice = learned?.secPerVoice ?? 7.5 * mult;
    const secPerVoiceLo = baseSecPerVoice * 0.65;
    const secPerVoiceHi = baseSecPerVoice * 1.85;
    const voiceMin = modelLoadMin + voiceCount * secPerVoiceLo;
    const voiceMax = modelLoadMax + voiceCount * secPerVoiceHi;
    minSec += voiceMin;
    maxSec += voiceMax * 1.2;
    voiceNote = `含约 ${voiceCount.toLocaleString('zh-CN')} 条语音；首次转写较慢，已有缓存时会明显更快`;
  } else if (voiceTranscription) {
    voiceNote = '当前选择无语音消息，转写不会增加耗时';
  }

  const rangeText = formatDurationRange(minSec, maxSec);
  const level = perfProfile?.level ?? 5;
  const levelLabel = perfProfile?.levelLabel || levelToLabel(level);

  return {
    minSec,
    maxSec,
    rangeText,
    summaryText: `预计导出 ${rangeText}（运算速度 ${level}/10 级 · ${levelLabel}）`,
    voiceNote,
    perfLevel: level,
  };
}

function recordExportSample(previous, sample) {
  const { durationSec, messageCount, voiceCount, voiceTranscription } = sample;
  if (!durationSec || durationSec < 3 || messageCount <= 0) {
    return previous || null;
  }

  const alpha = 0.35;
  const next = { ...(previous || {}) };

  const voicePortion =
    voiceTranscription && voiceCount > 0 ? Math.min(durationSec * 0.9, voiceCount * 15 + 20) : 0;
  const exportPortion = Math.max(1, durationSec - voicePortion);

  if (messageCount > 0) {
    const observedMps = messageCount / exportPortion;
    next.messagesPerSec = previous?.messagesPerSec
      ? previous.messagesPerSec * (1 - alpha) + observedMps * alpha
      : observedMps;
  }

  if (voiceTranscription && voiceCount > 0) {
    const voiceOnly = Math.max(1, voicePortion - 15);
    const observedSpv = voiceOnly / voiceCount;
    next.secPerVoice = previous?.secPerVoice
      ? previous.secPerVoice * (1 - alpha) + observedSpv * alpha
      : observedSpv;
  }

  next.updatedAt = new Date().toISOString();
  next.sampleCount = (previous?.sampleCount || 0) + 1;
  return next;
}

module.exports = {
  getPerfProfile,
  computePerfLevel,
  levelToLabel,
  levelToMultiplier,
  estimateExportDuration,
  formatDurationRange,
  formatRemaining,
  recordExportSample,
};
