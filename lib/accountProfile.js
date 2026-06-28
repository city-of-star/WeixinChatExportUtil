const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

function getSqlJsLocateFile() {
  return (file) => {
    const candidates = [
      path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
    ];
    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', file),
        path.join(process.resourcesPath, 'app', 'node_modules', 'sql.js', 'dist', file)
      );
    }
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[0];
  };
}

let sqlEnginePromise = null;

function getSqlEngine() {
  if (!sqlEnginePromise) {
    sqlEnginePromise = initSqlJs({ locateFile: getSqlJsLocateFile() });
  }
  return sqlEnginePromise;
}

function resolveDecryptedDirOrNull(accountDir) {
  const direct = path.join(accountDir, 'db_storage_decrypted');
  if (fs.existsSync(path.join(direct, 'message')) || fs.existsSync(path.join(direct, 'contact'))) {
    return direct;
  }
  const nested = path.join(accountDir, 'db_storage', 'db_storage_decrypted');
  if (fs.existsSync(path.join(nested, 'message')) || fs.existsSync(path.join(nested, 'contact'))) {
    return nested;
  }
  return null;
}

function queryAll(db, sql) {
  const result = db.exec(sql);
  if (!result[0]) return [];
  const { columns, values } = result[0];
  return values.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

function pickField(row, names) {
  if (!row) return null;
  const keys = Object.keys(row);
  for (const name of names) {
    const found = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (found && row[found]) return String(row[found]).trim();
  }
  return null;
}

function getTableColumns(db, tableName) {
  try {
    const safeTable = tableName.replace(/"/g, '""');
    return queryAll(db, `PRAGMA table_info("${safeTable}")`).map((col) => col.name);
  } catch {
    return [];
  }
}

function buildWxidCandidates(wxid, folderName) {
  const candidates = new Set();
  for (const value of [wxid, folderName, wxid?.replace(/_c[a-f0-9]+$/i, '')]) {
    if (value) candidates.add(value);
  }
  return [...candidates];
}

function rowMatchesWxid(row, wxidCandidates, userCol, aliasCol) {
  const username = userCol ? pickField(row, [userCol]) : null;
  const alias = aliasCol ? pickField(row, [aliasCol]) : null;
  return wxidCandidates.some(
    (candidate) =>
      candidate === username ||
      candidate === alias ||
      (username && username.startsWith(`${candidate}@`)) ||
      (alias && alias.startsWith(`${candidate}@`))
  );
}

function readSelfNickFromContactDb(SQL, decryptedDir, wxid, folderName = wxid) {
  const contactDbPath = path.join(decryptedDir, 'contact', 'contact.db');
  if (!fs.existsSync(contactDbPath)) return null;

  const db = new SQL.Database(fs.readFileSync(contactDbPath));
  try {
    const columns = getTableColumns(db, 'contact');
    if (!columns.length) return null;

    const userCol = columns.find((name) => /^username$/i.test(name));
    const aliasCol = columns.find((name) => /^alias$/i.test(name));
    if (!userCol) return null;

    const wxidCandidates = buildWxidCandidates(wxid, folderName);
    const nickFields = ['remark', 'nick_name', 'nickname', 'NickName', 'Remark'];

    for (const candidate of wxidCandidates) {
      const safe = candidate.replace(/'/g, "''");
      const whereParts = [`"${userCol}" = '${safe}'`];
      if (aliasCol) {
        whereParts.push(`"${aliasCol}" = '${safe}'`);
      }
      const rows = queryAll(
        db,
        `SELECT * FROM contact WHERE ${whereParts.join(' OR ')} LIMIT 1`
      );
      const nick = pickField(rows[0], nickFields);
      if (nick) return nick;
    }

    const prefix = wxidCandidates[0]?.replace(/'/g, "''").slice(0, 12);
    if (prefix) {
      const rows = queryAll(
        db,
        `SELECT * FROM contact WHERE "${userCol}" LIKE '${prefix}%' LIMIT 50`
      );
      for (const row of rows) {
        if (!rowMatchesWxid(row, wxidCandidates, userCol, aliasCol)) continue;
        const nick = pickField(row, nickFields);
        if (nick) return nick;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function readAvatarBlobFromRow(rows) {
  const blob = rows[0]?.blob_data;
  if (!blob) return null;
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buffer.length > 32) {
    return bufferToDataUrl(buffer);
  }
  return null;
}

function readAvatarFromHeadImageDb(SQL, decryptedDir, wxid) {
  const dbPath = path.join(decryptedDir, 'head_image', 'head_image.db');
  if (!fs.existsSync(dbPath)) return null;

  const db = new SQL.Database(fs.readFileSync(dbPath));
  try {
    const tables = queryAll(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const safeWxid = wxid.replace(/'/g, "''");
    const safePrefix = safeWxid.slice(0, 12);

    for (const { name } of tables) {
      const cols = queryAll(db, `PRAGMA table_info("${name.replace(/"/g, '""')}")`);
      const colNames = cols.map((c) => c.name);
      const userCol = colNames.find((c) => /username|usrname|wxid/i.test(c));
      const blobCol = colNames.find((c) => /buf|blob|image|head|img/i.test(c) && c !== userCol);
      if (!userCol || !blobCol) continue;

      const safeTable = name.replace(/"/g, '""');
      const exactRows = queryAll(
        db,
        `SELECT "${blobCol}" AS blob_data FROM "${safeTable}" WHERE "${userCol}" = '${safeWxid}' LIMIT 1`
      );
      const exactAvatar = readAvatarBlobFromRow(exactRows);
      if (exactAvatar) return exactAvatar;

      if (safePrefix.length >= 8) {
        const prefixRows = queryAll(
          db,
          `SELECT "${blobCol}" AS blob_data FROM "${safeTable}" WHERE "${userCol}" LIKE '${safePrefix}%' LIMIT 5`
        );
        const prefixAvatar = readAvatarBlobFromRow(prefixRows);
        if (prefixAvatar) return prefixAvatar;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function bufferToDataUrl(buffer) {
  if (!buffer || buffer.length === 0) return null;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isWebp = buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP';
  const mime = isPng ? 'image/png' : isWebp ? 'image/webp' : isJpeg ? 'image/jpeg' : 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function findAvatarFile(accountDir, wxid) {
  const wxidHash = crypto.createHash('md5').update(wxid).digest('hex');
  const fileNames = [
    `${wxid}.jpg`,
    `${wxid}.png`,
    `${wxid}.webp`,
    `${wxidHash}.jpg`,
    `${wxidHash}.png`,
    `${wxidHash}.webp`,
    `${wxidHash}`,
  ];

  const dirs = [
    path.join(accountDir, 'avatar'),
    path.join(accountDir, 'head_image'),
    path.join(accountDir, 'cache', 'avatar'),
    path.join(accountDir, 'config', 'avatar'),
    path.join(accountDir, 'data', 'avatar'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fileNames) {
      const full = path.join(dir, name);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return full;
      }
    }
    try {
      const entries = fs.readdirSync(dir);
      const match = entries.find((name) => {
        const lower = name.toLowerCase();
        return (
          (lower.includes(wxid.slice(0, 8)) || lower.includes(wxidHash.slice(0, 8))) &&
          /\.(jpg|jpeg|png|webp|dat)$/i.test(lower)
        );
      });
      if (match) return path.join(dir, match);
    } catch {
      // ignore
    }
  }
  return null;
}

function readAvatarFile(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return bufferToDataUrl(buffer);
  } catch {
    return null;
  }
}

function readNickFromConfigDir(accountDir) {
  const configDir = path.join(accountDir, 'config');
  if (!fs.existsSync(configDir)) return null;

  const namePatterns = [
    /nick[_-]?name["'\s:=]+([^"'\s,}{]+)/i,
    /"nickName"\s*:\s*"([^"]+)"/i,
    /"nickname"\s*:\s*"([^"]+)"/i,
    /"displayName"\s*:\s*"([^"]+)"/i,
  ];

  try {
    const entries = fs.readdirSync(configDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(configDir, entry.name);
      const stat = fs.statSync(full);
      if (stat.size <= 0 || stat.size > 256 * 1024) continue;

      let text = '';
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!text || text.includes('\u0000')) continue;

      for (const pattern of namePatterns) {
        const match = text.match(pattern);
        if (match?.[1] && match[1].length >= 1 && match[1].length <= 32) {
          return match[1].trim();
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getPassphraseCachePath(accountDir) {
  return path.join(accountDir, '.wexin_passphrase');
}

async function enrichAccountSummary(summary) {
  const { wxid, path: accountDir, folderName } = summary;
  let displayName = readNickFromConfigDir(accountDir);
  let avatar = null;

  const decryptedDir = resolveDecryptedDirOrNull(accountDir);
  if (decryptedDir) {
    try {
      const SQL = await getSqlEngine();
      displayName =
        readSelfNickFromContactDb(SQL, decryptedDir, wxid, folderName || path.basename(accountDir)) ||
        displayName;
      avatar = readAvatarFromHeadImageDb(SQL, decryptedDir, wxid);
      if (!avatar) {
        for (const candidate of buildWxidCandidates(wxid, folderName || path.basename(accountDir))) {
          avatar = readAvatarFromHeadImageDb(SQL, decryptedDir, candidate);
          if (avatar) break;
        }
      }
    } catch {
      // ignore profile read errors
    }
  }

  if (!avatar) {
    const avatarPath = findAvatarFile(accountDir, wxid);
    if (avatarPath) {
      avatar = readAvatarFile(avatarPath);
    }
  }

  const nick = displayName || wxid;
  return {
    ...summary,
    displayName: nick,
    avatar,
    passphraseCachePath: fs.existsSync(getPassphraseCachePath(accountDir))
      ? getPassphraseCachePath(accountDir)
      : null,
    label: `${nick}${summary.description ? ` · ${summary.description}` : ''}`,
  };
}

async function enrichAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return [];
  return Promise.all(accounts.map((account) => enrichAccountSummary(account)));
}

module.exports = {
  enrichAccounts,
  enrichAccountSummary,
  getPassphraseCachePath,
};
