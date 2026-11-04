const fs = require("fs");
const path = require("path");
const { ensureDirs, DATA_DIR, XHS_DATA_DIR, DY_DATA_DIR, nowText } = require("./paths");

const HISTORY_PATH = path.join(DATA_DIR, "history.json");
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".m4v"]);

function readHistory() {
  ensureDirs();
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  ensureDirs();
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(list.slice(0, 300), null, 2), "utf8");
}

function appendRecord(entry) {
  const list = readHistory();
  list.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: nowText(),
    status: entry.status || "success",
    ...entry,
  });
  writeHistory(list);
  return list[0];
}

function recordFromTask(type, params, result) {
  if (!result || result.ok === false) return null;
  if (type === "xhs.fetch_profile") {
    return appendRecord({
      kind: "collect",
      workspace: "xhs",
      title: "笔记采集",
      status: "success",
      profileUrl: params?.profileUrl || result.profileUrl || "",
      count: result.count || 0,
      csvPath: result.csvPath || "",
      xlsxPath: result.xlsxPath || "",
      path: result.xlsxPath || result.csvPath || "",
    });
  }
  if (type === "xhs.fetch_media") {
    return appendRecord({
      kind: "media",
      workspace: "xhs",
      title: "媒体下载",
      status: "success",
      csvPath: params?.csvPath || "",
      count: result.count || 0,
      xlsxPath: result.xlsxPath || "",
      outRoot: result.outRoot || "",
      path: result.outRoot || result.xlsxPath || "",
    });
  }
  if (
    type === "xhs.publish_note" ||
    type === "xhs.publish_video" ||
    type === "dy.publish_note" ||
    type === "dy.publish_video"
  ) {
    const scheduled = Boolean(params?.schedule);
    const isNote = type.endsWith("publish_note");
    const workspace = String(type).split(".")[0] || "xhs";
    return appendRecord({
      kind: isNote ? "publish_note" : "publish_video",
      workspace,
      title: isNote ? "图文发布" : "视频发布",
      status: scheduled ? "scheduled" : "success",
      noteTitle: params?.title || "",
      content: String(params?.content || "").slice(0, 200),
      tags: params?.tags || "",
      scheduleTime: params?.scheduleTime || "",
      path: params?.imageDir || params?.videoPath || "",
      likes: null,
      reads: null,
    });
  }
  return null;
}

function recordTaskFailure(type, params, error) {
  const kindMap = {
    "xhs.fetch_profile": "collect",
    "xhs.fetch_media": "media",
    "xhs.publish_note": "publish_note",
    "xhs.publish_video": "publish_video",
    "xhs.login": "login",
    "dy.publish_note": "publish_note",
    "dy.publish_video": "publish_video",
    "dy.login": "login",
  };
  const kind = kindMap[type] || type;
  return appendRecord({
    kind,
    workspace: String(type).split(".")[0] || "xhs",
    title: type,
    status: "failed",
    error: String(error || "").slice(0, 300),
    noteTitle: params?.title || "",
    path: params?.imageDir || params?.videoPath || params?.csvPath || params?.profileUrl || "",
  });
}

function fileMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function dayKeyFromMs(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayKeyFromAt(at) {
  if (!at) return "";
  // "YYYY-MM-DD HH:mm:ss"
  return String(at).slice(0, 10);
}

function todayKey() {
  return dayKeyFromMs(Date.now());
}

function countCsvRows(csvPath) {
  try {
    const text = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    return Math.max(0, lines.length - 1);
  } catch {
    return 0;
  }
}

function listCollectFiles() {
  ensureDirs();
  if (!fs.existsSync(XHS_DATA_DIR)) return [];
  return fs
    .readdirSync(XHS_DATA_DIR)
    .filter((n) => n.toLowerCase().endsWith(".csv"))
    .map((n) => {
      const full = path.join(XHS_DATA_DIR, n);
      return {
        kind: "collect",
        name: n,
        path: full,
        mtime: fileMtime(full),
        count: countCsvRows(full),
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function listMediaBatches() {
  ensureDirs();
  if (!fs.existsSync(XHS_DATA_DIR)) return [];
  const names = fs.readdirSync(XHS_DATA_DIR);
  const batches = [];
  for (const n of names) {
    const full = path.join(XHS_DATA_DIR, n);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (!n.startsWith("xhs_notes_")) continue;
    const xlsxPath = path.join(XHS_DATA_DIR, `${n}.xlsx`);
    const noteDirs = fs
      .readdirSync(full)
      .map((id) => path.join(full, id))
      .filter((p) => {
        try {
          return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "meta.json"));
        } catch {
          return false;
        }
      });
    let nickname = "";
    let userId = "";
    let metaAvatar = "";
    let profileUrl = "";
    try {
      const batchMetaPath = path.join(full, "batch_meta.json");
      if (fs.existsSync(batchMetaPath)) {
        const bm = JSON.parse(fs.readFileSync(batchMetaPath, "utf8"));
        nickname = String(bm.nickname || "").trim();
        userId = String(bm.user_id || "").trim();
        profileUrl = String(bm.profile_url || "").trim();
        metaAvatar = String(bm.avatar_url || "").trim();
      }
    } catch {
      /* ignore */
    }
    if (noteDirs.length) {
      const meta = readMeta(noteDirs[0]);
      if (meta) {
        if (!nickname) nickname = String(meta.nickname || "").trim();
        if (!userId) userId = String(meta.user_id || "").trim();
        if (!metaAvatar) metaAvatar = String(meta.avatar_url || meta.avatar || "").trim();
        if (!metaAvatar) {
          const imgs = Array.isArray(meta.images) ? meta.images : [];
          metaAvatar = imgs[0] ? String(imgs[0]) : "";
        }
        if (!profileUrl && userId) profileUrl = `https://www.xiaohongshu.com/user/profile/${userId}`;
      }
    }
    if (!profileUrl) profileUrl = fieldFromSiblingCsv(XHS_DATA_DIR, n, "作者主页链接");
    const avatarUrl = resolveBatchAvatar(full, XHS_DATA_DIR, n, metaAvatar);
    batches.push({
      kind: "media",
      name: n,
      outRoot: full,
      xlsxPath: fs.existsSync(xlsxPath) ? xlsxPath : "",
      noteCount: noteDirs.length,
      mtime: st.mtimeMs,
      at: nowText(new Date(st.mtimeMs)),
      nickname,
      userId,
      avatarUrl,
      profileUrl,
    });
  }
  return batches.sort((a, b) => b.mtime - a.mtime);
}

function listDyMediaBatches() {
  ensureDirs();
  if (!fs.existsSync(DY_DATA_DIR)) return [];
  const names = fs.readdirSync(DY_DATA_DIR);
  const batches = [];
  for (const n of names) {
    const full = path.join(DY_DATA_DIR, n);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (!n.startsWith("dy_aweme_")) continue;
    const xlsxPath = path.join(DY_DATA_DIR, `${n}.xlsx`);
    const noteDirs = fs
      .readdirSync(full)
      .map((id) => path.join(full, id))
      .filter((p) => {
        try {
          return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "meta.json"));
        } catch {
          return false;
        }
      });
    let nickname = "";
    let userId = "";
    let metaAvatar = "";
    let profileUrl = "";
    try {
      const batchMetaPath = path.join(full, "batch_meta.json");
      if (fs.existsSync(batchMetaPath)) {
        const bm = JSON.parse(fs.readFileSync(batchMetaPath, "utf8"));
        nickname = String(bm.nickname || "").trim();
        userId = String(bm.user_id || "").trim();
        profileUrl = String(bm.profile_url || "").trim();
        metaAvatar = String(bm.avatar_url || "").trim();
      }
    } catch {
      /* ignore */
    }
    if (noteDirs.length) {
      const meta = readMeta(noteDirs[0]);
      if (meta) {
        if (!nickname) nickname = String(meta.nickname || "").trim();
        if (!userId) userId = String(meta.user_id || "").trim();
        if (!metaAvatar) metaAvatar = String(meta.avatar_url || meta.avatar || "").trim();
      }
    }
    if (!profileUrl) {
      profileUrl = fieldFromSiblingCsv(DY_DATA_DIR, n, "作者主页链接");
    }
    if (!profileUrl && userId) profileUrl = `https://www.douyin.com/user/${userId}`;
    if (!nickname) nickname = fieldFromSiblingCsv(DY_DATA_DIR, n, "作者昵称");
    const avatarUrl = resolveBatchAvatar(full, DY_DATA_DIR, n, metaAvatar);
    batches.push({
      kind: "media",
      platform: "dy",
      name: n,
      outRoot: full,
      xlsxPath: fs.existsSync(xlsxPath) ? xlsxPath : "",
      noteCount: noteDirs.length,
      mtime: st.mtimeMs,
      at: nowText(new Date(st.mtimeMs)),
      nickname,
      userId,
      avatarUrl,
      profileUrl,
    });
  }
  return batches.sort((a, b) => b.mtime - a.mtime);
}

function listDyRecords() {
  return {
    batches: listDyMediaBatches(),
    publishNotes: listPublishRecords("note", "dy"),
    publishVideos: listPublishRecords("video", "dy"),
  };
}

/** 供 Excel 预览弹窗：从批次 meta 汇总表格行（兜底） */
function previewBatchNotes(outRoot, limit = 200) {
  const notes = listNotesInBatch(outRoot).slice(0, limit);
  return notes.map((n) => {
    const meta = readMeta(n.folder) || {};
    return {
      noteId: n.noteId || meta.note_id || "",
      title: n.title || meta.title || "",
      likes: meta.liked_count || n.liked_count || "",
      collects: meta.collected_count || "",
      publishTime: meta.publish_time || meta.saved_at || "",
    };
  });
}

function cellToText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (value.richText) return value.richText.map((t) => t.text || "").join("");
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (value.hyperlink) return String(value.text || value.hyperlink);
    if (Array.isArray(value.formula || value.sharedFormula)) return "";
  }
  return String(value);
}

/**
 * 读取任务汇总 xlsx（如 data/xhs/{任务ID}.xlsx）首表内容，供窗口内预览
 */
async function previewXlsxFile(filePath, limit = 500) {
  const ExcelJS = require("exceljs");
  const target = String(filePath || "").trim();
  if (!target) throw new Error("未指定 Excel 路径");
  if (!fs.existsSync(target)) throw new Error(`未找到任务表格文件：${path.basename(target)}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(target);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [], filePath: target };

  let colCount = 0;
  ws.getRow(1).eachCell({ includeEmpty: true }, (_cell, colNumber) => {
    if (colNumber > colCount) colCount = colNumber;
  });
  if (!colCount) colCount = ws.columnCount || 0;

  const headers = [];
  for (let c = 1; c <= colCount; c += 1) {
    const raw = cellToText(ws.getRow(1).getCell(c).value).trim();
    headers.push(raw || `列${c}`);
  }

  const rows = [];
  const maxRow = ws.rowCount || 0;
  for (let r = 2; r <= maxRow && rows.length < limit; r += 1) {
    const row = ws.getRow(r);
    const obj = {};
    let empty = true;
    headers.forEach((h, i) => {
      const text = cellToText(row.getCell(i + 1).value);
      obj[h] = text;
      if (text) empty = false;
    });
    if (!empty) rows.push(obj);
  }

  return sanitizeDyPreview(target, headers, rows);
}

/** 抖音预览隐藏小红书遗留列 */
function sanitizeDyPreview(filePath, headers, rows) {
  const p = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  const isDy = p.includes("/data/dy/") || /dy_aweme_/i.test(p);
  if (!isDy) return { headers, rows, filePath };
  let hide;
  try {
    hide = require("./dy/fields").DY_HIDE_COLUMNS;
  } catch {
    hide = new Set(["笔记ID", "笔记链接", "笔记绝对位置", "笔记类型"]);
  }
  const nextHeaders = headers.filter((h) => !hide.has(h));
  if (nextHeaders.length === headers.length) return { headers, rows, filePath };
  const nextRows = rows.map((row) => {
    const obj = {};
    nextHeaders.forEach((h) => {
      obj[h] = row[h] ?? "";
    });
    return obj;
  });
  return { headers: nextHeaders, rows: nextRows, filePath };
}

/** 读取 CSV 为首表结构，供侧栏表格预览（与 xlsx 同形态） */
function previewCsvFile(filePath, limit = 500) {
  const target = String(filePath || "").trim();
  if (!target) throw new Error("未指定 CSV 路径");
  if (!fs.existsSync(target)) throw new Error(`未找到文件：${path.basename(target)}`);
  const text = fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return { headers: [], rows: [], filePath: target };
  const headers = parseCsvLine(lines[0]).map((h, i) => {
    const t = String(h || "").trim();
    return t || `列${i + 1}`;
  });
  const rows = [];
  for (let i = 1; i < lines.length && rows.length < limit; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const obj = {};
    let empty = true;
    headers.forEach((h, idx) => {
      const text = String(cols[idx] ?? "");
      obj[h] = text;
      if (text) empty = false;
    });
    if (!empty) rows.push(obj);
  }
  return sanitizeDyPreview(target, headers, rows);
}

function readMeta(folder) {
  const metaPath = path.join(folder, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 从同名 CSV 首行读取指定列（采集表兜底） */
function fieldFromSiblingCsv(dataDir, batchName, fieldName) {
  const csvPath = path.join(dataDir, `${batchName}.csv`);
  if (!fs.existsSync(csvPath)) return "";
  try {
    const text = fs.readFileSync(csvPath, "utf8").replace(/^\ufeff/, "");
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return "";
    const headers = parseCsvLine(lines[0]);
    const idx = headers.findIndex((h) => h === fieldName);
    if (idx < 0) return "";
    const cols = parseCsvLine(lines[1]);
    return String(cols[idx] || "").trim();
  } catch {
    return "";
  }
}

function avatarFromSiblingCsv(dataDir, batchName) {
  return fieldFromSiblingCsv(dataDir, batchName, "作者头像");
}

/** 本地头像文件转 data URL，供桌面端 img 稳定渲染 */
function localImageAsDataUrl(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    const buf = fs.readFileSync(filePath);
    if (!buf.length || buf.length > 2 * 1024 * 1024) return "";
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

function resolveBatchAvatar(outRoot, dataDir, batchName, metaAvatar) {
  const localCandidates = [
    path.join(outRoot, "author_avatar.jpg"),
    path.join(outRoot, "author_avatar.png"),
    path.join(outRoot, "author_avatar.webp"),
  ];
  for (const p of localCandidates) {
    const dataUrl = localImageAsDataUrl(p);
    if (dataUrl) return dataUrl;
  }
  try {
    const batchMetaPath = path.join(outRoot, "batch_meta.json");
    if (fs.existsSync(batchMetaPath)) {
      const bm = JSON.parse(fs.readFileSync(batchMetaPath, "utf8"));
      const local = String(bm.avatar_local || "").trim();
      if (local) {
        const dataUrl = localImageAsDataUrl(local);
        if (dataUrl) return dataUrl;
      }
      const remote = String(bm.avatar_url || "").trim();
      if (remote) return remote;
    }
  } catch {
    /* ignore */
  }
  if (metaAvatar) return metaAvatar;
  return avatarFromSiblingCsv(dataDir, batchName);
}

function listNoteAssets(folder) {
  const files = fs.readdirSync(folder);
  const images = [];
  const videos = [];
  for (const name of files) {
    const ext = path.extname(name).toLowerCase();
    const full = path.join(folder, name);
    if (!fs.statSync(full).isFile()) continue;
    if (IMAGE_EXTS.has(ext) && !name.startsWith("cover.")) images.push(full);
    if (VIDEO_EXTS.has(ext)) videos.push(full);
  }
  if (!images.length) {
    for (const name of files) {
      const ext = path.extname(name).toLowerCase();
      const full = path.join(folder, name);
      if (IMAGE_EXTS.has(ext) && fs.statSync(full).isFile()) images.push(full);
    }
  }
  images.sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
  videos.sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
  return { images, videos };
}

/** 列表页轻量扫描：一次 readdir，避免每个文件多次 exists/stat */
function scanNoteFolderLite(folder) {
  let imageCount = 0;
  let videoCount = 0;
  let videoPath = "";
  let coverPath = "";
  let firstImage = "";
  let names = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return { imageCount, videoCount, videoPath, coverPath };
  }
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    const full = path.join(folder, name);
    if (IMAGE_EXTS.has(ext)) {
      if (/^cover\./i.test(name) && !coverPath) coverPath = full;
      else {
        imageCount += 1;
        if (!firstImage) firstImage = full;
      }
    } else if (VIDEO_EXTS.has(ext)) {
      videoCount += 1;
      if (!videoPath) videoPath = full;
    }
  }
  if (!coverPath) coverPath = firstImage;
  return { imageCount, videoCount, videoPath, coverPath };
}

function listNotesInBatch(outRoot) {
  if (!outRoot || !fs.existsSync(outRoot)) return [];
  const entries = [];
  let names = [];
  try {
    names = fs.readdirSync(outRoot);
  } catch {
    return [];
  }
  for (const name of names) {
    const folder = path.join(outRoot, name);
    let st;
    try {
      st = fs.statSync(folder);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const meta = readMeta(folder);
    if (!meta) continue;
    const lite = scanNoteFolderLite(folder);
    entries.push({
      noteId: meta.note_id || meta.aweme_id || name,
      folder,
      title: meta.title || "",
      desc: meta.desc || "",
      topics: meta.topics || "",
      type: meta.type || (lite.videoCount ? "video" : "normal"),
      nickname: meta.nickname || "",
      liked_count: meta.liked_count || "",
      collected_count: meta.collected_count || "",
      comment_count: meta.comment_count || "",
      share_count: meta.share_count || "",
      coverPath: lite.coverPath,
      imageCount: lite.imageCount,
      videoCount: lite.videoCount,
      videoPath: lite.videoPath,
      mtime: st.mtimeMs || fileMtime(folder),
    });
  }
  return entries.sort((a, b) => b.mtime - a.mtime);
}

function sumLikesFromDisk() {
  let total = 0;
  for (const batch of listMediaBatches()) {
    for (const note of listNotesInBatch(batch.outRoot)) {
      const n = Number(String(note.liked_count || "").replace(/[^\d.]/g, ""));
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}

function pctChange(today, yesterday) {
  if (!yesterday) return today ? 100 : 0;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

function buildTrend(days) {
  const hist = readHistory().filter((r) => r.workspace === "xhs");
  const keys = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(dayKeyFromMs(d.getTime()));
  }
  const collectMap = Object.fromEntries(keys.map((k) => [k, 0]));
  const publishMap = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of hist) {
    const k = dayKeyFromAt(r.at);
    if (!k || !(k in collectMap)) continue;
    if (r.status === "failed") continue;
    if (r.kind === "collect" || r.kind === "media") {
      collectMap[k] += Number(r.count) || 0;
    }
    if (r.kind === "publish_note" || r.kind === "publish_video") {
      publishMap[k] += 1;
    }
  }
  // 无历史时用磁盘批次/CSV 的 mtime 做兜底采集量
  if (Object.values(collectMap).every((v) => v === 0)) {
    for (const c of listCollectFiles()) {
      const k = dayKeyFromMs(c.mtime);
      if (k in collectMap) collectMap[k] += c.count || 0;
    }
  }
  return keys.map((k) => ({
    date: k.slice(5),
    fullDate: k,
    collect: collectMap[k],
    publish: publishMap[k],
  }));
}

function getDashboardStats({ rangeDays = 7 } = {}) {
  const hist = readHistory().filter((r) => r.workspace === "xhs");
  const today = todayKey();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = dayKeyFromMs(y.getTime());

  let todayCollect = 0;
  let yesterdayCollect = 0;
  let todayNotePub = 0;
  let todayVideoPub = 0;
  let yesterdayPub = 0;
  let ok = 0;
  let fail = 0;
  let scheduled = 0;

  for (const r of hist) {
    const day = dayKeyFromAt(r.at);
    const st = r.status || "success";
    if (st === "success" || st === "scheduled") ok += 1;
    if (st === "failed") fail += 1;
    if (st === "scheduled") scheduled += 1;

    if (day === today && st !== "failed") {
      if (r.kind === "collect" || r.kind === "media") todayCollect += Number(r.count) || 0;
      if (r.kind === "publish_note") todayNotePub += 1;
      if (r.kind === "publish_video") todayVideoPub += 1;
    }
    if (day === yesterday && st !== "failed") {
      if (r.kind === "collect" || r.kind === "media") yesterdayCollect += Number(r.count) || 0;
      if (r.kind === "publish_note" || r.kind === "publish_video") yesterdayPub += 1;
    }
  }

  // 今日无历史采集记录时，按今日改动的 CSV 行数兜底
  if (!todayCollect) {
    for (const c of listCollectFiles()) {
      if (dayKeyFromMs(c.mtime) === today) todayCollect += c.count || 0;
    }
  }
  if (!yesterdayCollect) {
    for (const c of listCollectFiles()) {
      if (dayKeyFromMs(c.mtime) === yesterday) yesterdayCollect += c.count || 0;
    }
  }

  const todayPub = todayNotePub + todayVideoPub;
  const total = ok + fail;
  const successRate = total ? Math.round((ok / total) * 1000) / 10 : 100;
  const prevOkRate = 100; // 无对比基线时展示平稳
  const likes = sumLikesFromDisk();

  const statusPie = [
    { name: "成功", value: Math.max(0, ok - scheduled), color: "#2563eb" },
    { name: "失败", value: fail, color: "#93c5fd" },
    { name: "定时中", value: scheduled, color: "#1e40af" },
  ].filter((x) => x.value > 0);
  if (!statusPie.length) {
    statusPie.push({ name: "暂无任务", value: 1, color: "#bfdbfe" });
  }

  const timeline = hist.slice(0, 12).map((r) => ({
    id: r.id,
    at: r.at,
    title: r.noteTitle || r.title || r.kind,
    kind: r.kind,
    status: r.status || "success",
    detail: r.error || r.path || "",
  }));

  return {
    kpis: {
      todayCollect,
      todayCollectTrend: pctChange(todayCollect, yesterdayCollect),
      todayNotePub,
      todayVideoPub,
      todayPubTrend: pctChange(todayPub, yesterdayPub),
      totalLikes: likes,
      likesTrend: 0,
      successRate,
      successTrend: pctChange(successRate, prevOkRate),
    },
    trend: buildTrend(rangeDays === 30 ? 30 : 7),
    statusPie,
    timeline,
    rangeDays: rangeDays === 30 ? 30 : 7,
  };
}

function listPublishRecords(kind, workspace = "xhs") {
  const want = kind === "video" ? "publish_video" : "publish_note";
  return readHistory()
    .filter((r) => r.workspace === workspace && r.kind === want)
    .map((r) => ({
      id: r.id,
      noteTitle: r.noteTitle || r.title || "未命名",
      at: r.at,
      status: r.status || "success",
      likes: r.likes,
      reads: r.reads,
      path: r.path || "",
      scheduleTime: r.scheduleTime || "",
      error: r.error || "",
      tags: r.tags || "",
      content: r.content || "",
      workspace: r.workspace || workspace,
    }));
}

function listXhsRecords() {
  return {
    history: readHistory().filter((r) => r.workspace === "xhs"),
    collects: listCollectFiles(),
    batches: listMediaBatches(),
    publishNotes: listPublishRecords("note"),
    publishVideos: listPublishRecords("video"),
  };
}

module.exports = {
  HISTORY_PATH,
  readHistory,
  appendRecord,
  recordFromTask,
  recordTaskFailure,
  listCollectFiles,
  listMediaBatches,
  listDyMediaBatches,
  listDyRecords,
  listNotesInBatch,
  previewBatchNotes,
  previewXlsxFile,
  previewCsvFile,
  listXhsRecords,
  listPublishRecords,
  getDashboardStats,
  readMeta,
  listNoteAssets,
};
