const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { DY_DATA_DIR, ensureDirs, stamp, nowText } = require("../paths");
const { createLogger } = require("../logger");
const { s, emptyAwemeRow, writeAwemeTable } = require("./fields");
const { MAX_ITEMS_HARD } = require("./fetch-profile");

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_WORKERS = 3;
const DL_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.douyin.com/",
};

function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const parseLine = (line) => {
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
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] || "";
    });
    return obj;
  });
}

function headContentLength(url) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith("https") ? https : http;
      const req = mod.request(url, { method: "HEAD", timeout: 8000, headers: DL_HEADERS }, (res) => {
        const len = Number(res.headers["content-length"] || 0);
        resolve(Number.isFinite(len) ? len : 0);
        res.resume();
      });
      req.on("error", () => resolve(0));
      req.on("timeout", () => {
        req.destroy();
        resolve(0);
      });
      req.end();
    } catch (_) {
      resolve(0);
    }
  });
}

function downloadFile(url, dest, maxBytes = MAX_FILE_BYTES) {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const mod = url.startsWith("https") ? https : http;
      const file = fs.createWriteStream(dest);
      let size = 0;
      const req = mod.get(url, { timeout: 20000, headers: DL_HEADERS }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(dest, () => {});
          downloadFile(res.headers.location, dest, maxBytes).then(resolve);
          return;
        }
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            file.close();
            fs.unlink(dest, () => {});
            resolve({ ok: false, msg: `超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制` });
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve({ ok: true, path: dest, size }));
        });
      });
      req.on("error", (e) => {
        file.close();
        fs.unlink(dest, () => {});
        resolve({ ok: false, msg: String(e.message || e) });
      });
      req.on("timeout", () => {
        req.destroy();
        file.close();
        fs.unlink(dest, () => {});
        resolve({ ok: false, msg: "下载超时" });
      });
    } catch (e) {
      resolve({ ok: false, msg: String(e.message || e) });
    }
  });
}

async function mapPool(items, workers, fn) {
  const ret = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.max(1, Math.min(workers, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return ret;
}

async function fetchNoteMedia({
  csvPath,
  maxNotes = 20,
  noteType = "all",
  onLog,
} = {}) {
  const log = createLogger(onLog);
  const csv = String(csvPath || "").trim();
  if (!csv || !fs.existsSync(csv)) throw new Error("CSV 不存在，请先完成作品采集");

  let limit = Number(maxNotes);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(MAX_ITEMS_HARD, Math.floor(limit));

  const typeFilter = String(noteType || "all").toLowerCase();
  let rowsIn = parseCsv(fs.readFileSync(csv, "utf8"));
  if (typeFilter === "video") {
    rowsIn = rowsIn.filter((r) => s(r["视频链接"]) || /视频/.test(s(r["作品类型"] || r["笔记类型"])));
  } else if (typeFilter === "image") {
    rowsIn = rowsIn.filter(
      (r) => !s(r["视频链接"]) && (/图文/.test(s(r["作品类型"] || r["笔记类型"])) || s(r["图片链接"]))
    );
  }
  rowsIn = rowsIn.slice(0, limit);
  if (!rowsIn.length) throw new Error("CSV 无有效行（或类型筛选后为空）");

  ensureDirs();
  const stem = path.basename(csv, path.extname(csv));
  const outRoot = path.join(DY_DATA_DIR, stem);
  fs.mkdirSync(outRoot, { recursive: true });
  const fetchedAt = nowText();
  const summaryRows = [];
  const jobs = [];
  const authorAvatarUrl = s(rowsIn[0]?.["作者头像"]);
  const authorAvatarLocal = path.join(outRoot, "author_avatar.jpg");
  if (authorAvatarUrl) {
    jobs.push({
      kind: "avatar",
      url: authorAvatarUrl,
      dest: authorAvatarLocal,
      folder: outRoot,
      row: rowsIn[0],
      mediaPaths: [],
      coverUrl: "",
    });
  }

  for (const r of rowsIn) {
    const id = s(r["作品ID"] || stamp());
    const folder = path.join(outRoot, id);
    fs.mkdirSync(folder, { recursive: true });
    const videoUrl = s(r["视频链接"]);
    const coverUrl = s(r["封面图链接"]);
    const imageUrls = s(r["图片链接"])
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    const avatarUrl = s(r["作者头像"]) || authorAvatarUrl;

    const meta = {
      aweme_id: id,
      note_id: id,
      title: s(r["标题"]),
      desc: s(r["文案"]),
      topics: s(r["话题"]),
      type: s(r["作品类型"]),
      nickname: s(r["作者昵称"]),
      user_id: s(r["作者ID"]),
      avatar_url: avatarUrl,
      liked_count: s(r["点赞数"]),
      collected_count: s(r["收藏数"]),
      comment_count: s(r["评论数"]),
      share_count: s(r["分享数"] || r["转发数"]),
      play_count: s(r["播放数"]),
      publish_time: s(r["发布时间"]),
      cover_url: coverUrl,
      video_url: videoUrl,
      image_urls: imageUrls,
      saved_at: fetchedAt,
    };
    fs.writeFileSync(path.join(folder, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
    if (meta.desc) fs.writeFileSync(path.join(folder, "desc.txt"), meta.desc, "utf8");

    const mediaPaths = [];
    if (videoUrl) {
      const dest = path.join(folder, "video.mp4");
      jobs.push({ kind: "video", url: videoUrl, dest, folder, row: r, mediaPaths, coverUrl });
    } else {
      imageUrls.slice(0, 9).forEach((url, idx) => {
        const dest = path.join(folder, `${String(idx + 1).padStart(2, "0")}.jpg`);
        jobs.push({ kind: "image", url, dest, folder, row: r, mediaPaths, coverUrl });
      });
    }
    if (coverUrl) {
      const dest = path.join(folder, "cover.jpg");
      jobs.push({ kind: "cover", url: coverUrl, dest, folder, row: r, mediaPaths, coverUrl });
    }

    const { 笔记ID: _nid, 笔记链接: _nlink, 笔记绝对位置: _npos, 笔记类型: _ntype, ...rest } = r;
    summaryRows.push({
      ...emptyAwemeRow(),
      ...rest,
      作者头像: avatarUrl || s(r["作者头像"]),
      作品ID: id,
      作品链接: s(r["作品链接"]) || `https://www.douyin.com/video/${id}`,
      作品类型: s(r["作品类型"] || r["笔记类型"]),
      采集时间: fetchedAt,
      封面位置: path.join(folder, "cover.jpg"),
      媒体绝对位置: folder,
    });
  }

  // 下载任务最多并发 3；先过滤超大文件
  log.info(`准备下载任务 ${jobs.length}，并发 ≤ ${MAX_WORKERS}`);
  const results = await mapPool(jobs, MAX_WORKERS, async (job) => {
    const len = await headContentLength(job.url);
    if (len > MAX_FILE_BYTES) {
      return { ok: false, msg: `跳过超大文件 ${(len / 1024 / 1024).toFixed(1)}MB`, job };
    }
    const r = await downloadFile(job.url, job.dest, MAX_FILE_BYTES);
    return { ...r, job };
  });

  let ok = 0;
  let fail = 0;
  for (const r of results) {
    if (r.ok) ok += 1;
    else {
      fail += 1;
      log.warn(`下载失败: ${r.msg || ""}`);
    }
  }

  const xlsxPath = await writeAwemeTable(path.join(DY_DATA_DIR, `${stem}.xlsx`), summaryRows);
  const batchMeta = {
    nickname: s(rowsIn[0]?.["作者昵称"]),
    user_id: s(rowsIn[0]?.["作者ID"]),
    avatar_url: authorAvatarUrl,
    profile_url: s(rowsIn[0]?.["作者主页链接"]),
    avatar_local: fs.existsSync(authorAvatarLocal) ? authorAvatarLocal : "",
    saved_at: fetchedAt,
    note_count: rowsIn.length,
  };
  fs.writeFileSync(path.join(outRoot, "batch_meta.json"), JSON.stringify(batchMeta, null, 2), "utf8");
  log.info(`下载结束: 成功 ${ok}，失败 ${fail}`);
  log.info(`汇总: ${xlsxPath}`);
  log.info(`目录: ${outRoot}`);

  return {
    ok: true,
    xlsxPath,
    outRoot,
    count: rowsIn.length,
    downloadOk: ok,
    downloadFail: fail,
  };
}

module.exports = { fetchNoteMedia, MAX_FILE_BYTES, MAX_WORKERS };
