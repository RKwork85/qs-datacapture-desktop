/**
 * 发版混淆：把 core / electron / server 的 JS 搅乱后写入 .obf/
 * 开发目录源码保持可读；仅安装包使用混淆产物。
 *
 * 环境变量：
 *   QS_OBFUSCATE=0  跳过混淆（调试打包用）
 */
const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const root = path.resolve(__dirname, "..");
const outRoot = path.join(root, ".obf");
const SOURCE_DIRS = ["core", "electron", "server"];

const COMMON = {
  compact: true,
  simplify: true,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  renameProperties: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  target: "node",
  seed: Date.now(),
  reservedNames: [
    "^require$",
    "^module$",
    "^exports$",
    "^__dirname$",
    "^__filename$",
    "^global$",
    "^Buffer$",
    "^process$",
    "^console$",
    "^setTimeout$",
    "^setInterval$",
    "^clearTimeout$",
    "^clearInterval$",
    "^Promise$",
    "^Error$",
    "^JSON$",
    "^Math$",
    "^Date$",
    "^Array$",
    "^Object$",
    "^String$",
    "^Number$",
    "^Boolean$",
    "^RegExp$",
    "^Map$",
    "^Set$",
    "^Symbol$",
    "^parseInt$",
    "^parseFloat$",
    "^isNaN$",
    "^Infinity$",
    "^NaN$",
    "^undefined$",
    "^qsApi$",
    "^contextBridge$",
    "^ipcRenderer$",
    "^ipcMain$",
    "^BrowserWindow$",
    "^app$",
    "^shell$",
    "^dialog$",
  ],
  reservedStrings: [],
};

/** 主进程 / 采集逻辑：高强度 */
const HEAVY = {
  ...COMMON,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.85,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.35,
  stringArray: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.87,
  stringArrayIndexesType: ["hexadecimal-number"],
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function",
  stringArrayWrappersChainedCalls: true,
  stringArrayEncoding: ["base64", "rc4"],
  splitStrings: true,
  splitStringsChunkLength: 6,
  transformObjectKeys: true,
  numbersToExpressions: true,
  unicodeEscapeSequence: false,
};

/** preload：略轻，避免 contextBridge / IPC 通道名被搅翻后难排查 */
const PRELOAD = {
  ...COMMON,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ["base64"],
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: false,
  numbersToExpressions: false,
};

function listJsFiles(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.isFile() && name.name.endsWith(".js")) out.push(p);
    }
  };
  walk(abs);
  return out;
}

function ensureCleanOut() {
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
}

function obfuscateFile(absPath) {
  const rel = path.relative(root, absPath).replace(/\\/g, "/");
  const source = fs.readFileSync(absPath, "utf8");
  const isPreload = /electron\/preload\.js$/.test(rel);
  const options = isPreload ? PRELOAD : HEAVY;
  const result = JavaScriptObfuscator.obfuscate(source, options);
  const dest = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, result.getObfuscatedCode(), "utf8");
  return { rel, bytes: Buffer.byteLength(source), out: Buffer.byteLength(result.getObfuscatedCode()), heavy: !isPreload };
}

function main() {
  if (process.env.QS_OBFUSCATE === "0") {
    console.log("[obfuscate] QS_OBFUSCATE=0，跳过混淆");
    process.exit(0);
  }

  console.log("[obfuscate] 高强度混淆 → .obf/ （源码目录不改动）");
  ensureCleanOut();

  const files = SOURCE_DIRS.flatMap(listJsFiles);
  if (!files.length) {
    console.error("[obfuscate] 未找到待混淆 JS");
    process.exit(1);
  }

  let totalIn = 0;
  let totalOut = 0;
  for (const file of files) {
    const info = obfuscateFile(file);
    totalIn += info.bytes;
    totalOut += info.out;
    const tag = info.heavy ? "heavy" : "preload";
    console.log(`  [${tag}] ${info.rel}  ${info.bytes} → ${info.out} bytes`);
  }

  console.log(
    `[obfuscate] 完成 ${files.length} 个文件，${totalIn} → ${totalOut} bytes（约 ${(totalOut / Math.max(totalIn, 1)).toFixed(1)}x）`
  );
}

main();
