const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qsApi", {
  getConfig: () => ipcRenderer.invoke("app:getConfig"),
  getXhsAuthStatus: () => ipcRenderer.invoke("auth:xhsStatus"),
  getDyAuthStatus: () => ipcRenderer.invoke("auth:dyStatus"),
  getWeiboAuthStatus: () => ipcRenderer.invoke("auth:weiboStatus"),
  clearAuth: (platform) => ipcRenderer.invoke("auth:clear", platform),
  listWeiboRecords: () => ipcRenderer.invoke("records:listWeibo"),
  listDyRecords: () => ipcRenderer.invoke("records:listDy"),
  getDataRoots: () => ipcRenderer.invoke("records:dataRoots"),
  listDirFiles: (dirPath) => ipcRenderer.invoke("records:listDirFiles", dirPath),
  listDirEntries: (dirPath) => ipcRenderer.invoke("records:listDirEntries", dirPath),
  selectDir: () => ipcRenderer.invoke("dialog:selectDir"),
  selectFile: (filtersOrOpts) => ipcRenderer.invoke("dialog:selectFile", filtersOrOpts),
  openPath: (p) => ipcRenderer.invoke("shell:openPath", p),
  readTextFile: (filePath) => ipcRenderer.invoke("fs:readTextFile", filePath),
  readMediaDataUrl: (filePath) => ipcRenderer.invoke("fs:readMediaDataUrl", filePath),
  toFileUrl: (filePath) => ipcRenderer.invoke("fs:toFileUrl", filePath),
  browseOpen: (payload) => ipcRenderer.invoke("browse:open", payload || {}),
  listXhsRecords: () => ipcRenderer.invoke("records:listXhs"),
  listNotesInBatch: (outRoot) => ipcRenderer.invoke("records:listNotes", outRoot),
  previewBatchNotes: (outRoot) => ipcRenderer.invoke("records:previewBatch", outRoot),
  previewXlsx: (filePath) => ipcRenderer.invoke("records:previewXlsx", filePath),
  previewCsv: (filePath) => ipcRenderer.invoke("records:previewCsv", filePath),
  getDashboardStats: (rangeDays) => ipcRenderer.invoke("records:dashboard", rangeDays),
  readNoteMeta: (folder) => ipcRenderer.invoke("records:readMeta", folder),
  runTask: (type, params) => ipcRenderer.invoke("task:run", { type, params }),
  controlLogin: (payload) => ipcRenderer.invoke("control:login", payload),
  controlEnsureSession: () => ipcRenderer.invoke("control:ensureSession"),
  controlPoll: () => ipcRenderer.invoke("control:poll"),
  controlRunPending: () => ipcRenderer.invoke("control:runPending"),
  controlCreateTask: (payload) => ipcRenderer.invoke("control:createTask", payload),
  controlListTasks: (query) => ipcRenderer.invoke("control:listTasks", query || {}),
  controlConnectWs: () => ipcRenderer.invoke("control:connectWs"),
  controlListSchedules: (query) => ipcRenderer.invoke("control:listSchedules", query || {}),
  controlCreateSchedule: (payload) => ipcRenderer.invoke("control:createSchedule", payload),
  controlUpdateSchedule: (payload) => ipcRenderer.invoke("control:updateSchedule", payload),
  controlDeleteSchedule: (id) => ipcRenderer.invoke("control:deleteSchedule", id),
  controlRunSchedule: (id) => ipcRenderer.invoke("control:runSchedule", id),

  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowMaximize: () => ipcRenderer.invoke("window:maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  windowIsMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  setWindowBackground: (color) => ipcRenderer.invoke("window:setBackground", color),
  onWindowMaximizeChange: (cb) => {
    const listener = (_e, maximized) => cb(maximized);
    ipcRenderer.on("window:maximize-change", listener);
    return () => ipcRenderer.removeListener("window:maximize-change", listener);
  },
  onPaintBackground: (cb) => {
    const listener = (_e, color) => cb(color);
    ipcRenderer.on("window:paint-background", listener);
    return () => ipcRenderer.removeListener("window:paint-background", listener);
  },
  /** Windows 使用系统 titleBarOverlay，前端应隐藏自绘窗口按钮 */
  usesNativeTitleOverlay: () => process.platform === "win32",

  onLog: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on("task:log", listener);
    return () => ipcRenderer.removeListener("task:log", listener);
  },
  onControlEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on("control:event", listener);
    return () => ipcRenderer.removeListener("control:event", listener);
  },
});
