const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const HOT_HEADERS = ["批次ID", "排名", "热搜词", "热度", "标签", "类别", "链接", "采集时间"];
const DETAIL_HEADERS = [
  "批次ID",
  "热搜词",
  "来源类型",
  "序号",
  "作者",
  "正文",
  "发布时间",
  "转发",
  "评论",
  "点赞",
  "微博链接",
  "mid",
  "采集时间",
];
const COMMENT_ZONE_HEADERS = [
  "批次ID",
  "热搜词",
  "微博链接",
  "mid",
  "微博作者",
  "帖子点赞",
  "评论区序",
  "评论序",
  "评论ID",
  "评论用户",
  "评论内容",
  "评论点赞",
  "评论时间",
  "采集时间",
];

const WIDTHS = {
  批次ID: 16,
  排名: 8,
  热搜词: 28,
  热度: 12,
  标签: 8,
  类别: 10,
  链接: 40,
  采集时间: 20,
  来源类型: 10,
  序号: 6,
  作者: 14,
  正文: 50,
  发布时间: 28,
  转发: 8,
  评论: 8,
  点赞: 8,
  微博链接: 36,
  mid: 18,
  微博作者: 14,
  帖子点赞: 10,
  评论区序: 10,
  评论序: 8,
  评论ID: 18,
  评论用户: 14,
  评论内容: 50,
  评论点赞: 10,
  评论时间: 28,
};

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
}

function writeSheet(ws, headers, rows) {
  ws.columns = headers.map((h) => ({ header: h, key: h, width: WIDTHS[h] || 14 }));
  styleHeader(ws.getRow(1));
  for (const row of rows) {
    const values = {};
    for (const h of headers) values[h] = row[h] != null ? row[h] : "";
    ws.addRow(values);
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: headers.length },
  };
}

async function exportWorkbook({
  hotRows,
  detailRows,
  commentZoneRows = [],
  outPath,
  batchId = "",
}) {
  const hot = hotRows.map((r) => {
    const item = { ...r };
    if (batchId) item["批次ID"] = batchId;
    return item;
  });
  const detail = detailRows.map((r) => {
    const item = { ...r };
    if (batchId) item["批次ID"] = batchId;
    delete item["热搜排名"];
    delete item._enrich_error;
    delete item._评论区序;
    return item;
  });
  const zone = (commentZoneRows || []).map((r) => {
    const item = { ...r };
    if (batchId) item["批次ID"] = batchId;
    return item;
  });

  const wb = new ExcelJS.Workbook();
  writeSheet(wb.addWorksheet("热搜榜单"), HOT_HEADERS, hot);
  writeSheet(wb.addWorksheet("热点详情"), DETAIL_HEADERS, detail);
  writeSheet(wb.addWorksheet("热点评论"), COMMENT_ZONE_HEADERS, zone);

  const file = path.resolve(outPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
  return file;
}

module.exports = {
  HOT_HEADERS,
  DETAIL_HEADERS,
  COMMENT_ZONE_HEADERS,
  exportWorkbook,
};
