import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronDown, ChevronUp, FolderOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDocPanel } from "@/context/DocPanelContext";

const MIN_H = 140;
const MAX_H = 480;

/**
 * 底栏日志：
 * - 有功能执行时由 AppShell 自动展开，并滚到底部
 * - 点击日志以外区域时收缩
 * - 展开后顶部拖条可调高度
 */
export function ConsoleDock({
  open,
  onToggle,
  height,
  onHeightChange,
  lines,
  onClear,
}: {
  open: boolean;
  onToggle: () => void;
  height: number;
  onHeightChange: (h: number) => void;
  lines: string[];
  onClear: () => void;
}) {
  const dragging = useRef(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const { openFilePicker, showStart, open: panelOpen } = useDocPanel();

  // 新日志到来时滚到最底部
  useEffect(() => {
    if (!open) return;
    const el = preRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [lines, open]);

  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      if (!open) return;
      e.preventDefault();
      dragging.current = true;
      const startY = e.clientY;
      const startH = height;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const next = Math.min(MAX_H, Math.max(MIN_H, startH + (startY - ev.clientY)));
        onHeightChange(next);
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [height, onHeightChange, open]
  );

  return (
    <section
      ref={rootRef}
      data-qs-console-dock
      className={cn(
        "relative flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--bg-console)]",
        open ? "" : "h-10"
      )}
      style={open ? { height } : undefined}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖拽调整日志高度"
          onMouseDown={onResizeStart}
          className="absolute inset-x-0 top-0 z-10 flex h-2 cursor-ns-resize items-center justify-center"
        >
          <span className="h-0.5 w-10 rounded-full bg-[var(--border-strong)]" />
        </div>
      )}

      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] transition-colors duration-fast hover:text-[var(--accent)]"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          运行日志
          <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-[var(--accent)]">
            {lines.length}
          </span>
        </button>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-qs-doc-toggle
            className="h-7 gap-1.5 px-2"
            title="打开文件（在右侧侧栏预览）"
            onClick={() => {
              if (!panelOpen) showStart();
              void openFilePicker();
            }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            打开文件
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" onClick={onClear}>
            <Trash2 className="h-3.5 w-3.5" />
            清空
          </Button>
        </div>
      </div>

      {open && (
        <pre
          ref={preRef}
          className="scroll-thin m-0 min-h-0 flex-1 overflow-auto px-3 pb-3 font-mono text-xs leading-[1.55] text-[var(--text-secondary)] whitespace-pre-wrap"
        >
          {lines.length ? lines.join("\n") : "暂无日志。执行任务后会显示在这里。"}
        </pre>
      )}
    </section>
  );
}
