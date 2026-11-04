const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const XHS_NOTE_COLUMNS = [
  "作者昵称",
  "作者ID",
  "作者头像",
  "作者主页链接",
  "点赞数",
  "收藏数",
  "评论数",
  "转发数",
  "笔记类型",
  "标题",
  "文案",
  "话题",
  "笔记ID",
  "笔记链接",
  "封面图链接",
  "媒体数量",
  "图片链接",
  "视频链接",
  "发布时间",
  "修改时间",
  "IP属地",
  "采集时间",
  "封面位置",
  "笔记绝对位置",
];

const COL_WIDTH = {
  作者昵称: 14,
  作者ID: 26,
  作者头像: 36,
  作者主页链接: 36,
  笔记链接: 36,
  点赞数: 10,
  收藏数: 10,
  评论数: 10,
  转发数: 10,
  笔记类型: 10,
  标题: 28,
  文案: 40,
  话题: 28,
  笔记ID: 26,
  封面图链接: 24,
  媒体数量: 10,
  图片链接: 36,
  视频链接: 24,
  发布时间: 20,
  修改时间: 20,
  IP属地: 12,
  采集时间: 20,
  封面位置: 42,
  笔记绝对位置: 48,
};

function emptyNoteRow() {
  return Object.fromEntries(XHS_NOTE_COLUMNS.map((k) => [k, ""]));
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

function formatType(raw, { hasVideo = false } = {}) {
  const t = s(raw).toLowerCase();
  if (hasVideo || t === "video") return "视频";
  if (t === "normal" || t === "image") return "图文";
  return "";
}

function formatTime(val) {
  if (val == null || val === "" || val === 0 || val === "0") return "";
  let n = Number(val);
  if (!Number.isFinite(n)) return s(val);
  if (n <= 0) return "";
  if (n > 10_000_000_000) n /= 1000;
  try {
    return require("../paths").nowText(new Date(n * 1000));
  } catch {
    return "";
  }
}

/** 去掉小红书话题角标/包裹符，得到可发布的纯话题名 */
function cleanTopicName(raw) {
  let name = s(raw)
    .replace(/\[话题\]/g, "")
    .replace(/^#+/, "")
    .replace(/#+$/, "")
    .trim();
  // 残留特殊符号（方括号等）一并去掉，避免创作者中心报错
  name = name.replace(/[\[\]【】]/g, "").trim();
  return name;
}

/** 文案/话题串里剥离 `[话题]` 角标；话题列再规范成 #名 */
function stripTopicMarkers(text) {
  return s(text).replace(/\[话题\]/g, "");
}

function formatTopics(tagList) {
  if (!Array.isArray(tagList)) return "";
  const names = [];
  for (const item of tagList) {
    const raw = item && typeof item === "object" ? item.name : item;
    const name = cleanTopicName(raw);
    if (name) names.push(`#${name}`);
  }
  return names.join(" ");
}

/** 把粘贴的话题串规范成 `#a #b`（去角标、去尾 #） */
function normalizeTopicsStr(tagsStr) {
  return String(tagsStr || "")
    .split(/[\s,，]+/)
    .map((t) => cleanTopicName(t))
    .filter(Boolean)
    .map((n) => `#${n}`)
    .join(" ");
}

function joinUrls(urls) {
  if (!Array.isArray(urls)) return "";
  return urls.map((u) => s(u)).filter(Boolean).join(";");
}

function mediaCount({ images = [], videos = [] } = {}) {
  if (videos.length) return "1";
  if (images.length) return String(images.length);
  return "";
}

function profileUrl(userId) {
  const uid = s(userId);
  return uid ? `https://www.xiaohongshu.com/user/profile/${uid}` : "";
}

/** 从用户对象提取头像 URL（主页列表 / 详情接口通用） */
function extractAuthorAvatar(user = {}) {
  const candidates = [
    user.avatar,
    user.avatar_url,
    user.images,
    user.image,
    user.imageb,
    user.avatar_large,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
    if (typeof c === "object") {
      if (typeof c.url === "string" && c.url.startsWith("http")) return c.url;
      const list = c.url_list || c.urlList || [];
      if (Array.isArray(list) && list[0]) return String(list[0]);
    }
  }
  return "";
}

/** 主页列表卡片 → 标准行（媒体路径列留空，详情阶段再补） */
function rowFromProfileCard(noteCard, item = {}, extra = {}) {
  const row = emptyNoteRow();
  const card = noteCard && typeof noteCard === "object" ? noteCard : {};
  const interact = card.interact_info || item.interact_info || {};
  const user = card.user || item.user || {};
  const noteId = s(card.note_id || card.id || item.id || item.note_id || extra.noteId);
  const uid = s(user.user_id || user.userid || user.id || extra.userId);
  const avatar =
    extractAuthorAvatar(user) || s(extra.avatarUrl) || s(card.avatar || "");
  row["作者昵称"] = s(user.nickname || user.nick_name || extra.nickname);
  row["作者ID"] = uid;
  row["作者头像"] = avatar;
  row["作者主页链接"] = profileUrl(uid || extra.userId);
  row["点赞数"] = s(interact.liked_count || interact.like_count || extra.liked);
  row["收藏数"] = s(interact.collected_count || interact.collect_count);
  row["评论数"] = s(interact.comment_count);
  row["转发数"] = s(interact.share_count || interact.shared_count);
  row["笔记类型"] = formatType(card.type || item.type || "");
  row["标题"] = s(card.display_title || card.title || extra.title);
  row["笔记ID"] = noteId;
  row["笔记链接"] = s(extra.noteLink);
  row["封面图链接"] = s(extra.cover);
  row["采集时间"] = s(extra.fetchedAt);
  return row;
}

function rowFromNoteDetail(
  note,
  { noteLink = "", fetchedAt = "", coverPath = "", notePaths = "" } = {}
) {
  const row = emptyNoteRow();
  const images = note.images || [];
  const videos = note.videos || [];
  const uid = s(note.user_id);
  row["笔记ID"] = s(note.note_id);
  row["笔记链接"] = s(noteLink || note["笔记链接"]);
  row["笔记类型"] = formatType(note.type || "", { hasVideo: Boolean(videos.length) });
  row["标题"] = s(note.title);
  row["文案"] = stripTopicMarkers(note.desc);
  row["话题"] = normalizeTopicsStr(note.topics);
  row["封面图链接"] = s(images[0] || note["封面图链接"]);
  row["媒体数量"] = mediaCount({ images, videos });
  row["图片链接"] = joinUrls(images);
  row["视频链接"] = joinUrls(videos.slice(0, 1));
  row["作者昵称"] = s(note.nickname);
  row["作者ID"] = uid;
  row["作者头像"] = s(note.avatar_url || note.avatar || note["作者头像"]);
  row["作者主页链接"] = profileUrl(uid);
  row["点赞数"] = s(note.liked_count);
  row["收藏数"] = s(note.collected_count);
  row["评论数"] = s(note.comment_count);
  row["转发数"] = s(note.share_count);
  row["发布时间"] = s(note.publish_time);
  row["修改时间"] = s(note.update_time);
  row["IP属地"] = s(note.ip_location);
  row["采集时间"] = s(fetchedAt);
  row["封面位置"] = s(coverPath);
  row["笔记绝对位置"] = s(notePaths);
  return row;
}

async function writeNoteTable(filePath, rows) {
  const out = path.resolve(String(filePath).replace(/\.xlsx$/i, "") + ".xlsx");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("笔记");
  ws.columns = XHS_NOTE_COLUMNS.map((name) => ({
    header: name,
    key: name,
    width: COL_WIDTH[name] || 16,
  }));
  const header = ws.getRow(1);
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  for (const row of rows) {
    const values = {};
    for (const k of XHS_NOTE_COLUMNS) values[k] = s(row[k]);
    ws.addRow(values);
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: XHS_NOTE_COLUMNS.length },
  };
  await wb.xlsx.writeFile(out);
  return out;
}

module.exports = {
  XHS_NOTE_COLUMNS,
  emptyNoteRow,
  s,
  formatType,
  formatTime,
  cleanTopicName,
  stripTopicMarkers,
  formatTopics,
  normalizeTopicsStr,
  joinUrls,
  mediaCount,
  profileUrl,
  extractAuthorAvatar,
  rowFromProfileCard,
  rowFromNoteDetail,
  writeNoteTable,
};
