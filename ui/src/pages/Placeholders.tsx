import type { NavKey } from "@/components/shell/Sidebar";

/** 业务页占位：纯文字标题，无 Logo / 无装饰图标 */
export function PagePlaceholder({ active }: { active: NavKey }) {
  const meta: Record<NavKey, { title: string; desc: string }> = {
    xhs: {
      title: "小红书工作区",
      desc: "登录 / 采集 / 下载 / 发布 — 待确认视觉后继续改造",
    },
    weibo: {
      title: "微博工作区",
      desc: "热搜 / 流水线 — 待确认视觉后继续改造",
    },
    control: {
      title: "调度中心",
      desc: "任务提交 / 定时任务 / 版本更新",
    },
  };
  const m = meta[active];

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-8 shadow-soft">
      <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">{m.title}</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">{m.desc}</p>
    </div>
  );
}
