const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const {
  loadConfig,
  CONTROL_TOKEN_PATH,
  ensureDirs,
  ROOT,
  DATA_DIR,
  XHS_DATA_DIR,
  WEIBO_DATA_DIR,
  DY_DATA_DIR,
} = require("../core/paths");
const { startControlServer, isControlServerUp } = require("../server/index");
// 尽早固定 Playwright 浏览器目录（打包后写到 userData，勿写入 asar）
require("../core/pw-env").setupPlaywrightBrowsersPath();
function getHistory() {
  return require("../core/history");
}
function getRunTask() {
  return require("./task-runner").runTask;
}

let mainWindow = null;
let busy = false;
let ws = null;

/** 与 UI --bg-base 同步，减少无边框窗口缩放时的黑边闪烁 */
const WIN_BG_LIGHT = "#f5f8ff";
const WIN_BG_DARK = "#0f172a";
let windowBg = WIN_BG_LIGHT;

if (process.platform === "win32") {
  // 关闭易导致缩放黑边/遮挡错误的特性
  app.commandLine.appendSwitch(
    "disable-features",
    "CalculateNativeWinOcclusion,SpareRendererForSitePerProcess"
  );
}

function sendLog(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("task:log", payload);
  }
}

function sendControlEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("control:event", payload);
  }
}

function applyWindowBackground(color) {
  const next = String(color || "").trim() || WIN_BG_LIGHT;
  windowBg = next;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setBackgroundColor(next);
    } catch (_) {
      /* ignore */
    }
    // 同步原生标题栏覆盖层颜色（Win），避免缩放时露黑
    try {
      if (process.platform === "win32" && typeof mainWindow.setTitleBarOverlay === "function") {
        mainWindow.setTitleBarOverlay({
          color: next,
          symbolColor: next.toLowerCase() === WIN_BG_DARK.toLowerCase() ? "#e2e8f0" : "#334155",
          height: 40,
        });
      }
    } catch (_) {
      /* ignore */
    }
  }
}

function createWindow() {
  const isWin = process.platform === "win32";
  /** Windows：用系统标题栏覆盖层代替自绘关闭按钮，彻底规避 frameless 拉伸黑边 */
  const iconPath = path.join(ROOT, "build", "icon.ico");
  const winOpts = {
    width: 1320,
    height: 880,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: windowBg,
    show: false,
    hasShadow: true,
    autoHideMenuBar: true,
    title: "轻采QS",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  };
  if (isWin) {
    Object.assign(winOpts, {
      frame: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: windowBg,
        symbolColor: "#334155",
        height: 40,
      },
      thickFrame: true,
      roundedCorners: true,
    });
  } else {
    Object.assign(winOpts, {
      frame: false,
      thickFrame: true,
    });
  }
  mainWindow = new BrowserWindow(winOpts);
  const reveal = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    applyWindowBackground(windowBg);
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  mainWindow.once("ready-to-show", reveal);
  // 部分环境下 ready-to-show 不触发，加载完成或超时后强制显示
  mainWindow.webContents.once("did-finish-load", () => {
    reveal();
  });
  mainWindow.webContents.once("did-fail-load", (_e, code, desc, url) => {
    console.error("页面加载失败:", code, desc, url);
    reveal();
  });
  // 兜底显示：过久不触发 ready-to-show 时仍打开窗口（懒加载后通常更快）
  setTimeout(reveal, 800);
  // 缩放过程中持续刷背景色，并通知渲染进程同步铺底
  const paintBg = () => {
    applyWindowBackground(windowBg);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:paint-background", windowBg);
    }
  };
  mainWindow.on("will-resize", paintBg);
  mainWindow.on("resize", paintBg);
  mainWindow.on("maximize", () => {
    paintBg();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:maximize-change", true);
    }
  });
  mainWindow.on("unmaximize", () => {
    paintBg();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:maximize-change", false);
    }
  });

  const uiDist = path.join(ROOT, "ui", "dist", "index.html");
  const useDevServer = process.env.QS_UI_DEV === "1";
  if (useDevServer) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else if (fs.existsSync(uiDist)) {
    mainWindow.loadFile(uiDist);
  } else {
    mainWindow.loadFile(path.join(ROOT, "renderer", "index.html"));
  }
}

function loadControlToken() {
  ensureDirs();
  if (!fs.existsSync(CONTROL_TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONTROL_TOKEN_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveControlToken(data) {
  ensureDirs();
  fs.writeFileSync(CONTROL_TOKEN_PATH, JSON.stringify(data, null, 2), "utf8");
}

async function executeAndMaybeReport(type, params, taskId) {
  if (busy) throw new Error("已有任务在执行，请稍候");
  busy = true;
  try {
    const result = await getRunTask()(type, params, (log) => sendLog(log));
    try {
      getHistory().recordFromTask(type, params, result);
    } catch (_) {
      /* ignore history write errors */
    }
    if (taskId) await reportResult(taskId, "done", result, "");
    return result;
  } catch (e) {
    try {
      getHistory().recordTaskFailure(type, params, e.message || e);
    } catch (_) {
      /* ignore */
    }
    if (taskId) await reportResult(taskId, "failed", null, String(e.message || e));
    throw e;
  } finally {
    busy = false;
  }
}

async function reportResult(taskId, status, result, error) {
  const tokenData = loadControlToken();
  if (!tokenData?.token) return;
  const cfg = loadConfig();
  try {
    await fetch(`${cfg.server.url}/api/agent/result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.token}`,
      },
      body: JSON.stringify({ taskId, status, result, error }),
    });
  } catch (e) {
    sendLog({ level: "warn", message: `[控制服] 上报失败: ${e.message || e}` });
  }
}

/** @returns {Promise<boolean>} 是否实际领取并执行了一个任务 */
async function pollOnce() {
  const tokenData = loadControlToken();
  if (!tokenData?.token || busy) return false;
  const cfg = loadConfig();
  try {
    const resp = await fetch(`${cfg.server.url}/api/agent/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.token}`,
      },
      body: JSON.stringify({ clientId: tokenData.username || "desktop" }),
    });
    const data = await resp.json();
    sendControlEvent({ type: "poll", data });
    if (data?.task?.id && data.task.type) {
      sendLog({
        level: "info",
        message: `[控制服] 领取任务 ${data.task.type} (${data.task.id})`,
      });
      await executeAndMaybeReport(data.task.type, data.task.params || {}, data.task.id);
      return true;
    }
    return false;
  } catch (e) {
    sendControlEvent({ type: "poll-error", error: String(e.message || e) });
    return false;
  }
}

function connectWs() {
  const tokenData = loadControlToken();
  const cfg = loadConfig();
  if (!tokenData?.token) return { ok: false, error: "未登录控制服" };
  try {
    const WebSocket = require("ws");
    if (ws) {
      try {
        ws.close();
      } catch (_) {
        /* ignore */
      }
    }
    const url = `${cfg.server.wsUrl}?token=${encodeURIComponent(tokenData.token)}`;
    ws = new WebSocket(url);
    ws.on("open", () => sendControlEvent({ type: "ws", status: "open" }));
    ws.on("close", () => sendControlEvent({ type: "ws", status: "closed" }));
    ws.on("error", (err) =>
      sendControlEvent({ type: "ws", status: "error", error: String(err.message || err) })
    );
    ws.on("message", async (buf) => {
      let msg = null;
      try {
        msg = JSON.parse(String(buf));
      } catch {
        return;
      }
      sendControlEvent({ type: "ws-message", msg });
      // 普通入队仍手动执行；定时任务触发后自动领取对应 task
      if (msg?.event === "schedule.fired" && msg?.task?.id) {
        try {
          await pollOncePrefer(msg.task.id);
        } catch (e) {
          sendLog({
            level: "error",
            message: `[定时] 自动执行失败: ${e.message || e}`,
          });
        }
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** 优先领取指定 taskId（定时触发），否则走普通 poll */
async function pollOncePrefer(taskId) {
  const tokenData = loadControlToken();
  if (!tokenData?.token || busy) return false;
  const cfg = loadConfig();
  try {
    const resp = await fetch(`${cfg.server.url}/api/agent/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.token}`,
      },
      body: JSON.stringify({
        clientId: tokenData.username || "desktop",
        taskId: taskId || "",
      }),
    });
    const data = await resp.json();
    sendControlEvent({ type: "poll", data });
    if (data?.task?.id && data.task.type) {
      sendLog({
        level: "info",
        message: `[定时] 领取任务 ${data.task.type} (${data.task.id})`,
      });
      await executeAndMaybeReport(data.task.type, data.task.params || {}, data.task.id);
      return true;
    }
    return false;
  } catch (e) {
    sendControlEvent({ type: "poll-error", error: String(e.message || e) });
    return false;
  }
}

async function controlFetch(pathname, { method = "GET", body } = {}) {
  const tokenData = loadControlToken();
  if (!tokenData?.token) return { ok: false, error: "未登录控制服" };
  const cfg = loadConfig();
  try {
    const resp = await fetch(`${cfg.server.url}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.token}`,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    return await resp.json();
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

app.whenReady().then(async () => {
  try {
    ensureDirs();
    const embed = await startControlServer();
    if (!embed.ok) {
      console.warn("[control-server] 内嵌启动失败:", embed.error || embed);
    }
    createWindow();
  } catch (err) {
    const msg = String((err && err.stack) || err);
    console.error("启动失败:", msg);
    dialog.showErrorBox("启动失败", msg.slice(0, 1800));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (ws) {
    try {
      ws.close();
    } catch (_) {
      /* ignore */
    }
  }
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("app:getConfig", () => loadConfig());

ipcMain.handle("auth:xhsStatus", () => {
  try {
    // 只加载 auth，避免顺带拉起采集模块 / Playwright
    return require("../core/xhs/auth").getCookieStatus();
  } catch (e) {
    return { hasCookie: false, ready: false, missing: [], error: String(e.message || e) };
  }
});

ipcMain.handle("auth:dyStatus", () => {
  try {
    return require("../core/dy/auth").getCookieStatus();
  } catch (e) {
    return { hasCookie: false, ready: false, missing: [], error: String(e.message || e) };
  }
});

ipcMain.handle("auth:weiboStatus", () => {
  try {
    return require("../core/weibo/auth").getAuthStatus();
  } catch (e) {
    return { hasAuth: false, ready: false, error: String(e.message || e) };
  }
});

ipcMain.handle("auth:clear", (_e, platform) => {
  try {
    const site = platform === "dy" ? "dy" : platform === "weibo" ? "weibo" : "xhs";
    if (site === "dy") return require("../core/dy/auth").clearLocalAuth();
    if (site === "weibo") return require("../core/weibo/auth").clearLocalAuth();
    return require("../core/xhs/auth").clearLocalAuth();
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle("records:listWeibo", () => {
  try {
    return require("../core/weibo/tasks").listWeiboDataFiles();
  } catch (e) {
    return { hot: [], detail: [], comment: [], xlsx: [], error: String(e.message || e) };
  }
});

ipcMain.handle("records:dataRoots", () => {
  ensureDirs();
  return {
    root: DATA_DIR,
    xhs: XHS_DATA_DIR,
    weibo: WEIBO_DATA_DIR,
    dy: DY_DATA_DIR,
  };
});

ipcMain.handle("records:listDirFiles", (_e, dirPath) => {
  try {
    const dir = String(dirPath || "").trim();
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return { ok: false, error: "目录不存在", files: [] };
    }
    const allow = new Set([".csv", ".xlsx", ".xls", ".json", ".txt", ".md", ".log"]);
    const files = fs
      .readdirSync(dir)
      .map((name) => {
        const full = path.join(dir, name);
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          return null;
        }
        if (!st.isFile()) return null;
        const ext = path.extname(name).toLowerCase();
        if (!allow.has(ext)) return null;
        return { name, path: full, mtime: st.mtimeMs, size: st.size };
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    return { ok: true, dir, files };
  } catch (e) {
    return { ok: false, error: String(e.message || e), files: [] };
  }
});

/** 工作区树：列出子目录与文件（一层，按需展开；异步避免卡死主进程） */
ipcMain.handle("records:listDirEntries", async (_e, dirPath) => {
  try {
    const dir = String(dirPath || "").trim();
    if (!dir) return { ok: false, error: "目录不存在", entries: [] };
    let stRoot;
    try {
      stRoot = await fs.promises.stat(dir);
    } catch {
      return { ok: false, error: "目录不存在", entries: [] };
    }
    if (!stRoot.isDirectory()) return { ok: false, error: "目录不存在", entries: [] };

    const skip = new Set(["node_modules", ".git", ".vendor", "__pycache__", ".venv", "dist", "out"]);
    const MAX_ENTRIES = 400;
    let names = [];
    try {
      names = await fs.promises.readdir(dir);
    } catch (e) {
      return { ok: false, error: String(e.message || e), entries: [] };
    }

    const entries = [];
    for (const name of names) {
      if (skip.has(name)) continue;
      if (entries.length >= MAX_ENTRIES) break;
      const full = path.join(dir, name);
      let st;
      try {
        st = await fs.promises.lstat(full);
      } catch {
        continue;
      }
      // 跳过坏链/重解析点，避免目录遍历卡死
      if (st.isSymbolicLink()) continue;
      entries.push({
        name,
        path: full,
        isDir: st.isDirectory(),
        mtime: st.mtimeMs,
        size: st.isFile() ? st.size : 0,
      });
    }
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
    return {
      ok: true,
      dir,
      entries,
      truncated: names.length > entries.length + skip.size,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), entries: [] };
  }
});

ipcMain.handle("records:listDy", () => {
  try {
    return getHistory().listDyRecords();
  } catch (e) {
    return { batches: [], publishNotes: [], publishVideos: [], error: String(e.message || e) };
  }
});

ipcMain.handle("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.handle("window:maximize", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
ipcMain.handle("window:isMaximized", () =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false
);
ipcMain.handle("window:setBackground", (_e, color) => {
  applyWindowBackground(color);
  return { ok: true, color: windowBg };
});

ipcMain.handle("dialog:selectDir", async () => {
  // 无边框窗口下挂 parent 偶发模态死锁；不传 parent 更稳
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return "";
  return result.filePaths[0];
});

ipcMain.handle("dialog:selectFile", async (_e, filtersOrOpts) => {
  const opts =
    filtersOrOpts && !Array.isArray(filtersOrOpts) && typeof filtersOrOpts === "object"
      ? filtersOrOpts
      : { filters: filtersOrOpts };
  const filters = opts.filters || [{ name: "All", extensions: ["*"] }];
  const defaultPath = String(opts.defaultPath || "").trim();
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters,
    ...(defaultPath ? { defaultPath } : {}),
  });
  if (result.canceled || !result.filePaths[0]) return "";
  return result.filePaths[0];
});

ipcMain.handle("shell:openPath", async (_e, p) => shell.openPath(p));

ipcMain.handle("fs:readTextFile", async (_e, filePath) => {
  try {
    const target = String(filePath || "").trim();
    if (!target) return { ok: false, error: "未指定文件路径" };
    if (!fs.existsSync(target)) return { ok: false, error: `文件不存在：${target}` };
    const st = fs.statSync(target);
    if (!st.isFile()) return { ok: false, error: "路径不是文件" };
    if (st.size > 8 * 1024 * 1024) return { ok: false, error: "文件过大（>8MB），请用系统程序打开" };
    const content = fs.readFileSync(target, "utf8");
    return { ok: true, content, path: target };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

const MEDIA_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".m4v": "video/x-m4v",
};

/** 图片转 data URL（侧栏预览）；过大则拒绝 */
ipcMain.handle("fs:readMediaDataUrl", async (_e, filePath) => {
  try {
    const target = String(filePath || "").trim();
    if (!target) return { ok: false, error: "未指定文件路径" };
    if (!fs.existsSync(target)) return { ok: false, error: `文件不存在：${target}` };
    const st = fs.statSync(target);
    if (!st.isFile()) return { ok: false, error: "路径不是文件" };
    const ext = path.extname(target).toLowerCase();
    const mime = MEDIA_MIME[ext];
    if (!mime || !mime.startsWith("image/")) {
      return { ok: false, error: "仅支持图片预览为 data URL" };
    }
    if (st.size > 12 * 1024 * 1024) {
      return { ok: false, error: "图片过大（>12MB），请用系统程序打开" };
    }
    const buf = fs.readFileSync(target);
    return {
      ok: true,
      path: target,
      mime,
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      size: st.size,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

/** 本地媒体 file:// URL（视频预览） */
ipcMain.handle("fs:toFileUrl", async (_e, filePath) => {
  try {
    const { pathToFileURL } = require("url");
    const target = String(filePath || "").trim();
    if (!target) return { ok: false, error: "未指定文件路径" };
    if (!fs.existsSync(target)) return { ok: false, error: `文件不存在：${target}` };
    return { ok: true, path: target, url: pathToFileURL(target).href };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle("browse:open", async (_e, payload = {}) => {
  try {
    const browse = require("../core/browse");
    const result = await browse.openWithCookie({
      platform: payload.platform || "xhs",
      url: payload.url || "",
      onLog: (log) => sendLog(log),
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle("records:listXhs", () => {
  try {
    return getHistory().listXhsRecords();
  } catch (e) {
    return {
      history: [],
      collects: [],
      batches: [],
      publishNotes: [],
      publishVideos: [],
      error: String(e.message || e),
    };
  }
});
ipcMain.handle("records:listNotes", (_e, outRoot) => {
  try {
    return getHistory().listNotesInBatch(outRoot || "");
  } catch (e) {
    return [];
  }
});
ipcMain.handle("records:previewBatch", (_e, outRoot) => {
  try {
    return { ok: true, rows: getHistory().previewBatchNotes(outRoot || "") };
  } catch (e) {
    return { ok: false, rows: [], error: String(e.message || e) };
  }
});
ipcMain.handle("records:previewXlsx", async (_e, filePath) => {
  try {
    const data = await getHistory().previewXlsxFile(filePath || "");
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, headers: [], rows: [], error: String(e.message || e) };
  }
});
ipcMain.handle("records:previewCsv", async (_e, filePath) => {
  try {
    const data = getHistory().previewCsvFile(filePath || "");
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, headers: [], rows: [], error: String(e.message || e) };
  }
});
ipcMain.handle("records:dashboard", (_e, rangeDays) => {
  try {
    return getHistory().getDashboardStats({ rangeDays: Number(rangeDays) || 7 });
  } catch (e) {
    return {
      error: String(e.message || e),
      kpis: {
        todayCollect: 0,
        todayCollectTrend: 0,
        todayNotePub: 0,
        todayVideoPub: 0,
        todayPubTrend: 0,
        totalLikes: 0,
        likesTrend: 0,
        successRate: 100,
        successTrend: 0,
      },
      trend: [],
      statusPie: [{ name: "暂无任务", value: 1, color: "#bfdbfe" }],
      timeline: [],
      rangeDays: Number(rangeDays) || 7,
    };
  }
});
ipcMain.handle("records:readMeta", (_e, folder) => {
  const meta = getHistory().readMeta(folder || "");
  if (!meta) return null;
  const assets = getHistory().listNoteAssets(folder);
  return {
    ...meta,
    folder,
    imageCount: assets.images.length,
    videoCount: assets.videos.length,
    videoPath: assets.videos[0] || "",
  };
});

ipcMain.handle("task:run", async (_e, { type, params }) => {
  try {
    const result = await executeAndMaybeReport(type, params || {}, null);
    return { ok: true, result };
  } catch (e) {
    sendLog({ level: "error", message: String(e.message || e) });
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle("control:login", async (_e, { username, password }) => {
  const cfg = loadConfig();
  const resp = await fetch(`${cfg.server.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await resp.json();
  if (!data.ok) return data;
  saveControlToken({ token: data.token, username: data.username });
  connectWs();
  return data;
});

async function ensureControlServerReachable() {
  if (await isControlServerUp()) return { ok: true };
  const embed = await startControlServer();
  if (!embed.ok) {
    return { ok: false, error: embed.error || "控制服未启动" };
  }
  if (await isControlServerUp()) return { ok: true };
  return { ok: false, error: "控制服未启动或不可达，请重启应用" };
}

/** 无本地 token 时用配置默认账号自动登录控制服（调度中心已去掉账密页） */
ipcMain.handle("control:ensureSession", async () => {
  const reachable = await ensureControlServerReachable();
  if (!reachable.ok) return reachable;

  const existing = loadControlToken();
  if (existing?.token) {
    connectWs();
    return { ok: true, username: existing.username || "agent", reused: true };
  }
  const cfg = loadConfig();
  const user = (cfg.controlServer && cfg.controlServer.users && cfg.controlServer.users[0]) || null;
  if (!user || !user.username) {
    return { ok: false, error: "控制服未配置默认账号" };
  }
  try {
    const resp = await fetch(`${cfg.server.url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: user.password }),
    });
    const data = await resp.json();
    if (!data.ok) {
      return { ok: false, error: data.error || "控制服自动登录失败" };
    }
    saveControlToken({ token: data.token, username: data.username });
    connectWs();
    return { ok: true, username: data.username, reused: false };
  } catch (e) {
    return { ok: false, error: `控制服不可用: ${e.message || e}` };
  }
});

ipcMain.handle("control:poll", async () => {
  await pollOnce();
  return { ok: true };
});

/** 手动执行：循环领取并跑完当前 pending 队列 */
ipcMain.handle("control:runPending", async () => {
  const tokenData = loadControlToken();
  if (!tokenData?.token) return { ok: false, error: "未登录控制服", ran: 0 };
  if (busy) return { ok: false, error: "已有任务在执行，请稍候", ran: 0 };
  let ran = 0;
  const maxRounds = 50;
  for (let i = 0; i < maxRounds; i += 1) {
    const did = await pollOnce();
    if (!did) break;
    ran += 1;
  }
  return { ok: true, ran };
});

ipcMain.handle("control:createTask", async (_e, payload) => {
  const tokenData = loadControlToken();
  if (!tokenData?.token) return { ok: false, error: "未登录控制服" };
  const cfg = loadConfig();
  try {
    const resp = await fetch(`${cfg.server.url}/api/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenData.token}`,
      },
      body: JSON.stringify(payload || {}),
    });
    return await resp.json();
  } catch (e) {
    return { ok: false, error: `提交失败: ${e.message || e}` };
  }
});

ipcMain.handle("control:listTasks", async (_e, query) => {
  const tokenData = loadControlToken();
  if (!tokenData?.token) return { ok: false, error: "未登录控制服", tasks: [] };
  const cfg = loadConfig();
  const status = query && query.status ? String(query.status) : "";
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  try {
    const resp = await fetch(`${cfg.server.url}/api/tasks${qs}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenData.token}`,
      },
    });
    return await resp.json();
  } catch (e) {
    return { ok: false, error: `拉取队列失败: ${e.message || e}`, tasks: [] };
  }
});

ipcMain.handle("control:connectWs", () => connectWs());

ipcMain.handle("control:listSchedules", async (_e, query) => {
  const platform = query && query.platform ? String(query.platform) : "";
  const qs = platform ? `?platform=${encodeURIComponent(platform)}` : "";
  return controlFetch(`/api/schedules${qs}`);
});

ipcMain.handle("control:createSchedule", async (_e, payload) => {
  return controlFetch("/api/schedules", { method: "POST", body: payload || {} });
});

ipcMain.handle("control:updateSchedule", async (_e, payload) => {
  const id = payload && payload.id;
  if (!id) return { ok: false, error: "缺少 id" };
  const { id: _id, ...patch } = payload;
  return controlFetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });
});

ipcMain.handle("control:deleteSchedule", async (_e, id) => {
  if (!id) return { ok: false, error: "缺少 id" };
  return controlFetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
});

ipcMain.handle("control:runSchedule", async (_e, id) => {
  if (!id) return { ok: false, error: "缺少 id" };
  const res = await controlFetch(`/api/schedules/${encodeURIComponent(id)}/run`, {
    method: "POST",
    body: {},
  });
  if (res?.ok && res?.task?.id) {
    try {
      await pollOncePrefer(res.task.id);
    } catch (e) {
      return { ...res, runError: String(e.message || e) };
    }
  }
  return res;
});
