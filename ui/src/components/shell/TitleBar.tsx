import { useEffect, useState, type ReactNode } from "react";
import { Minus, Square, X, Copy, Monitor, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyThemeClass, storeTheme } from "@/lib/theme";
import { useDocPanel } from "@/context/DocPanelContext";

/**
 * 标题栏：
 * - 空白区 drag；按钮区 no-drag
 * - 打开侧边栏（Ctrl+Alt+B）
 * - 主题图标保留展示，暂不支持切换夜间模式（固定浅色）
 */
export function TitleBar() {
  const { open, togglePanel, showStart } = useDocPanel();
  const [maximized, setMaximized] = useState(false);
  const nativeOverlay = Boolean(window.qsApi?.usesNativeTitleOverlay?.());

  useEffect(() => {
    storeTheme("light");
    applyThemeClass("light");
  }, []);

  useEffect(() => {
    window.qsApi?.windowIsMaximized?.().then(setMaximized).catch(() => {});
    return window.qsApi?.onWindowMaximizeChange?.((v) => setMaximized(v));
  }, []);

  useEffect(() => {
    return window.qsApi?.onPaintBackground?.((color) => {
      const c = String(color || "").trim();
      if (!c) return;
      document.documentElement.style.background = c;
      document.body.style.background = c;
      const root = document.getElementById("root");
      if (root) root.style.background = c;
    });
  }, []);

  return (
    <header className="relative flex h-[var(--titlebar-h)] shrink-0 items-stretch bg-[var(--bg-elevated)]">
      <div className="drag-region flex min-w-0 flex-1 items-center gap-2 pl-4">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[var(--accent)] text-[10px] font-bold text-[var(--accent-foreground)]">
          QS
        </div>
        <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
          轻采QS
        </span>
      </div>

      <div className="no-drag flex items-center gap-1 pr-1">
        {/* 打开侧边栏 */}
        <div className="group relative">
          <button
            type="button"
            data-qs-doc-toggle
            aria-label={open ? "收起侧边栏" : "打开侧边栏"}
            onClick={() => {
              if (open) togglePanel();
              else showStart();
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
              open
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--text-primary)]"
            )}
          >
            <PanelRight className="h-4 w-4" />
          </button>
          <div className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-50 hidden whitespace-nowrap rounded-full bg-[#0f172a] px-3 py-1.5 text-[11px] text-white shadow-lg group-hover:flex group-hover:items-center group-hover:gap-2">
            <span>{open ? "收起侧边栏" : "打开侧边栏"}</span>
            <span className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/85">
              Ctrl + Alt + B
            </span>
          </div>
        </div>

        <span
          title="浅色主题（暂不支持切换）"
          aria-label="浅色主题"
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--accent)]"
        >
          <Monitor className="h-3.5 w-3.5" />
        </span>
      </div>

      {/* Windows 使用系统 titleBarOverlay，不再自绘三键，消除拉伸黑边 */}
      {!nativeOverlay ? (
        <div className="no-drag flex items-stretch">
          <WinBtn label="最小化" onClick={() => window.qsApi?.windowMinimize?.()}>
            <Minus className="h-3.5 w-3.5" strokeWidth={2} />
          </WinBtn>
          <WinBtn
            label={maximized ? "还原" : "最大化"}
            onClick={() => window.qsApi?.windowMaximize?.()}
          >
            {maximized ? (
              <Copy className="h-3 w-3" strokeWidth={2} />
            ) : (
              <Square className="h-3 w-3" strokeWidth={2} />
            )}
          </WinBtn>
          <WinBtn label="关闭" danger onClick={() => window.qsApi?.windowClose?.()}>
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </WinBtn>
        </div>
      ) : (
        <div className="w-[138px] shrink-0" aria-hidden />
      )}

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--accent)] opacity-80"
      />
    </header>
  );
}

function WinBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-full w-11 cursor-pointer items-center justify-center text-[var(--text-secondary)] transition-colors duration-fast ease-out",
        danger
          ? "hover:bg-[var(--danger)] hover:text-white"
          : "hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
      )}
    >
      {children}
    </button>
  );
}
