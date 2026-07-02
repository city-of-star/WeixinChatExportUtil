const fs = require('fs');
const path = require('path');

const DB_FILE_PATTERN = /\.(db|db-wal|db-shm)$/i;

function collectLatestMtimeMs(rootDir, latestMs = 0) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return latestMs;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return latestMs;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      latestMs = collectLatestMtimeMs(fullPath, latestMs);
      continue;
    }
    if (!DB_FILE_PATTERN.test(entry.name)) {
      continue;
    }
    try {
      const { mtimeMs } = fs.statSync(fullPath);
      if (mtimeMs > latestMs) {
        latestMs = mtimeMs;
      }
    } catch {
      // ignore unreadable files
    }
  }

  return latestMs;
}

function getAccountLastActivity(accountDir) {
  const roots = [
    path.join(accountDir, 'db_storage'),
    path.join(accountDir, 'db_storage_decrypted'),
    path.join(accountDir, 'db_storage', 'db_storage_decrypted'),
  ];

  let latestMs = 0;
  for (const root of roots) {
    latestMs = collectLatestMtimeMs(root, latestMs);
  }

  if (latestMs <= 0) {
    return { lastActivityAt: null, lastActivityAtIso: null };
  }

  return {
    lastActivityAt: latestMs,
    lastActivityAtIso: new Date(latestMs).toISOString(),
  };
}

module.exports = {
  getAccountLastActivity,
  collectLatestMtimeMs,
};
