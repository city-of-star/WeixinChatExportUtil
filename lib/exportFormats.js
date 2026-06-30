const fs = require('fs');
const path = require('path');

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatMessageLine(msg) {
  const sender = msg.isSelf ? '我' : msg.senderName || msg.senderWxid || '未知';
  const time = msg.datetime || '';
  const body = msg.content || `[${msg.typeName || '消息'}]`;
  return `[${time}] ${sender}: ${body}`;
}

function writeTxtChat(chat, outFile) {
  const lines = [
    `# ${chat.displayName}`,
    `# 类型: ${chat.type === 'group' ? '群聊' : '私聊'}`,
    `# 消息数: ${chat.messageCount}`,
    '',
  ];

  for (const msg of chat.messages) {
    lines.push(formatMessageLine(msg));
  }

  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
}

function writeCsvMessages(chats, outFile) {
  const lines = ['会话,类型,时间,发送者,是否本人,消息类型,内容'];

  for (const chat of chats) {
    for (const msg of chat.messages) {
      const sender = msg.isSelf ? '我' : msg.senderName || msg.senderWxid || '';
      lines.push(
        [
          escapeCsv(chat.displayName),
          escapeCsv(chat.type === 'group' ? '群聊' : '私聊'),
          escapeCsv(msg.datetime || ''),
          escapeCsv(sender),
          escapeCsv(msg.isSelf ? '是' : '否'),
          escapeCsv(msg.typeName || ''),
          escapeCsv(msg.content || ''),
        ].join(',')
      );
    }
  }

  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
}

function splitQuoteContent(content) {
  const text = String(content ?? '');
  const idx = text.indexOf('\n↩ ');
  if (idx === -1) return null;
  const replyText = text.slice(0, idx).trim();
  const quoteLine = text.slice(idx + 1).trim();
  if (!quoteLine.startsWith('↩ ')) return null;
  return { replyText, quoteLine: quoteLine.slice(2) };
}

function isFileLikeMessage(msg) {
  if (msg.extra?.kind === 'file') return true;
  const content = String(msg.content ?? '').trim();
  if (content.startsWith('[文件]')) return true;
  if (msg.type === 3 || msg.type === 34 || msg.type === 43) return false;
  return /^[^\s/\\<>:"|?*]+\.[a-z0-9]{1,10}$/i.test(content);
}

function resolveMessageKind(msg) {
  if (msg.extra?.kind) return msg.extra.kind;
  if (splitQuoteContent(msg.content)) return 'quote_reply';
  if (isFileLikeMessage(msg)) return 'file';
  if (msg.content === '[图片]' || msg.type === 3) return 'image';
  if (msg.content === '[视频]' || msg.type === 43) return 'video';
  return null;
}

function renderQuoteBody(replyText, quoteLine) {
  const replyHtml = replyText
    ? `<div class="reply-text">${escapeHtml(replyText).replace(/\n/g, '<br>')}</div>`
    : '';
  const quoteHtml = `<div class="quote-block"><span class="quote-label">引用</span><span class="quote-content">↩ ${escapeHtml(quoteLine)}</span></div>`;
  return `${replyHtml}${quoteHtml}`;
}

function renderFileBody(title, size) {
  const sizeHtml = size
    ? `<span class="file-size">(${escapeHtml(formatFileSizeLabel(size))})</span>`
    : '';
  return `<div class="file-card"><span class="media-tag">[文件]</span><span class="file-name">${escapeHtml(title)}</span>${sizeHtml}</div>`;
}

function renderMessageBody(msg) {
  const kind = resolveMessageKind(msg);
  const isVoice = msg.type === 34 || msg.typeName === 'voice';
  const transcription = msg.extra?.transcription;

  if (isVoice && transcription) {
    const durationMs = msg.extra?.voiceDurationMs || 0;
    const label =
      durationMs > 0 ? `[语音 ${(durationMs / 1000).toFixed(1)}s]` : '[语音]';
    return `<span class="voice-label">${escapeHtml(label)}</span><span class="voice-text">${escapeHtml(transcription).replace(/\n/g, '<br>')}</span>`;
  }

  if (kind === 'quote_reply') {
    if (msg.extra?.kind === 'quote_reply') {
      const replyText = msg.extra.replyText || '';
      const quotedSender = msg.extra.quotedSenderName || '未知';
      const quotedPreview = msg.extra.quotedPreview || '';
      const quoteLine = `${quotedSender}：${quotedPreview}`;
      return renderQuoteBody(replyText, quoteLine);
    }
    const parsed = splitQuoteContent(msg.content);
    if (parsed) {
      return renderQuoteBody(parsed.replyText, parsed.quoteLine);
    }
  }

  if (kind === 'file') {
    const raw = String(msg.content ?? '').trim();
    const title =
      msg.extra?.title ||
      raw.replace(/^\[文件\]\s*/, '').replace(/\s*\([^)]+\)\s*$/, '').trim() ||
      raw;
    return renderFileBody(title, msg.extra?.size);
  }

  if (kind === 'image') {
    return `<span class="media-tag">[图片]</span>`;
  }

  if (kind === 'video') {
    return `<span class="media-tag">${escapeHtml(msg.content || '[视频]')}</span>`;
  }

  if (kind === 'link' && msg.extra?.url) {
    const title = msg.extra.title || msg.extra.url;
    return `<span class="media-tag">[链接]</span> <a class="msg-link" href="${escapeHtml(msg.extra.url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`;
  }

  if (kind === 'miniprogram') {
    const title = msg.extra?.title || msg.content.replace(/^\[小程序\]\s*/, '');
    return `<span class="media-tag">[小程序]</span> ${escapeHtml(title)}`;
  }

  return escapeHtml(msg.content || `[${msg.typeName || '消息'}]`).replace(/\n/g, '<br>');
}

function formatFileSizeLabel(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function renderHtmlMessage(msg) {
  const sender = msg.isSelf ? '我' : msg.senderName || msg.senderWxid || '未知';
  const align = msg.isSelf ? 'self' : 'other';
  const isVoice = msg.type === 34 || msg.typeName === 'voice';
  const transcription = msg.extra?.transcription;
  const kind = resolveMessageKind(msg);
  const body = renderMessageBody(msg);

  let bubbleClass = 'bubble';
  if (isVoice && transcription) bubbleClass = 'bubble bubble-voice';
  else if (kind === 'quote_reply') bubbleClass = 'bubble bubble-quote';
  else if (kind === 'file') bubbleClass = 'bubble bubble-file';
  else if (kind === 'image' || kind === 'video') bubbleClass = 'bubble bubble-media';

  return `
    <div class="msg ${align}">
      <div class="meta">${escapeHtml(msg.datetime || '')} · ${escapeHtml(sender)}</div>
      <div class="${bubbleClass}">${body}</div>
    </div>`;
}

function writeHtmlChat(chat, outFile, indexRelPath) {
  const messagesHtml = chat.messages.map(renderHtmlMessage).join('\n');
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(chat.displayName)} - 微迹导出</title>
  <style>
    :root { --green: #07c160; --bg: #f5f7fa; --card: #fff; --text: #1f2937; --muted: #6b7280; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--text); }
    header { background: linear-gradient(135deg, #07c160, #34d399); color: #fff; padding: 20px 24px; }
    header h1 { margin: 0 0 6px; font-size: 22px; }
    header p { margin: 0; opacity: 0.9; font-size: 13px; }
    .back { display: inline-block; margin-top: 10px; color: #fff; font-size: 13px; text-decoration: none; opacity: 0.85; }
    main { max-width: 860px; margin: 0 auto; padding: 20px 16px 40px; }
    .msg { margin-bottom: 14px; display: flex; flex-direction: column; }
    .msg.self { align-items: flex-end; }
    .msg.other { align-items: flex-start; }
    .meta { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
    .bubble { max-width: 78%; padding: 10px 14px; border-radius: 14px; line-height: 1.55; font-size: 14px; word-break: break-word; }
    .msg.self .bubble { background: #dcf8c6; border-bottom-right-radius: 4px; }
    .msg.other .bubble { background: var(--card); border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }
    .bubble-voice { display: flex; flex-direction: column; gap: 6px; }
    .voice-label { font-size: 12px; color: var(--muted); font-weight: 600; }
    .voice-text { font-size: 14px; line-height: 1.55; }
    .bubble-quote { display: flex; flex-direction: column; gap: 8px; }
    .reply-text { font-size: 14px; line-height: 1.55; }
    .quote-block { border-left: 3px solid #9ca3af; padding: 8px 10px; background: rgba(0,0,0,0.05); border-radius: 0 8px 8px 0; font-size: 12px; line-height: 1.5; }
    .msg.self .quote-block { background: rgba(0,0,0,0.07); }
    .quote-label { display: inline-block; font-size: 11px; color: #6b7280; font-weight: 700; letter-spacing: 0.02em; margin-bottom: 4px; }
    .quote-content { display: block; color: #374151; }
    .bubble-file, .bubble-media { padding: 10px 14px; }
    .file-card { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .media-tag { display: inline-block; font-size: 11px; font-weight: 700; color: #6b7280; letter-spacing: 0.02em; margin-right: 2px; }
    .file-icon { font-size: 16px; }
    .file-name { font-weight: 500; word-break: break-all; }
    .file-size { font-size: 12px; color: var(--muted); }
    .msg-link { color: #2563eb; text-decoration: none; }
    .msg-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(chat.displayName)}</h1>
    <p>${chat.type === 'group' ? '群聊' : '私聊'} · ${chat.messageCount} 条消息</p>
    ${indexRelPath ? `<a class="back" href="${escapeHtml(indexRelPath)}">← 返回索引</a>` : ''}
  </header>
  <main>
    ${messagesHtml}
  </main>
</body>
</html>`;

  fs.writeFileSync(outFile, html, 'utf8');
}

function writeHtmlIndex({ outputDir, selfWxid, exportedAt, conversations, chatsRelDir }) {
  const items = conversations
    .map((conv) => {
      const htmlFile = conv.files?.html || null;
      if (!htmlFile) return '';
      const href = htmlFile.replace(/\\/g, '/');
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(conv.displayName)}</a> <span class="muted">(${conv.messageCount} 条 · ${conv.type === 'group' ? '群聊' : '私聊'})</span></li>`;
    })
    .filter(Boolean)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>微迹导出索引</title>
  <style>
    body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1f2937; }
    h1 { color: #07c160; }
    .muted { color: #6b7280; font-size: 13px; }
    ul { line-height: 2; padding-left: 20px; }
    a { color: #059669; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>微迹 Wetrace 导出索引</h1>
  <p class="muted">账号 ${escapeHtml(selfWxid)} · ${escapeHtml(exportedAt)} · 共 ${conversations.length} 个会话</p>
  <ul>
    ${items}
  </ul>
</body>
</html>`;

  const indexPath = path.join(outputDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf8');
  return indexPath;
}

function writeChatFormats(chat, outputDir, formats, fileBase, indexRelPath) {
  const files = {};
  const chatsDir = path.join(outputDir, 'chats');

  if (formats.includes('json')) {
    const outFile = path.join(chatsDir, `${fileBase}.json`);
    fs.writeFileSync(outFile, JSON.stringify(chat, null, 2), 'utf8');
    files.json = path.relative(outputDir, outFile).replace(/\\/g, '/');
  }

  if (formats.includes('txt')) {
    const outFile = path.join(chatsDir, `${fileBase}.txt`);
    writeTxtChat(chat, outFile);
    files.txt = path.relative(outputDir, outFile).replace(/\\/g, '/');
  }

  if (formats.includes('html')) {
    const outFile = path.join(chatsDir, `${fileBase}.html`);
    writeHtmlChat(chat, outFile, indexRelPath);
    files.html = path.relative(outputDir, outFile).replace(/\\/g, '/');
  }

  return files;
}

module.exports = {
  writeChatFormats,
  writeCsvMessages,
  writeHtmlIndex,
  escapeHtml,
};
