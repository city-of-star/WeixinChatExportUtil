const { execSync } = require('child_process');
const koffi = require('koffi');
const { WECHAT_PROCESS_NAMES } = require('./scanUtils');

const kernel32 = koffi.load('kernel32.dll');
const advapi32 = koffi.load('advapi32.dll');

const MEMORY_BASIC_INFORMATION = koffi.struct('MEMORY_BASIC_INFORMATION', {
  BaseAddress: 'uint64',
  AllocationBase: 'uint64',
  AllocationProtect: 'uint32',
  PartitionId: 'uint16',
  _pad1: 'uint16',
  RegionSize: 'uint64',
  State: 'uint32',
  Protect: 'uint32',
  Type: 'uint32',
  _pad2: 'uint32',
});

const OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
const CloseHandle = kernel32.func('CloseHandle', 'bool', ['void *']);
const ReadProcessMemory = kernel32.func(
  'ReadProcessMemory',
  'bool',
  ['void *', 'uint64', 'void *', 'uint64', 'uint64 *']
);
const VirtualQueryEx = kernel32.func(
  'VirtualQueryEx',
  'uint64',
  ['void *', 'uint64', 'void *', 'uint64']
);

const PROCESS_VM_READ = 0x0010;
const PROCESS_QUERY_INFORMATION = 0x0400;
const MEM_COMMIT = 0x1000;
const READABLE = new Set([0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]);
const MBI_SIZE = koffi.sizeof(MEMORY_BASIC_INFORMATION);

function parseTasklistForImage(imageName) {
  try {
    const output = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /FO CSV /NH`, {
      encoding: 'utf8',
    });
    const pids = [];
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      const match = line.match(/^"([^"]+)","(\d+)","([^"]+)","(\d+)","([^"]+)"/);
      if (!match) continue;
      const [, name, pidStr, , , memStr] = match;
      if (name.toLowerCase() !== imageName.toLowerCase()) continue;
      const pid = Number(pidStr);
      const mem = Number(memStr.replace(/[^\d]/g, '')) || 0;
      pids.push({ pid, memKb: mem, imageName });
    }
    return pids;
  } catch {
    return [];
  }
}

function getWeChatProcesses() {
  const all = [];
  for (const imageName of WECHAT_PROCESS_NAMES) {
    all.push(...parseTasklistForImage(imageName));
  }

  if (all.length === 0) {
    throw new Error(
      '未检测到微信进程。请先启动并登录微信 PC 版（Weixin.exe），再重试。'
    );
  }

  const dedup = new Map();
  for (const item of all) {
    dedup.set(item.pid, item);
  }

  return [...dedup.values()].sort((a, b) => b.memKb - a.memKb);
}

function getWeixinPids() {
  return getWeChatProcesses();
}

function enumRegions(processHandle) {
  const regions = [];
  let address = 0n;
  const mbiBuf = koffi.alloc('uint8', MBI_SIZE);

  while (address < 0x7fffffffffffn) {
    const result = VirtualQueryEx(processHandle, address, mbiBuf, MBI_SIZE);
    if (!result) break;

    const mbi = koffi.decode(mbiBuf, MEMORY_BASIC_INFORMATION);
    const base = BigInt(mbi.BaseAddress);
    const regionSize = BigInt(mbi.RegionSize);

    if (
      mbi.State === MEM_COMMIT &&
      READABLE.has(mbi.Protect) &&
      regionSize > 0n &&
      regionSize < 500n * 1024n * 1024n
    ) {
      regions.push({ base, size: Number(regionSize) });
    }

    const next = base + regionSize;
    if (next <= address) break;
    address = next;
  }

  return regions;
}

function readProcessMemory(processHandle, address, size) {
  const buffer = koffi.alloc('uint8', size);
  const bytesReadPtr = koffi.alloc('uint64', 1);
  const ok = ReadProcessMemory(processHandle, address, buffer, size, bytesReadPtr);
  if (!ok) return null;
  const n = Number(koffi.decode(bytesReadPtr, 'uint64'));
  if (n <= 0) return null;
  return Buffer.from(koffi.decode(buffer, 'uint8', n));
}

function openProcess(pid) {
  return OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
}

function closeProcess(handle) {
  if (handle) CloseHandle(handle);
}

function scanProcessForNeedles(pid, needles, maxRegions = Infinity) {
  const handle = openProcess(pid);
  if (!handle) {
    return { found: false, hits: 0, scannedRegions: 0 };
  }

  let hits = 0;
  let scannedRegions = 0;
  try {
    for (const region of enumRegions(handle)) {
      scannedRegions += 1;
      if (scannedRegions > maxRegions) break;
      const data = readProcessMemory(handle, region.base, region.size);
      if (!data) continue;
      for (const needle of needles) {
        if (data.indexOf(needle.value) !== -1) {
          hits += 1;
        }
      }
      if (hits > 0) break;
    }
  } finally {
    closeProcess(handle);
  }

  return { found: hits > 0, hits, scannedRegions };
}

const GetCurrentProcess = kernel32.func('GetCurrentProcess', 'void *', []);
const OpenProcessToken = advapi32.func('OpenProcessToken', 'bool', ['void *', 'uint32', 'void *']);
const GetTokenInformation = advapi32.func('GetTokenInformation', 'bool', ['void *', 'uint32', 'void *', 'uint32', 'uint32 *']);
const CloseHandleToken = kernel32.func('CloseHandle', 'bool', ['void *']);

const TOKEN_QUERY = 0x0008;
const TokenElevation = 20;

function isProcessElevatedViaToken() {
  const tokenPtr = koffi.alloc('void *', 1);
  const proc = GetCurrentProcess();
  if (!OpenProcessToken(proc, TOKEN_QUERY, tokenPtr)) return null;
  const token = koffi.decode(tokenPtr, 'void *');
  if (!token) return null;

  try {
    const elevationBuf = Buffer.alloc(4);
    const returnLengthPtr = koffi.alloc('uint32', 1);
    const ok = GetTokenInformation(token, TokenElevation, elevationBuf, 4, returnLengthPtr);
    if (!ok) return null;
    return elevationBuf.readUInt32LE(0) === 1;
  } finally {
    CloseHandleToken(token);
  }
}

function isProcessElevatedViaWhoami() {
  try {
    const out = execSync('whoami /groups', { encoding: 'utf8', timeout: 3000 });
    return /S-1-16-12288|High Mandatory Level/i.test(out);
  } catch {
    return false;
  }
}

function isProcessElevatedViaNetSession() {
  try {
    execSync('net session', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Whether the current process has an elevated (admin) token on Windows. */
function isProcessElevated() {
  if (process.platform !== 'win32') return true;

  const viaToken = isProcessElevatedViaToken();
  if (viaToken === true) return true;
  if (isProcessElevatedViaWhoami()) return true;
  if (isProcessElevatedViaNetSession()) return true;
  return false;
}

module.exports = {
  getWeChatProcesses,
  getWeixinPids,
  enumRegions,
  readProcessMemory,
  openProcess,
  closeProcess,
  scanProcessForNeedles,
  isProcessElevated,
};
