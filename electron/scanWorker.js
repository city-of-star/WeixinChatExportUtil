const { parentPort, workerData } = require('worker_threads');

let cancelled = false;

parentPort.on('message', (msg) => {
  if (msg?.type === 'cancel') {
    cancelled = true;
  }
});

function postProgress(event) {
  parentPort.postMessage({ type: 'progress', event });
}

async function scanConversations(options) {
  const { resolveWxDir, listConversations } = require('../lib/exportCore');
  const { needsDecrypt, ensureDecrypted, hasDecryptedStorage } = require('../lib/decryptCore');
  const wxDir = resolveWxDir(options.wxDir, { accountPath: options.accountPath });
  const forceDecrypt = Boolean(options.forceDecrypt);

  const listOnce = async () =>
    listConversations({
      wxDir,
      selfWxid: options.selfWxid || null,
      skipDecrypt: true,
      incrementalBase: options.incrementalBase || null,
      forceFullScan: forceDecrypt,
      onProgress: (event) => {
        if (cancelled) return;
        postProgress(event);
      },
    });

  const decryptOptions = {
    wxDir,
    forceDecrypt,
    loginCapture: options.loginCapture !== false,
    keysPath: options.keysPath || null,
    onProgress: (event) => {
      if (cancelled) return;
      postProgress(event);
    },
  };

  if (needsDecrypt(wxDir, forceDecrypt)) {
    if (hasDecryptedStorage(wxDir)) {
      postProgress({ phase: 'scan', message: '检测到微信数据有更新，正在同步…' });
    } else {
      postProgress({ phase: 'scan', message: '首次扫描需要解密，可能需要几分钟…' });
    }

    await ensureDecrypted(decryptOptions);
    if (cancelled) throw new Error('扫描已取消');
  }

  postProgress({ phase: 'scan', message: '正在读取会话列表…' });

  try {
    return await listOnce();
  } catch (firstErr) {
    if (cancelled) throw new Error('扫描已取消');
    if (!hasDecryptedStorage(wxDir)) {
      throw firstErr;
    }

    postProgress({ phase: 'scan', message: '读取失败，正在重新解密…' });
    await ensureDecrypted({ ...decryptOptions, forceDecrypt: true });
    if (cancelled) throw new Error('扫描已取消');

    postProgress({ phase: 'scan', message: '解密完成，正在统计会话…' });
    return listOnce();
  }
}

async function run() {
  const { options } = workerData;
  const result = await scanConversations(options);
  return result;
}

run()
  .then((result) => {
    if (cancelled) {
      parentPort.postMessage({ type: 'done', ok: false, error: '扫描已取消', cancelled: true });
      return;
    }
    parentPort.postMessage({ type: 'done', ok: true, ...result });
  })
  .catch((err) => {
    parentPort.postMessage({
      type: 'done',
      ok: false,
      error: err.message,
      cancelled: cancelled || err.message === '扫描已取消',
    });
  });
