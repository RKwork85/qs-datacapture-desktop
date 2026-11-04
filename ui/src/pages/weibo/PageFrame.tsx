import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const FLOW = [
  { id: "weibo.login", label: "登录" },
  { id: "weibo.hot", label: "热搜" },
  { id: "weibo.detail", label: "详情" },
  { id: "weibo.comments", label: "评论区" },
] as const;

export function PageFrame({
  title,
  hint,
  pageId,
  children,
  className,
  layout = "form",
}: {
  title: string;
  hint?: string;
  pageId: string;
  children: ReactNode;
  className?: string;
  layout?: "form" | "wide";
}) {
  const stepIndex = FLOW.findIndex((f) => f.id === pageId);

  return (
    <div
      className={cn(
        "w-full",
        layout === "form" ? "mx-auto max-w-[900px]" : "max-w-none",
        className
      )}
    >
      {stepIndex >= 0 ? (
        <ol
          className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-none text-[#94a3b8]"
          aria-label="流程步骤"
        >
          {FLOW.map((f, i) => {
            const active = i === stepIndex;
            return (
              <li key={f.id} className="inline-flex items-center gap-2">
                {i > 0 ? <span className="text-[#cbd5e1]">/</span> : null}
                <span
                  className={cn(
                    active ? "font-semibold text-[var(--accent)]" : "font-normal text-[#94a3b8]"
                  )}
                >
                  {i + 1}. {f.label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-8 shadow-soft">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            {title}
          </h1>
          {hint ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
              {hint}
            </p>
          ) : null}
        </header>
        <div className="flex flex-col items-start gap-4">{children}</div>
      </section>
    </div>
  );
}

export const actionBtnClass = "h-9 w-fit shrink-0 px-6";
