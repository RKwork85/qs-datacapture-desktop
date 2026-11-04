const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { XHS_DATA_DIR, stamp, nowText } = require("../paths");
const { DEFAULT_UA } = require("../browser");
const { createLogger } = require("../logger");
const auth = require("./auth");
const { formatTime, formatTopics, rowFromNoteDetail, writeNoteTable } = require("./fields");

function noteIdFromUrl(url) {
  let m = String(url).match(/\/(?:explore|search_result|discovery\/item)\/([0-9a-f]+)/i);
  if (m) return m[1];
  m = String(url).match(/\/user\/profile\/[^/]+\/([0-9a-f]+)/i);
  return m ? m[1] : "";
}

function loadNotesFromCsv(csvPath, maxNotes = 0) {
  const text = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] || "";
    });
    const link = String(obj["笔记链接"] || "").trim();
    if (!link || !link.includes("xsec_token=")) continue;
    const nid = noteIdFromUrl(link) || String(obj["笔记ID"] || "").trim();
    if (!nid) continue;
    // 透传主页采集已写入的作者/互动列，供详情与 meta 回填
    rows.push({
      note_id: nid,
      标题: String(obj["标题"] || "").trim(),
      笔记链接: link,
      封面图链接: String(obj["封面图链接"] || "").trim(),
      点赞数: String(obj["点赞数"] || "").trim(),
      收藏数: String(obj["收藏数"] || "").trim(),
      评论数: String(obj["评论数"] || "").trim(),
      转发数: String(obj["转发数"] || "").trim(),
      笔记类型: String(obj["笔记类型"] || "").trim(),
      笔记ID: String(obj["笔记ID"] || nid).trim(),
      作者昵称: String(obj["作者昵称"] || "").trim(),
      作者ID: String(obj["作者ID"] || "").trim(),
      作者头像: String(obj["作者头像"] || "").trim(),
      作者主页链接: String(obj["作者主页链接"] || "").trim(),
    });
    if (maxNotes > 0 && rows.length >= maxNotes) break;
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function httpGet(url, cookie, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_UA,
        Cookie: cookie,
        Referer: "https://www.xiaohongshu.com/",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function parseInitialState(html) {
  const text = html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const marker = "__INITIAL_STATE__";
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const start = text.indexOf("{", idx);
  if (start < 0) return null;
  const end = text.indexOf("</script>", start);
  if (end < 0) return null;
  let raw = text.slice(start, end).trim().replace(/;+\s*$/, "");
  raw = raw.replace(/:undefined/g, ":null");
  raw = raw.replace(/\bundefined\b/g, "null");
  raw = raw.replace(/new Map\(\s*\(\s*\)\s*\)/g, "{}");
  raw = raw.replace(/new Map\(\s*\[\s*\]\s*\)/g, "{}");
  raw = raw.replace(/new Map\(\)/g, "{}");
  raw = raw.replace(/new Set\(\s*\[\s*\]\s*\)/g, "[]");
  raw = raw.replace(/new Set\(\)/g, "[]");
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1));
    } catch {
      return null;
    }
  }
}

function bestImageUrl(img) {
  if (!img || typeof img !== "object") return "";
  for (const key of ["urlDefault", "url_default", "url", "original"]) {
    const u = img[key];
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  const info = img.infoList || img.info_list || [];
  if (Array.isArray(info)) {
    let best = "";
    let bestW = -1;
    for (const it of info) {
      if (!it || typeof it !== "object") continue;
      const u = it.url || "";
      if (!String(u).startsWith("http")) continue;
      const w = Number(it.width || it.imageWidth || it.image_width || 0);
      if (w >= bestW) {
        bestW = w;
        best = String(u);
      }
    }
    return best;
  }
  return "";
}

function videoUrls(noteCard) {
  const urls = [];
  const video = noteCard.video || {};
  if (!video || typeof video !== "object") return urls;
  const media = video.media || {};
  const stream = media.stream || {};
  if (stream && typeof stream === "object") {
    const groups = [];
    for (const key of ["h264", "h265", "av1", "h266"]) {
      if (Array.isArray(stream[key]) && stream[key].length) groups.push(stream[key]);
    }
    if (!groups.length) {
      for (const arr of Object.values(stream)) {
        if (Array.isArray(arr) && arr.length) groups.push(arr);
      }
    }
    for (const arr of groups) {
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        for (const uk of ["masterUrl", "master_url", "backupUrl", "backup_url", "url"]) {
          const u = item[uk];
          if (typeof u === "string" && u.startsWith("http")) urls.push(u);
        }
        for (const bu of item.backupUrls || item.backup_urls || []) {
          if (typeof bu === "string" && bu.startsWith("http")) urls.push(bu);
        }
      }
    }
  }
  return [...new Set(urls)];
}

function digNoteFromState(state, noteId) {
  const noteRoot = state.note || {};
  if (!noteRoot || typeof noteRoot !== "object") return null;
  for (const mapKey of ["noteDetailMap", "note_detail_map"]) {
    const detailMap = noteRoot[mapKey];
    if (detailMap && typeof detailMap === "object") {
      const entry = detailMap[noteId] || {};
      if (entry && typeof entry === "object") {
        const n = entry.note || entry.noteCard || entry;
        if (
          n &&
          typeof n === "object" &&
          (n.noteId || n.note_id || n.imageList || n.image_list)
        ) {
          return n;
        }
      }
    }
  }
  return null;
}

function asNoteDict(raw) {
  const g = (...keys) => {
    for (const k of keys) {
      if (raw[k] != null && raw[k] !== "") return raw[k];
    }
    return "";
  };
  let interact = g("interactInfo", "interact_info") || {};
  if (typeof interact !== "object") interact = {};
  let user = g("user") || {};
  if (typeof user !== "object") user = {};
  const imagesRaw = g("imageList", "image_list") || [];
  const images = [];
  if (Array.isArray(imagesRaw)) {
    for (const img of imagesRaw) {
      if (img && typeof img === "object") {
        const u = bestImageUrl(img);
        if (u) images.push(u);
      }
    }
  }
  let videos = videoUrls(raw);
  if (!videos.length) videos = videoUrls({ video: raw.video || {} });
  let ntype = String(g("type") || "").toLowerCase();
  if (videos.length && !ntype.includes("video")) ntype = "video";
  if (!ntype) ntype = videos.length ? "video" : "normal";
  let ip = g("ipLocation", "ip_location") || "";
  if (ip && typeof ip === "object") ip = ip.ipLocation || ip.name || "";
  return {
    note_id: String(g("noteId", "note_id", "id") || ""),
    type: ntype,
    title: String(g("title", "displayTitle", "display_title") || "").trim(),
    desc: String(g("desc", "description") || "")
      .replace(/\[话题\]/g, "")
      .trim(),
    topics: formatTopics(g("tagList", "tag_list") || []),
    publish_time: formatTime(g("time")),
    update_time: formatTime(g("lastUpdateTime", "last_update_time")),
    ip_location: String(ip || "").trim(),
    liked_count: String(interact.likedCount || interact.liked_count || ""),
    collected_count: String(interact.collectedCount || interact.collected_count || ""),
    share_count: String(
      interact.shareCount || interact.share_count || interact.sharedCount || ""
    ),
    comment_count: String(interact.commentCount || interact.comment_count || ""),
    nickname: String(user.nickname || ""),
    user_id: String(user.userId || user.user_id || ""),
    avatar_url: String(
      user.avatar ||
        user.image ||
        user.avatarUrl ||
        user.avatar_url ||
        (typeof user.images === "string" ? user.images : "") ||
        ""
    ).trim(),
    images,
    videos,
  };
}

async function fetchNoteByHttp(noteUrl, cookie, noteId = "") {
  const nid = noteId || noteIdFromUrl(noteUrl);
  if (!nid) throw new Error("无法从链接解析 note_id");
  if (!String(noteUrl).includes("xsec_token=")) {
    throw new Error("链接缺少 xsec_token");
  }
  const html = (await httpGet(noteUrl, cookie)).toString("utf8");
  if (html.includes("当前笔记暂时无法浏览") || html.includes("扫码查看")) {
    throw new Error("笔记无法浏览（token 失效或需登录）");
  }
  const state = parseInitialState(html);
  if (!state) throw new Error("解析 __INITIAL_STATE__ 失败");
  let rawNote = digNoteFromState(state, nid);
  if (!rawNote) {
    const noteRoot = state.note || {};
    const detailMap = noteRoot.noteDetailMap || noteRoot.note_detail_map || {};
    const first = Object.values(detailMap)[0];
    if (first && typeof first === "object") rawNote = first.note || first;
  }
  if (!rawNote) throw new Error("INITIAL_STATE 中无笔记详情");
  const parsed = asNoteDict(rawNote);
  if (!parsed.note_id) parsed.note_id = nid;
  if (!parsed.images.length && !parsed.videos.length) {
    throw new Error("解析成功但无图片/视频直链");
  }
  return parsed;
}

function extFromUrl(url, fallback) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.(mp4|mov|m4v|jpg|jpeg|png|webp|avif)(?:$|\?)/i);
    if (m) return "." + m[1].toLowerCase().replace("jpeg", "jpg");
  } catch (_) {
    /* ignore */
  }
  if (fallback === ".jpg" && String(url).includes("webp")) return ".webp";
  return fallback;
}

async function downloadFile(url, dest, timeoutMs = 60000) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    return { dest, ok: true, msg: "exists" };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": DEFAULT_UA, Referer: "https://www.xiaohongshu.com/" },
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return { dest, ok: true, msg: `${buf.length}B` };
  } catch (e) {
    return { dest, ok: false, msg: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function outputFiles(note, folder) {
  const videos = note.videos || [];
  const images = note.images || [];
  if (videos.length) {
    const videoPath = path.join(folder, `video${extFromUrl(videos[0], ".mp4")}`);
    const cover = images.length
      ? path.join(folder, `cover${extFromUrl(images[0], ".jpg")}`)
      : null;
    return { cover, mediaPaths: [videoPath] };
  }
  const paths = images.map((url, i) =>
    path.join(folder, `${String(i + 1).padStart(2, "0")}${extFromUrl(url, ".jpg")}`)
  );
  return { cover: paths[0] || null, mediaPaths: paths };
}

function isVideo(parsed) {
  if ((parsed.videos || []).length) return true;
  return String(parsed.type || "").toLowerCase() === "video";
}

function acceptNoteType(parsed, noteType) {
  if (!noteType || noteType === "all") return true;
  const video = isVideo(parsed);
  if (noteType === "video") return video;
  return !video;
}

function id6(raw) {
  const text = String(raw || "").trim();
  return text ? text.slice(0, 6) : "notes";
}

function batchStem(notes, stampText) {
  let author = "";
  for (const item of notes) {
    const m = String(item["笔记链接"] || "").match(/\/user\/profile\/([^/?#]+)/);
    if (m) {
      author = m[1];
      break;
    }
  }
  return `xhs_notes_${id6(author)}_${stampText}`;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.max(1, concurrency) }, () => run());
  await Promise.all(runners);
  return results;
}

async function fetchNoteMedia({
  csvPath = "",
  urls = [],
  maxNotes = 20,
  noteType = "all",
  workers = 8,
  parseWorkers = 4,
  dataDir = XHS_DATA_DIR,
  onLog,
} = {}) {
  const log = createLogger(onLog);
  const cookie = auth.loadCookie();
  if (!cookie) throw new Error(`未找到 Cookie，请先登录。路径: ${require("../paths").XHS_COOKIE_PATH}`);

  const readLimit = noteType === "all" ? maxNotes : Math.max(maxNotes * 8, maxNotes);
  let notes = [];
  if (csvPath) {
    notes = loadNotesFromCsv(csvPath, readLimit);
    log.info(`从 CSV 读取 ${notes.length} 条: ${csvPath}`);
  }
  for (const u of urls || []) {
    const link = String(u || "").trim();
    if (!link) continue;
    const nid = noteIdFromUrl(link);
    if (!nid || !link.includes("xsec_token=")) {
      log.warn(`跳过无效链接: ${link.slice(0, 80)}`);
      continue;
    }
    notes.push({ note_id: nid, 标题: "", 笔记链接: link });
    if (maxNotes > 0 && notes.length >= maxNotes) break;
  }
  const seen = new Set();
  notes = notes.filter((n) => {
    if (seen.has(n.note_id)) return false;
    seen.add(n.note_id);
    return true;
  });
  if (noteType === "all" && maxNotes > 0) notes = notes.slice(0, maxNotes);
  if (!notes.length) throw new Error("没有可下载的笔记（需要带 xsec_token 的链接）");

  const fetchedAt = nowText();
  const stem = batchStem(notes, stamp());
  const outRoot = path.join(dataDir, stem);
  fs.mkdirSync(outRoot, { recursive: true });

  log.info(`HTTP 解析 ${notes.length} 篇（${noteType}）...`);
  const parsedList = await mapPool(notes, parseWorkers, async (item) => {
    try {
      const parsed = await fetchNoteByHttp(item["笔记链接"], cookie, item.note_id);
      if (!parsed.title) parsed.title = item["标题"] || "";
      if (!parsed.images.length && item["封面图链接"]) parsed["封面图链接"] = item["封面图链接"];
      if (!parsed.liked_count && item["点赞数"]) parsed.liked_count = item["点赞数"];
      if (!parsed.collected_count && item["收藏数"]) parsed.collected_count = item["收藏数"];
      if (!parsed.comment_count && item["评论数"]) parsed.comment_count = item["评论数"];
      if (!parsed.share_count && item["转发数"]) parsed.share_count = item["转发数"];
      if (!parsed.avatar_url && item["作者头像"]) parsed.avatar_url = item["作者头像"];
      if (!parsed.nickname && item["作者昵称"]) parsed.nickname = item["作者昵称"];
      if (!parsed.user_id && item["作者ID"]) parsed.user_id = item["作者ID"];
      if (!parsed.type && item["笔记类型"]) {
        parsed.type = /视频/i.test(item["笔记类型"]) ? "video" : "normal";
      }
      return { item, parsed, err: "" };
    } catch (e) {
      return { item, parsed: null, err: String(e.message || e) };
    }
  });

  const resolved = [];
  const summaryRows = [];
  for (const { item, parsed, err } of parsedList) {
    if (!parsed) {
      log.warn(`[${item.note_id}] 解析失败: ${err}`);
      summaryRows.push(
        rowFromNoteDetail({ note_id: item.note_id, title: item["标题"] || "" }, {
          noteLink: item["笔记链接"] || "",
          fetchedAt,
        })
      );
      continue;
    }
    if (!acceptNoteType(parsed, noteType)) {
      log.info(`[${item.note_id}] 跳过（当前只要 ${noteType}）`);
      continue;
    }
    log.info(
      `[${item.note_id}] OK type=${parsed.type} img=${parsed.images.length} video=${parsed.videos.length}`
    );
    resolved.push({ item, parsed });
  }
  const keep = maxNotes > 0 ? resolved.slice(0, maxNotes) : resolved;

  const dlJobs = [];
  const authorAvatarUrl = String(keep[0]?.parsed?.avatar_url || keep[0]?.item?.["作者头像"] || "").trim();
  const authorAvatarLocal = path.join(outRoot, "author_avatar.jpg");
  if (authorAvatarUrl) {
    dlJobs.push(() => downloadFile(authorAvatarUrl, authorAvatarLocal));
  }
  for (const { item, parsed } of keep) {
    const folder = path.join(outRoot, item.note_id);
    fs.mkdirSync(folder, { recursive: true });
    const { cover, mediaPaths } = outputFiles(parsed, folder);
    const avatarUrl = String(parsed.avatar_url || item["作者头像"] || authorAvatarUrl || "").trim();
    const coverUrl = String(
      (parsed.images && parsed.images[0]) || item["封面图链接"] || ""
    ).trim();
    const meta = {
      note_id: parsed.note_id,
      笔记链接: item["笔记链接"],
      type: parsed.type,
      title: parsed.title,
      desc: parsed.desc,
      topics: parsed.topics || "",
      liked_count: parsed.liked_count,
      collected_count: parsed.collected_count,
      share_count: parsed.share_count,
      comment_count: parsed.comment_count,
      nickname: parsed.nickname || item["作者昵称"] || "",
      user_id: parsed.user_id || item["作者ID"] || "",
      avatar_url: avatarUrl,
      avatar: avatarUrl,
      cover_url: coverUrl,
      cover: coverUrl,
      publish_time: parsed.publish_time || "",
      image_urls: parsed.images || [],
      video_url: (parsed.videos && parsed.videos[0]) || "",
      images: parsed.images,
      videos: parsed.videos,
      saved_at: fetchedAt,
    };
    fs.writeFileSync(path.join(folder, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
    if (parsed.desc) fs.writeFileSync(path.join(folder, "desc.txt"), parsed.desc, "utf8");

    if ((parsed.videos || []).length) {
      dlJobs.push(() => downloadFile(parsed.videos[0], mediaPaths[0]));
      if (cover && parsed.images[0]) dlJobs.push(() => downloadFile(parsed.images[0], cover));
    } else {
      parsed.images.forEach((url, i) => {
        dlJobs.push(() => downloadFile(url, mediaPaths[i]));
      });
    }
    summaryRows.push(
      rowFromNoteDetail(
        { ...parsed, avatar_url: avatarUrl || parsed.avatar_url },
        {
          noteLink: item["笔记链接"] || "",
          fetchedAt,
          coverPath: cover ? path.resolve(cover) : "",
          notePaths: mediaPaths.map((p) => path.resolve(p)).join(";"),
        }
      )
    );
  }

  log.info(`CDN 下载中（并发 ${workers}）...`);
  const dlResults = await mapPool(dlJobs, workers, (job) => job());
  let ok = 0;
  let fail = 0;
  for (const r of dlResults) {
    if (r.ok) ok += 1;
    else {
      fail += 1;
      log.warn(`下载失败: ${r.msg}`);
    }
  }
  log.info(`下载结束: 成功 ${ok}，失败 ${fail}`);

  const xlsxPath = await writeNoteTable(path.join(dataDir, `${stem}.xlsx`), summaryRows);
  const first = keep[0]?.parsed || {};
  fs.writeFileSync(
    path.join(outRoot, "batch_meta.json"),
    JSON.stringify(
      {
        nickname: String(first.nickname || ""),
        user_id: String(first.user_id || ""),
        avatar_url: authorAvatarUrl,
        profile_url: first.user_id
          ? `https://www.xiaohongshu.com/user/profile/${first.user_id}`
          : "",
        avatar_local: fs.existsSync(authorAvatarLocal) ? authorAvatarLocal : "",
        saved_at: fetchedAt,
        note_count: keep.length,
      },
      null,
      2
    ),
    "utf8"
  );
  log.info(`汇总: ${xlsxPath}`);
  log.info(`文件目录: ${outRoot}`);
  return { ok: true, xlsxPath, outRoot, count: keep.length };
}

module.exports = { fetchNoteMedia, noteIdFromUrl, loadNotesFromCsv };
