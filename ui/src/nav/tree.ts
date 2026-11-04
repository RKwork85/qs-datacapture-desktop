import type { BrandKey } from "@/assets/brands";

/** 一级工作区 */
export type WorkspaceKey = "dy" | "xhs" | "weibo" | "data" | "control";

/** 二级页面（路由键） */
export type PageId =
  | "dy.login"
  | "dy.collect"
  | "dy.media"
  | "dy.publish_note"
  | "dy.publish_video"
  | "xhs.login"
  | "xhs.collect"
  | "xhs.media"
  | "xhs.publish_note"
  | "xhs.publish_video"
  | "weibo.login"
  | "weibo.hot"
  | "weibo.detail"
  | "weibo.comments"
  | "data.dashboard"
  | "data.storage"
  | "control.tasks"
  | "control.schedule"
  | "control.version";

export type NavChild = {
  id: PageId;
  label: string;
};

export type NavGroup = {
  key: WorkspaceKey;
  label: string;
  brand?: BrandKey;
  children: NavChild[];
};

/** 侧栏树：抖音置顶 */
export const NAV_TREE: NavGroup[] = [
  {
    key: "dy",
    label: "抖音",
    brand: "dy",
    children: [
      { id: "dy.login", label: "账号登录" },
      { id: "dy.collect", label: "作品采集" },
      { id: "dy.media", label: "媒体下载" },
      { id: "dy.publish_note", label: "图文发布" },
      { id: "dy.publish_video", label: "视频发布" },
    ],
  },
  {
    key: "xhs",
    label: "小红书",
    brand: "xhs",
    children: [
      { id: "xhs.login", label: "账号登录" },
      { id: "xhs.collect", label: "笔记采集" },
      { id: "xhs.media", label: "媒体下载" },
      { id: "xhs.publish_note", label: "图文发布" },
      { id: "xhs.publish_video", label: "视频发布" },
    ],
  },
  {
    key: "weibo",
    label: "微博",
    brand: "weibo",
    children: [
      { id: "weibo.login", label: "账号登录" },
      { id: "weibo.hot", label: "热搜榜" },
      { id: "weibo.detail", label: "榜单详情" },
      { id: "weibo.comments", label: "榜单评论区" },
    ],
  },
  {
    key: "data",
    label: "数据中心",
    children: [
      { id: "data.dashboard", label: "数据看板" },
      { id: "data.storage", label: "数据存储" },
    ],
  },
  {
    key: "control",
    label: "调度中心",
    children: [
      { id: "control.tasks", label: "任务提交" },
      { id: "control.schedule", label: "定时任务" },
      { id: "control.version", label: "版本更新" },
    ],
  },
];

export function defaultPageFor(workspace: WorkspaceKey): PageId {
  const group = NAV_TREE.find((g) => g.key === workspace);
  return group?.children[0]?.id ?? "dy.login";
}

export function workspaceOf(page: PageId): WorkspaceKey {
  return page.split(".")[0] as WorkspaceKey;
}

export function pageLabel(page: PageId): string {
  for (const g of NAV_TREE) {
    const hit = g.children.find((c) => c.id === page);
    if (hit) return hit.label;
  }
  return page;
}

/** @deprecated 兼容旧名 */
export type NavKey = WorkspaceKey;
