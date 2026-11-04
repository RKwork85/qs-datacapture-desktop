const fs = require("fs");
const path = require("path");

/** 代码/资源根目录（打包后为 app.asar，只读） */
const APP_ROOT = path.resolve(__dirname, "..");
/** 兼容旧变量名：读取 config / ui 仍用应用根目录 */
const ROOT = APP_ROOT;
const CONFIG_PATH = path.join(APP_ROOT, "config", "default.json");

function isElectronPackaged() {
  try {
    // eslint-disable-next-line global-require
    const { app } = require("electron");
    return Boolean(app && app.isPackaged);
  } catch (_) {
    return false;
  }
}

/**
 * 可写数据根目录：
 * - 打包安装版 → %APPDATA%/qs-datacapture-desktop
 * - 开发态 → 项目根目录
 */
function getWritableRoot() {
  try {
    // eslint-disable-next-line global-require
    const { app } = require("electron");
    if (app && typeof app.getPath === "function" && app.isPackaged) {
      return app.getPath("userData");
    }
  } catch (_) {
    /* 非 Electron 环境（如独立 server） */
  }
  return APP_ROOT;
}

const WRITABLE_ROOT = getWritableRoot();
const AUTH_DIR = path.join(WRITABLE_ROOT, "auth");
const DATA_DIR = path.join(WRITABLE_ROOT, "data");
const XHS_DATA_DIR = path.join(DATA_DIR, "xhs");
const WEIBO_DATA_DIR = path.join(DATA_DIR, "weibo");
const DY_DATA_DIR = path.join(DATA_DIR, "dy");
const XHS_COOKIE_PATH = path.join(AUTH_DIR, "xhs_cookie.txt");
const WEIBO_AUTH_PATH = path.join(AUTH_DIR, "weibo_auth.json");
const DY_COOKIE_PATH = path.join(AUTH_DIR, "dy_cookie.txt");
const DY_AUTH_PATH = path.join(AUTH_DIR, "dy_auth.json");
const CONTROL_TOKEN_PATH = path.join(AUTH_DIR, "control_token.json");

/** 控制服队列、定时任务等 JSON（打包后写在 userData） */
function getControlServerDataDir() {
  return path.join(getWritableRoot(), "control-server");
}

function ensureDirs() {
  for (const dir of [
    AUTH_DIR,
    DATA_DIR,
    XHS_DATA_DIR,
    WEIBO_DATA_DIR,
    DY_DATA_DIR,
    getControlServerDataDir(),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadConfig() {
  ensureDirs();
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function stamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function nowText(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

module.exports = {
  ROOT,
  APP_ROOT,
  WRITABLE_ROOT,
  CONFIG_PATH,
  AUTH_DIR,
  DATA_DIR,
  XHS_DATA_DIR,
  WEIBO_DATA_DIR,
  DY_DATA_DIR,
  XHS_COOKIE_PATH,
  WEIBO_AUTH_PATH,
  DY_COOKIE_PATH,
  DY_AUTH_PATH,
  CONTROL_TOKEN_PATH,
  getControlServerDataDir,
  ensureDirs,
  loadConfig,
  stamp,
  nowText,
  isElectronPackaged,
  getWritableRoot,
};
