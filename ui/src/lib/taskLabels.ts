/** 任务类型 → 一级类目 / 二级功能（用于 toast：一级-二级-信息） */

export type TaskLabel = {
  primary: string;
  secondary: string;
};

const MAP: Record<string, TaskLabel> = {
  "dy.login": { primary: "抖音", secondary: "账号登录" },
  "dy.fetch_profile": { primary: "抖音", secondary: "作品采集" },
  "dy.fetch_media": { primary: "抖音", secondary: "媒体下载" },
  "dy.publish_note": { primary: "抖音", secondary: "图文发布" },
  "dy.publish_video": { primary: "抖音", secondary: "视频发布" },
  "xhs.login": { primary: "小红书", secondary: "账号登录" },
  "xhs.fetch_profile": { primary: "小红书", secondary: "笔记采集" },
  "xhs.fetch_media": { primary: "小红书", secondary: "媒体下载" },
  "xhs.publish_note": { primary: "小红书", secondary: "图文发布" },
  "xhs.publish_video": { primary: "小红书", secondary: "视频发布" },
  "weibo.login": { primary: "微博", secondary: "账号登录" },
  "weibo.hot": { primary: "微博", secondary: "热搜榜" },
  "weibo.detail": { primary: "微博", secondary: "榜单详情" },
  "weibo.comments": { primary: "微博", secondary: "榜单评论区" },
  "weibo.daily": { primary: "微博", secondary: "日常采集" },
};

export function labelForTask(type: string): TaskLabel {
  if (MAP[type]) return MAP[type];
  const [a, b] = String(type || "").split(".");
  const primaryMap: Record<string, string> = {
    dy: "抖音",
    xhs: "小红书",
    weibo: "微博",
    data: "数据中心",
    control: "调度中心",
  };
  return {
    primary: primaryMap[a] || a || "工作台",
    secondary: b || "任务",
  };
}

export function friendlySuccessMessage(
  type: string,
  result?: Record<string, unknown>
): string {
  const count = result?.count;
  if (typeof count === "number") {
    if (/fetch_profile|fetch_media|comments|detail|hot/i.test(type)) {
      return `已完成，共整理 ${count} 条`;
    }
  }
  if (result?.scheduled) return "已提交定时发布，请稍候在平台确认";
  if (/publish_/i.test(type)) return "已提交发布，可在创作者中心查看进度";
  if (/login/i.test(type)) return "登录态已就绪，可以开始使用啦";
  if (/fetch_media/i.test(type)) return "媒体下载完成";
  if (/fetch_profile/i.test(type)) return "采集完成";
  return "执行完成";
}

export function friendlyStartMessage(type: string): string {
  if (/publish_/i.test(type)) return "正在提交发布，请稍候…";
  if (/login/i.test(type)) return "正在处理登录，请稍候…";
  if (/fetch_media/i.test(type)) return "正在下载媒体，请稍候…";
  if (/fetch_profile|hot|detail|comments/i.test(type)) return "正在执行采集，请稍候…";
  return "正在执行，请稍候…";
}

/** 将毫秒格式化为可读耗时：12.3 秒 / 1 分 05 秒 */
export function formatElapsed(ms: number): string {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return `${Math.round(n)} 毫秒`;
  if (n < 60_000) {
    const sec = n / 1000;
    return `${sec >= 10 ? sec.toFixed(1) : sec.toFixed(2)} 秒`;
  }
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m} 分 ${String(s).padStart(2, "0")} 秒`;
}

export function withElapsed(message: string, ms: number): string {
  const base = String(message || "").trim() || "执行结束";
  return `${base} · 耗时 ${formatElapsed(ms)}`;
}
