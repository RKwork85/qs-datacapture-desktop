const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

/** 抖音作品字段（不用小红书「笔记*」列：笔记ID / 笔记链接 / 笔记绝对位置） */
const DY_AWEME_COLUMNS = [
  "作者昵称",
  "作者ID",
  "作者头像",
  "作者主页链接",
  "点赞数",
  "收藏数",
  "评论数",
  "转发数",
  "播放数",
  "分享数",
  "作品类型",
  "标题",
  "文案",
  "话题",
  "作品ID",
  "作品链接",
  "封面图链接",
  "媒体数量",
  "图片链接",
  "视频链接",
  "视频时长秒",
  "音乐名",
  "发布时间",
  "修改时间",
  "IP属地",
  "采集时间",
  "封面位置",
  "媒体绝对位置",
];

/** 侧栏预览时隐藏的小红书遗留列（旧文件可能仍带） */
const DY_HIDE_COLUMNS = new Set(["笔记ID", "笔记链接", "笔记绝对位置", "笔记类型"]);

const COL_WIDTH = Object.fromEntries(
  DY_AWEME_COLUMNS.map((k) => [k, k.includes("链接") || k.includes("位置") ? 36 : 14])
);

function emptyAwemeRow() {
  return Object.fromEntries(DY_AWEME_COLUMNS.map((k) => [k, ""]));
}

function s(val) {
  if (val == null) return "";
  const text = String(val)
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .trim();
  return text.toLowerCase() === "none" ? "" : text;
}

function formatType(raw, { hasVideo = false, isImages = false } = {}) {
  const t = s(raw).toLowerCase();
  if (isImages || t === "images" || t === "image") return "图文";
  if (hasVideo || t === "video" || t === "aweme") return "视频";
  return hasVideo ? "视频" : "图文";
}

function formatTime(val) {
  if (val == null || val === "" || val === 0 || val === "0") return "";
  let n = Number(val);
  if (!Number.isFinite(n)) return s(val);
  if (n < 1e12) n *= 1000;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return s(val);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function cleanTopicName(name) {
  return s(name).replace(/^#/, "").replace(/\[话题\]/g, "").trim();
}

function formatTopics(list) {
  if (!Array.isArray(list)) return s(list);
  return list
    .map((t) => cleanTopicName(typeof t === "string" ? t : t?.hashtag_name || t?.cha_name || t?.name || ""))
    .filter(Boolean)
    .join(" ");
}

function profileUrl(secUid) {
  const id = s(secUid);
  if (!id) return "";
  if (id.startsWith("http")) return id;
  return `https://www.douyin.com/user/${id}`;
}

function awemeUrl(awemeId) {
  const id = s(awemeId);
  return id ? `https://www.douyin.com/video/${id}` : "";
}

/** 从作者对象提取头像直链（优先更高清） */
function extractAuthorAvatar(author = {}) {
  const candidates = [
    author.avatar_larger,
    author.avatar_300x300,
    author.avatar_168x168,
    author.avatar_medium,
    author.avatar_thumb,
    author.avatar_url,
    author.avatar,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
    if (typeof c === "object") {
      const list = c.url_list || c.urlList || [];
      if (Array.isArray(list) && list[0]) return String(list[0]);
      if (c.uri && typeof c.uri === "string" && c.uri.startsWith("http")) return c.uri;
    }
  }
  return "";
}

function rowFromAweme(aweme, extra = {}) {
  const row = emptyAwemeRow();
  const author = aweme.author || {};
  const stats = aweme.statistics || {};
  const video = aweme.video || {};
  const images = Array.isArray(aweme.images) ? aweme.images : [];
  const hasVideo = Boolean(video.play_addr || video.download_addr || video.bit_rate);
  const isImages = images.length > 0 && !hasVideo;
  const cover =
    video.cover?.url_list?.[0] ||
    video.origin_cover?.url_list?.[0] ||
    aweme.video?.dynamic_cover?.url_list?.[0] ||
    images[0]?.url_list?.[0] ||
    "";
  const playUrl =
    video.play_addr?.url_list?.[0] ||
    video.download_addr?.url_list?.[0] ||
    (video.bit_rate && video.bit_rate[0]?.play_addr?.url_list?.[0]) ||
    "";
  const imgUrls = images
    .map((im) => (im.url_list && im.url_list[0]) || "")
    .filter(Boolean);
  const secUid = author.sec_uid || extra.secUid || "";
  const awemeId = aweme.aweme_id || aweme.awemeId || "";
  const desc = s(aweme.desc || aweme.title || "");
  const topics = formatTopics(aweme.text_extra || aweme.cha_list || []);

  const avatar = extractAuthorAvatar(author) || s(extra.avatarUrl);
  row["作者昵称"] = s(author.nickname);
  row["作者ID"] = s(author.uid || author.short_id || secUid);
  row["作者头像"] = s(avatar);
  row["作者主页链接"] = profileUrl(secUid || extra.profileUrl);
  row["点赞数"] = s(stats.digg_count);
  row["收藏数"] = s(stats.collect_count);
  row["评论数"] = s(stats.comment_count);
  row["转发数"] = s(stats.share_count);
  row["播放数"] = s(stats.play_count);
  row["分享数"] = s(stats.share_count);
  row["作品类型"] = formatType(aweme.aweme_type, { hasVideo, isImages });
  row["标题"] = desc.slice(0, 40);
  row["文案"] = desc;
  row["话题"] = topics;
  row["作品ID"] = s(awemeId);
  row["作品链接"] = awemeUrl(awemeId);
  row["封面图链接"] = s(cover);
  row["媒体数量"] = String(hasVideo ? 1 : imgUrls.length || 0);
  row["图片链接"] = imgUrls.join(";");
  row["视频链接"] = s(playUrl);
  row["视频时长秒"] = s(video.duration ? Math.round(Number(video.duration) / 1000) : "");
  row["音乐名"] = s(aweme.music?.title || aweme.music?.music_name);
  row["发布时间"] = formatTime(aweme.create_time);
  row["修改时间"] = formatTime(aweme.create_time);
  row["IP属地"] = s(aweme.ip_label || "");
  row["采集时间"] = s(extra.fetchedAt);
  row["封面位置"] = s(extra.coverPath);
  row["媒体绝对位置"] = s(extra.mediaPaths);
  return row;
}

async function writeAwemeTable(filePath, rows) {
  const out = path.resolve(String(filePath).replace(/\.xlsx$/i, "") + ".xlsx");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("作品");
  ws.columns = DY_AWEME_COLUMNS.map((name) => ({
    header: name,
    key: name,
    width: COL_WIDTH[name] || 16,
  }));
  const header = ws.getRow(1);
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  for (const row of rows) {
    const values = {};
    for (const k of DY_AWEME_COLUMNS) values[k] = s(row[k]);
    ws.addRow(values);
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile(out);
  return out;
}

module.exports = {
  DY_AWEME_COLUMNS,
  DY_HIDE_COLUMNS,
  emptyAwemeRow,
  s,
  formatType,
  formatTime,
  cleanTopicName,
  formatTopics,
  profileUrl,
  awemeUrl,
  extractAuthorAvatar,
  rowFromAweme,
  writeAwemeTable,
};
