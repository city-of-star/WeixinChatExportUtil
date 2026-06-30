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
  const wxDir = resolveWxDir(options.wxDir, { accountPath: options.accountPath });

  const listOnce = async () =>
    listConversations({
      wxDir,
      selfWxid: options.selfWxid || null,
      skipDecrypt: true,
      onProgress: (event) => {
        if (cancelled) return;
        postProgress(event);
      },
    });

  try {
    postProgress({ phase: 'scan', message: '正在读取会话列表…' });
    return await listOnce();
  } catch (firstErr) {
    if (cancelled) throw new Error('扫描已取消');

    postProgress({ phase: 'scan', message: '首次扫描需要解密，可能需要几分钟…' });
    const { ensureDecrypted } = require('../lib/decryptCore');

    await ensureDecrypted({
      wxDir,
      forceDecrypt: Boolean(options.forceDecrypt),
      loginCapture: options.loginCapture !== false,
      keysPath: options.keysPath || null,
      onProgress: (event) => {
        if (cancelled) return;
        postProgress(event);
      },
    });

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
