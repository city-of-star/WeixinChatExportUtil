const { parentPort, workerData } = require('worker_threads');

async function run() {
  const { enrichAccounts } = require('../lib/accountProfile');
  const accounts = await enrichAccounts(workerData.accounts || []);
  return { accounts };
}

run()
  .then((result) => {
    parentPort.postMessage({ type: 'done', ok: true, accounts: result.accounts });
  })
  .catch((err) => {
    parentPort.postMessage({ type: 'done', ok: false, error: err.message });
  });
