import { pageLabel, type PageId, type WorkspaceKey } from "@/nav/tree";

const WS_TITLE: Record<WorkspaceKey, string> = {
  dy: "抖音",
  xhs: "小红书",
  weibo: "微博",
  data: "数据",
  control: "调度中心",
};

/** 占位页：与表单页同一居中宽度规范 */
export function PageStub({ workspace, page }: { workspace: WorkspaceKey; page: PageId }) {
  const title = pageLabel(page);
  return (
    <div className="mx-auto w-full max-w-[900px]">
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-8 shadow-soft">
        <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--text-muted)]">
          {WS_TITLE[workspace]}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          这里是「{title}」页面占位，稍后接入具体表单。
        </p>
        <p className="mt-4 font-mono text-xs text-[var(--text-muted)]">route: {page}</p>
      </div>
    </div>
  );
}
