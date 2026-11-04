/**
 * 打包 Windows 安装包 / 绿色版（默认走 npmmirror，避免 GitHub 超时）
 * 流程：清理 → UI 构建 → 业务 JS 混淆 → electron-builder（打入 .obf 产物）
 *
 * QS_OBFUSCATE=0  跳过混淆，打明文包（仅调试）
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

process.env.ELECTRON_MIRROR =
  process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";
process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
  "https://npmmirror.com/mirrors/electron-builder-binaries/";

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const obfDir = path.join(root, ".obf");
const builderConfigPath = path.join(root, "electron-builder.dist.json");
const unpackedAsar = path.join(
  releaseDir,
  "win-unpacked",
  "resources",
  "app.asar"
);

function cleanWinUnpacked() {
  const targets = [
    path.join(releaseDir, "win-unpacked"),
    path.join(releaseDir, "win-unpacked.tmp"),
  ];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (err) {
      const locked = fs.existsSync(unpackedAsar);
      console.error(
        "\n[dist] 无法清理旧的 release\\win-unpacked（文件被占用）。\n" +
          "常见原因：轻采QS / 旧版「QS数据采集」仍在运行，或 Cursor/资源管理器打开了 app.asar。\n" +
          "处理：关掉相关进程 → Cursor 执行 Developer: Reload Window → 手动删除 release\\win-unpacked 后重试。\n" +
          (locked ? `占用文件: ${unpackedAsar}\n` : "") +
          `原始错误: ${err.message}\n`
      );
      process.exit(1);
    }
  }
}

function writeBuilderConfig(useObf) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const build = { ...pkg.build };
  if (useObf) {
    build.files = [
      { from: ".obf/electron", to: "electron", filter: ["**/*"] },
      { from: ".obf/core", to: "core", filter: ["**/*"] },
      { from: ".obf/server", to: "server", filter: ["**/*"] },
      "ui/dist/**/*",
      "config/**/*",
      "build/icon.ico",
      "LICENSE",
      "package.json",
    ];
  }
  fs.writeFileSync(builderConfigPath, JSON.stringify(build, null, 2), "utf8");
  return builderConfigPath;
}

cleanWinUnpacked();
execSync("npm run ui:build", { stdio: "inherit", cwd: root, env: process.env });

const skipObf = process.env.QS_OBFUSCATE === "0";
if (!skipObf) {
  execSync("node scripts/obfuscate-for-dist.js", {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  if (!fs.existsSync(path.join(obfDir, "electron", "main.js"))) {
    console.error("[dist] 混淆产物缺失：.obf/electron/main.js");
    process.exit(1);
  }
} else {
  console.log("[dist] 已跳过混淆，使用明文源码打包");
}

const configPath = writeBuilderConfig(!skipObf);
try {
  execSync(`npx electron-builder --win --publish never --config "${configPath}"`, {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
} finally {
  try {
    fs.unlinkSync(builderConfigPath);
  } catch (_) {
    /* ignore */
  }
}
