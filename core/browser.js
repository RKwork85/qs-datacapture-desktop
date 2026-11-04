const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { loadConfig, isElectronPackaged } = require("./paths");
const { setupPlaywrightBrowsersPath } = require("./pw-env");

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const WIN_CHROME_CANDIDATES = [
  () => path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  () =>
    path.join(
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
  () =>
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
];

let installPromise = null;

function findSystemChrome() {
  for (const get of WIN_CHROME_CANDIDATES) {
    try {
      const p = get();
      if (p && fs.existsSync(p)) return p;
    } catch (_) {
      /* ignore */
    }
  }
  if (process.platform === "win32") {
    try {
      const { execSync } = require("child_process");
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
        { encoding: "utf8", windowsHide: true }
      );
      const m = out.match(/REG_SZ\s+(.+\.exe)/i);
      if (m && fs.existsSync(m[1].trim())) return m[1].trim();
    } catch (_) {
      /* Chrome 未装或无注册表权限 */
    }
  }
  return null;
}

function playwrightCliPath() {
  let cli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
  if (cli.includes(`${path.sep}app.asar${path.sep}`)) {
    const unpacked = cli.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    if (fs.existsSync(unpacked)) cli = unpacked;
  }
  return cli;
}

function playwrightChromiumPath() {
  setupPlaywrightBrowsersPath();
  // eslint-disable-next-line global-require
  const { chromium } = require("playwright");
  return chromium.executablePath();
}

function isPlaywrightChromiumInstalled() {
  try {
    return fs.existsSync(playwrightChromiumPath());
  } catch (_) {
    return false;
  }
}

/**
 * 解析启动策略（不触发下载）
 * @returns {{ mode: 'chrome-channel'|'executable'|'playwright', executablePath?: string, detail: string }}
 */
function resolveBrowserStrategy(cfg = loadConfig()) {
  const custom = String(cfg.chromiumPath || "").trim();
  if (custom && fs.existsSync(custom)) {
    return { mode: "executable", executablePath: custom, detail: `配置路径 ${custom}` };
  }

  const preferSystem = cfg.useSystemChrome !== false;
  if (preferSystem) {
    const chrome = findSystemChrome();
    if (chrome) {
      return { mode: "chrome-channel", executablePath: chrome, detail: `系统 Chrome ${chrome}` };
    }
  }

  if (isPlaywrightChromiumInstalled()) {
    return {
      mode: "playwright",
      executablePath: playwrightChromiumPath(),
      detail: "Playwright Chromium（已安装）",
    };
  }

  return {
    mode: "playwright",
    detail: "Playwright Chromium（待下载）",
  };
}

function runPlaywrightInstall(onLog) {
  setupPlaywrightBrowsersPath();
  const cli = playwrightCliPath();
  if (!fs.existsSync(cli)) {
    return Promise.reject(
      new Error(`找不到 Playwright CLI：${cli}。请确认安装包内包含 playwright 依赖。`)
    );
  }

  const log = (level, message) => {
    if (typeof onLog === "function") onLog({ level, message });
    else if (level === "error") console.error(message);
    else console.log(message);
  };

  log("info", "首次使用：正在下载 Playwright Chromium 浏览器内核（仅一次，需联网）…");
  log("info", `下载目录：${process.env.PLAYWRIGHT_BROWSERS_PATH}`);

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
    };
    const child = spawn(process.execPath, [cli, "install", "chromium"], {
      env,
      windowsHide: true,
    });
    let stderr = "";
    child.stdout.on("data", (buf) => {
      const text = String(buf).trim();
      if (text) log("info", text);
    });
    child.stderr.on("data", (buf) => {
      const text = String(buf).trim();
      if (text) {
        stderr += `${text}\n`;
        log("warn", text);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && isPlaywrightChromiumInstalled()) {
        log("info", "Playwright Chromium 已就绪");
        resolve();
        return;
      }
      reject(
        new Error(
          `Playwright Chromium 下载失败（exit ${code}）。` +
            `也可安装 Google Chrome，或在配置中设置 chromiumPath。\n${stderr.slice(0, 800)}`
        )
      );
    });
  });
}

/**
 * 确保有可用浏览器：系统 Chrome / 自定义路径 / 自动下载 Playwright Chromium
 */
async function ensureBrowserReady(onLog) {
  setupPlaywrightBrowsersPath();
  const cfg = loadConfig();
  const strategy = resolveBrowserStrategy(cfg);

  if (strategy.mode === "chrome-channel" || strategy.mode === "executable") {
    return strategy;
  }

  if (isPlaywrightChromiumInstalled()) {
    return {
      mode: "playwright",
      executablePath: playwrightChromiumPath(),
      detail: "Playwright Chromium（已安装）",
    };
  }

  const auto = cfg.autoInstallPlaywrightChromium !== false;
  if (!auto) {
    throw new Error(
      "未找到可用浏览器。请安装 Google Chrome，或配置 chromiumPath，或执行 playwright install chromium。"
    );
  }

  if (!installPromise) {
    installPromise = runPlaywrightInstall(onLog).finally(() => {
      installPromise = null;
    });
  }
  await installPromise;

  return {
    mode: "playwright",
    executablePath: playwrightChromiumPath(),
    detail: "Playwright Chromium（刚下载）",
  };
}

function launchOptions(extra = {}) {
  const cfg = loadConfig();
  const baseArgs = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-restore-session-state",
  ];
  const opts = {
    headless: false,
    ...extra,
  };
  opts.args = [...new Set([...baseArgs, ...(Array.isArray(extra.args) ? extra.args : [])])];

  const strategy = resolveBrowserStrategy(cfg);
  if (strategy.mode === "chrome-channel") {
    opts.channel = "chrome";
  } else if (strategy.mode === "executable" && strategy.executablePath) {
    opts.executablePath = strategy.executablePath;
  }
  // playwright 模式不设 channel / executablePath，走默认
  return opts;
}

/**
 * @param {import('playwright').BrowserType} chromium - Playwright 的 chromium（BrowserType），不是整个 playwright 模块
 * @param {object} [extra]
 * @param {function} [onLog]
 */
async function launchChromium(chromium, extra = {}, onLog) {
  if (!chromium || typeof chromium.launch !== "function") {
    throw new Error(
      "launchChromium: 需要传入 playwright 的 chromium（BrowserType），收到的对象没有 launch 方法"
    );
  }
  const ready = await ensureBrowserReady(onLog);
  if (typeof onLog === "function") {
    onLog({ level: "info", message: `浏览器：${ready.detail}` });
  } else if (isElectronPackaged()) {
    console.log(`[browser] ${ready.detail}`);
  }
  return chromium.launch(launchOptions(extra));
}

function defaultContextOptions(extra = {}) {
  return {
    viewport: { width: 1280, height: 900 },
    userAgent: DEFAULT_UA,
    ...extra,
  };
}

module.exports = {
  DEFAULT_UA,
  launchOptions,
  launchChromium,
  defaultContextOptions,
  setupPlaywrightBrowsersPath,
  ensureBrowserReady,
  resolveBrowserStrategy,
  findSystemChrome,
};
