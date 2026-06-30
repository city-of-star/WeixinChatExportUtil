const ERROR_RULES = [
  {
    code: 'WTR-E001',
    match: (msg) =>
      /内置解密模块|wexin_hook|Hook DLL|wx_key\.dll|解密模块缺失|完整安装包|win-unpacked/i.test(msg),
    title: 'Hook 模块不可用',
    userMessage:
      '内置 Hook 模块缺失或无法加载。\n\n' +
      '请确认下载的是完整安装包；若使用文件夹版，请保留整个 win-unpacked 目录，不要只复制 exe。\n' +
      '也可尝试关闭杀毒软件后重新解压/安装。',
    suggestions: ['使用完整便携版或安装版', '保留整个程序文件夹', '检查杀毒是否删除 DLL'],
  },
  {
    code: 'WTR-E002',
    match: (msg) => /管理员|administrator|SeDebugPrivilege|admin rights/i.test(msg),
    title: '需要管理员权限',
    userMessage:
      '当前未以管理员身份运行，Hook 注入很可能失败。\n\n' +
      '请关闭本程序，右键 exe 选择「以管理员身份运行」后重试。',
    suggestions: ['右键 exe → 以管理员身份运行'],
  },
  {
    code: 'WTR-E003',
    match: (msg) =>
      /Hook 安装|install hook|Failed to open target process|Allocate trampoline|remote hook/i.test(msg),
    title: 'Hook 安装失败',
    userMessage:
      '无法向微信进程安装 Hook。\n\n' +
      '常见原因：未以管理员运行、杀毒/安全软件拦截、微信版本不兼容。\n' +
      '请关闭杀毒后，以管理员身份重试。',
    suggestions: ['管理员运行', '暂时关闭杀毒/安全软件', '确认微信为官方 PC 版'],
  },
  {
    code: 'WTR-E004',
    match: (msg) =>
      /未能获取数据库密钥|密钥提取完成:.*0\/|登录捕获未成功|自动获取密钥|Hook 已就绪.*登录/i.test(msg),
    title: '未能捕获解密密钥',
    userMessage:
      '未能获取数据库解密密钥。\n\n' +
      '请按以下步骤重试：\n' +
      '1. 右键本程序，选择「以管理员身份运行」\n' +
      '2. 扫描时若微信被重启，等「Hook 已就绪」后再点击「登录」\n' +
      '3. 登录后打开 2～3 个聊天窗口，再重新扫描',
    suggestions: ['管理员运行', 'Hook 就绪后再点登录', '登录后打开几个聊天'],
  },
  {
    code: 'WTR-E005',
    match: (msg) =>
      /解密失败|所有数据库解密失败|未找到加密的 db_storage|db_storage_decrypted/i.test(msg),
    title: '数据库解密失败',
    userMessage:
      '解密微信数据库时失败。\n\n' +
      '请确认微信已登录，并以管理员身份运行后重试。\n' +
      '若仍失败，可勾选「强制重新解密」后再扫描。',
    suggestions: ['管理员运行并重试', '微信登录后打开几个聊天', '尝试强制重新解密'],
  },
  {
    code: 'WTR-E006',
    match: (msg) => /disk I\/O|SQLITE_IOERR|SQLITE_CORRUPT|malformed|database disk image/i.test(msg),
    title: '读取会话数据库失败',
    userMessage:
      '读取或统计会话数据库时出错（常见于聊天记录很多、扫描时间很长）。\n\n' +
      '建议：关闭其他占内存的程序后重试；若曾中断过解密，请勾选「强制重新解密」后再扫描。',
    suggestions: ['释放内存后重试', '强制重新解密', '将最新诊断日志发给开发者'],
  },
  {
    code: 'WTR-E007',
    match: (msg) =>
      /路径不存在|未找到微信账号|账号目录无效|未找到 message_0|未找到 db_storage|请选择/i.test(msg),
    title: '数据目录或账号无效',
    userMessage:
      '微信数据目录或所选账号无效。\n\n' +
      '请选择 xwechat_files 目录，或包含 db_storage 的 wxid_xxx 账号文件夹，并点击正确的账号卡片。',
    suggestions: ['选择 xwechat_files 目录', '点击选择要导出的账号'],
  },
  {
    code: 'WTR-E008',
    match: (msg) => /磁盘空间|space|ENOSPC|no space/i.test(msg),
    title: '磁盘空间不足',
    userMessage:
      '磁盘剩余空间可能不足。解密会在本地额外写入一份数据库副本，请清理空间后重试。',
    suggestions: ['清理磁盘空间', '将数据目录换到空间更大的盘'],
  },
  {
    code: 'WTR-E009',
    match: (msg) => /扫描已取消|cancelled/i.test(msg),
    title: '扫描已取消',
    userMessage: '扫描已被取消。',
    suggestions: [],
  },
  {
    code: 'WTR-E010',
    match: (msg) => /扫描任务异常退出|Worker|code \d+/i.test(msg),
    title: '扫描进程异常退出',
    userMessage:
      '扫描任务意外退出，可能是内存不足或被安全软件终止。\n\n' +
      '请关闭其他程序、暂时关闭杀毒后重试，并将诊断日志发给开发者。',
    suggestions: ['释放内存', '检查杀毒软件', '发送诊断日志'],
  },
];

function classifyScanError(error, context = {}) {
  const rawMessage = error?.message || String(error || '未知错误');
  const phase = context.phase || '';
  const haystack = `${rawMessage} ${phase}`;

  for (const rule of ERROR_RULES) {
    if (rule.match(haystack, context)) {
      return {
        code: rule.code,
        title: rule.title,
        userMessage: rule.userMessage,
        suggestions: rule.suggestions,
        rawMessage: sanitizeRaw(rawMessage),
      };
    }
  }

  return {
    code: 'WTR-E099',
    title: '扫描失败',
    userMessage: rawMessage,
    suggestions: ['将诊断日志发给开发者以便排查'],
    rawMessage: sanitizeRaw(rawMessage),
  };
}

function sanitizeRaw(message) {
  return String(message || '')
    .replace(/\b[0-9a-fA-F]{64}\b/g, '[redacted-key]')
    .slice(0, 2000);
}

function buildFeedbackSummary(errorInfo, logFileName) {
  const lines = [
    `错误码：${errorInfo.code}`,
    `标题：${errorInfo.title}`,
  ];
  if (logFileName) {
    lines.push(`日志文件：${logFileName}`);
  }
  return lines.join('\n');
}

module.exports = {
  classifyScanError,
  buildFeedbackSummary,
};
