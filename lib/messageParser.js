const MAX_CONTENT_LEN = 200;
const MAX_QUOTE_LEN = 80;

function extractXmlTag(xml, tag) {
  if (!xml) return '';
  const match = xml.match(
    new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>|<${tag}>([^<]*)</${tag}>`, 's')
  );
  return match ? (match[1] || match[2] || '').trim() : '';
}

function extractXmlBlock(xml, tag) {
  if (!xml) return '';
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function extractXmlAttr(xml, tag, attr) {
  if (!xml) return '';
  const tagMatch = xml.match(new RegExp(`<${tag}\\b([^>]*)/?>`, 'i'));
  if (!tagMatch) return '';
  const attrMatch = tagMatch[1].match(new RegExp(`${attr}="([^"]*)"`, 'i'));
  return attrMatch ? attrMatch[1].trim() : '';
}

function isXmlLike(content) {
  if (!content) return false;
  const trimmed = content.trim();
  return (
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<msg>') ||
    trimmed.startsWith('<msg ') ||
    (trimmed.startsWith('<') &&
      (trimmed.includes('<appmsg') ||
        trimmed.includes('<refermsg') ||
        trimmed.includes('<appattach') ||
        trimmed.includes('<voicemsg') ||
        trimmed.includes('<img')))
  );
}

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function truncate(text, maxLen = MAX_CONTENT_LEN) {
  const s = String(text ?? '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function resolveSenderName(wxid, displayName, contacts) {
  if (displayName) return displayName;
  if (wxid && contacts?.[wxid]) return contacts[wxid];
  if (wxid) return wxid;
  return '未知';
}

function quotedTypeLabel(quotedType, quotedContent) {
  const t = Number(quotedType);
  if (t === 3) return '[图片]';
  if (t === 34) return '[语音]';
  if (t === 43) return '[视频]';
  if (t === 47) return '[表情]';
  if (t === 48) return '[位置]';
  if (t === 49 || isXmlLike(quotedContent)) {
    const title = extractXmlTag(quotedContent, 'title');
    const fileext = extractXmlTag(quotedContent, 'fileext');
    const appType = extractXmlTag(quotedContent, 'type');
    if (appType === '6' || fileext) {
      return title ? `[文件] ${title}` : '[文件]';
    }
    if (title) return title;
    return '[消息]';
  }
  if (quotedContent) return truncate(quotedContent, MAX_QUOTE_LEN);
  return '[消息]';
}

function getFileExtension(name) {
  const m = String(name ?? '').match(/\.([a-z0-9]{1,10})$/i);
  return m ? m[1].toLowerCase() : '';
}

function looksLikeFilename(text) {
  const s = String(text ?? '').trim();
  if (!s || s.includes('\n') || s.includes('<') || s.includes(' ')) return false;
  if (s.length > 160) return false;
  return /^[^\s/\\<>:"|?*]+\.[a-z0-9]{1,10}$/i.test(s);
}

function hasAppMsgMarkers(content) {
  return (
    content.includes('<appmsg') ||
    content.includes('<refermsg') ||
    content.includes('<appattach')
  );
}

function parseAppMsgFromXml(content) {
  if (!content || !hasAppMsgMarkers(content)) return null;

  const appmsgBlock = extractXmlBlock(content, 'appmsg') || content;
  const attachBlock = extractXmlBlock(appmsgBlock, 'appattach');
  const appType = extractXmlTag(appmsgBlock, 'type');
  const title = extractXmlTag(appmsgBlock, 'title');
  const des = extractXmlTag(appmsgBlock, 'des');
  const url = extractXmlTag(appmsgBlock, 'url');
  const fileext = extractXmlTag(attachBlock, 'fileext') || extractXmlTag(appmsgBlock, 'fileext');
  const totallen = extractXmlTag(attachBlock, 'totallen') || extractXmlTag(appmsgBlock, 'totallen');
  const attachid = extractXmlTag(attachBlock, 'attachid');

  const referBlock = extractXmlBlock(appmsgBlock, 'refermsg');
  if (referBlock || appType === '57') {
    const refer = referBlock || '';
    const quotedContent = extractXmlTag(refer, 'content');
    const quotedFrom = extractXmlTag(refer, 'fromusr') || extractXmlTag(refer, 'chatusr');
    const quotedDisplayName = extractXmlTag(refer, 'displayname');
    const quotedType = extractXmlTag(refer, 'type');
    return {
      kind: 'quote_reply',
      replyText: title,
      quotedContent,
      quotedFrom,
      quotedDisplayName,
      quotedType,
    };
  }

  const isFile =
    appType === '6' ||
    appType === '74' ||
    Boolean(fileext) ||
    (attachid && title && (looksLikeFilename(title) || fileext));

  if (isFile) {
    return {
      kind: 'file',
      title: title || (fileext ? `未命名.${fileext}` : '未命名文件'),
      fileext,
      size: totallen ? Number(totallen) : 0,
    };
  }

  if (appType === '5') {
    return { kind: 'link', title, des, url };
  }

  if (appType === '33' || appType === '36') {
    return { kind: 'miniprogram', title, des };
  }

  if (title || des || url) {
    return { kind: 'appmsg', appType, title, des, url };
  }

  return { kind: 'appmsg_unknown', appType };
}

function parsePlainFile(type, content) {
  const trimmed = String(content ?? '').trim();
  if (!trimmed || isXmlLike(trimmed)) return null;

  if (looksLikeFilename(trimmed)) {
    return {
      kind: 'file',
      title: trimmed,
      fileext: getFileExtension(trimmed),
      size: 0,
    };
  }

  if (type === 49 && trimmed && !trimmed.includes('\n')) {
    return { kind: 'appmsg', title: trimmed };
  }

  return null;
}

function parseVoiceDurationMs(content) {
  if (!content || !content.includes('<voicemsg')) return 0;
  const match = content.match(/voicelength="(\d+)"/i);
  return match ? Number(match[1]) || 0 : 0;
}

function parseMessagePayload(type, content) {
  if (!content) {
    return { kind: 'empty', raw: content };
  }

  if (type === 34) {
    const durationMs = parseVoiceDurationMs(content);
    return { kind: 'voice', durationMs, raw: content };
  }

  if (type === 3) {
    return { kind: 'image', raw: content };
  }

  if (type === 43) {
    const playLength = extractXmlAttr(content, 'videomsg', 'playlength');
    return { kind: 'video', playLength: playLength ? Number(playLength) : 0, raw: content };
  }

  if (type === 47) {
    return { kind: 'emoji', raw: content };
  }

  if (type === 48) {
    const label = extractXmlAttr(content, 'location', 'label') || extractXmlAttr(content, 'location', 'poiname');
    return { kind: 'location', label, raw: content };
  }

  const appMsg = parseAppMsgFromXml(content);
  if (appMsg) {
    return { ...appMsg, raw: content };
  }

  const plainFile = parsePlainFile(type, content);
  if (plainFile) {
    return { ...plainFile, raw: content };
  }

  if (isXmlLike(content)) {
    const title = extractXmlTag(content, 'title');
    const des = extractXmlTag(content, 'des');
    if (title || des) {
      return { kind: 'appmsg', title, des, raw: content };
    }
    return { kind: 'xml_unknown', raw: content };
  }

  return { kind: 'text', text: content, raw: content };
}

function formatFriendlyMessage(parsed, contacts = {}) {
  switch (parsed.kind) {
    case 'empty':
      return { content: '', extra: null };

    case 'voice': {
      const durationMs = parsed.durationMs || 0;
      const label =
        durationMs > 0 ? `[语音 ${(durationMs / 1000).toFixed(1)}s]` : '[语音]';
      return {
        content: label,
        extra: { kind: 'voice', voiceDurationMs: durationMs },
      };
    }

    case 'image':
      return { content: '[图片]', extra: { kind: 'image' } };

    case 'video': {
      const sec = parsed.playLength > 0 ? ` ${parsed.playLength}s` : '';
      return { content: `[视频${sec}]`, extra: { kind: 'video', playLength: parsed.playLength } };
    }

    case 'emoji':
      return { content: '[表情]', extra: { kind: 'emoji' } };

    case 'location': {
      const label = parsed.label || '未知位置';
      return { content: `[位置] ${label}`, extra: { kind: 'location', label: parsed.label } };
    }

    case 'quote_reply': {
      const replyText = parsed.replyText || '';
      const quotedSender = resolveSenderName(
        parsed.quotedFrom,
        parsed.quotedDisplayName,
        contacts
      );
      const quotedPreview = quotedTypeLabel(parsed.quotedType, parsed.quotedContent);
      const quoteLine = `↩ ${quotedSender}：${quotedPreview}`;
      const content = replyText ? `${replyText}\n${quoteLine}` : quoteLine;
      return {
        content: truncate(content, MAX_CONTENT_LEN + MAX_QUOTE_LEN),
        extra: {
          kind: 'quote_reply',
          replyText,
          quotedContent: parsed.quotedContent,
          quotedFrom: parsed.quotedFrom,
          quotedSenderName: quotedSender,
          quotedPreview,
          quotedType: parsed.quotedType,
        },
      };
    }

    case 'file': {
      const sizeLabel = parsed.size ? ` (${formatFileSize(parsed.size)})` : '';
      return {
        content: `[文件] ${parsed.title}${sizeLabel}`,
        extra: {
          kind: 'file',
          title: parsed.title,
          fileext: parsed.fileext,
          size: parsed.size,
        },
      };
    }

    case 'link': {
      const main = parsed.title || parsed.des || parsed.url || '链接';
      return {
        content: `[链接] ${main}`,
        extra: { kind: 'link', title: parsed.title, des: parsed.des, url: parsed.url },
      };
    }

    case 'miniprogram': {
      const main = parsed.title || parsed.des || '小程序';
      return {
        content: `[小程序] ${main}`,
        extra: { kind: 'miniprogram', title: parsed.title, des: parsed.des },
      };
    }

    case 'appmsg': {
      const main = parsed.title || parsed.des || parsed.url || '[应用消息]';
      return {
        content: truncate(main),
        extra: {
          kind: 'appmsg',
          appType: parsed.appType,
          title: parsed.title,
          des: parsed.des,
          url: parsed.url,
        },
      };
    }

    case 'appmsg_unknown':
    case 'xml_unknown':
      return { content: '[应用消息]', extra: { kind: parsed.kind } };

    case 'text':
    default:
      return { content: parsed.text ?? parsed.raw ?? '', extra: null };
  }
}

function enrichMessage(type, content, contacts = {}) {
  const parsed = parseMessagePayload(type, content);
  const result = formatFriendlyMessage(parsed, contacts);

  if (result.content && isXmlLike(result.content)) {
    const title = extractXmlTag(result.content, 'title');
    const des = extractXmlTag(result.content, 'des');
    result.content = title || des || '[应用消息]';
    result.extra = { ...(result.extra || {}), kind: result.extra?.kind || 'xml_fallback' };
  }

  return result;
}

module.exports = {
  enrichMessage,
  parseMessagePayload,
  formatFriendlyMessage,
  extractXmlTag,
  isXmlLike,
  formatFileSize,
  truncate,
};
