const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('exporter', {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  estimateExport: (params) => ipcRenderer.invoke('estimate-export', params),
  recordExportPerf: (sample) => ipcRenderer.invoke('record-export-perf', sample),
  detectWxPaths: () => ipcRenderer.invoke('detect-wx-paths'),
  pickDirectory: (options) => ipcRenderer.invoke('pick-directory', options),
  isDirectoryEmpty: (dirPath) => ipcRenderer.invoke('is-directory-empty', dirPath),
  pickFile: (options) => ipcRenderer.invoke('pick-file', options),
  validateWxDir: (payload) => ipcRenderer.invoke('validate-wx-dir', payload),
  enrichAccounts: (payload) => ipcRenderer.invoke('enrich-accounts', payload),
  checkWeChatStatus: (payload) => ipcRenderer.invoke('check-wechat-status', payload),
  getScanRequirements: (payload) => ipcRenderer.invoke('get-scan-requirements', payload),
  runPreflight: (payload) => ipcRenderer.invoke('run-preflight', payload),
  getLogDir: () => ipcRenderer.invoke('get-log-dir'),
  openLogDir: () => ipcRenderer.invoke('open-log-dir'),
  openUserDataDir: () => ipcRenderer.invoke('open-user-data-dir'),
  resetAccountDecryptData: (payload) => ipcRenderer.invoke('reset-account-decrypt-data', payload),
  resetAllToolTraces: (payload) => ipcRenderer.invoke('reset-all-tool-traces', payload),
  scanConversations: (options) => ipcRenderer.invoke('scan-conversations', options),
  cancelScan: () => ipcRenderer.invoke('cancel-scan'),
  loadConversationCache: (payload) => ipcRenderer.invoke('load-conversation-cache', payload),
  listConversationCaches: () => ipcRenderer.invoke('list-conversation-caches'),
  clearConversationCache: (payload) => ipcRenderer.invoke('clear-conversation-cache', payload),
  patchConversationCacheLabel: (payload) => ipcRenderer.invoke('patch-conversation-cache-label', payload),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  startExport: (options) => ipcRenderer.invoke('start-export', options),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  showErrorDialog: (options) => ipcRenderer.invoke('show-error-dialog', options),
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
});
