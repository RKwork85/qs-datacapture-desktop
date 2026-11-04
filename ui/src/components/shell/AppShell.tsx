import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { ConsoleDock } from "./ConsoleDock";
import { DocSidePanel } from "./DocSidePanel";
import { TaskProvider, useTask } from "@/context/TaskContext";
import { NavProvider } from "@/context/NavContext";
import { DocPanelProvider, useDocPanel } from "@/context/DocPanelContext";
import { ToastBridge, ToastProvider } from "@/components/ui/toast";
import { defaultPageFor, type PageId, type WorkspaceKey } from "@/nav/tree";

function isErrorLog(payload: { level?: string; message: string }) {
  if (payload.level === "error") return true;
  return /失败|错误|error|Error|EXCEPTION|超时/i.test(payload.message || "");
}

function ShellBody({
  annotate,
  children,
  consoleOpen,
  setConsoleOpen,
  consoleHeight,
  setConsoleHeight,
  lines,
  setLines,
}: {
  annotate: boolean;
  children: (ctx: { workspace: WorkspaceKey; page: PageId }) => ReactNode;
  consoleOpen: boolean;
  setConsoleOpen: Dispatch<SetStateAction<boolean>>;
  consoleHeight: number;
  setConsoleHeight: Dispatch<SetStateAction<number>>;
  lines: string[];
  setLines: Dispatch<SetStateAction<string[]>>;
}) {
  const { busy } = useTask();
  const { closePanel } = useDocPanel();
  const [workspace, setWorkspace] = useState<WorkspaceKey>("dy");
  const [page, setPage] = useState<PageId>(() => defaultPageFor("dy"));
  const [collapseEnabled, setCollapseEnabled] = useState(() => {
    try {
      return localStorage.getItem("qs.nav.collapseEnabled") === "1";
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try {
      if (localStorage.getItem("qs.nav.collapseEnabled") !== "1") return false;
      return localStorage.getItem("qs.nav.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [docExpanded, setDocExpanded] = useState(false);

  const toggleCollapse = useCallback(() => {
    if (!collapseEnabled) return;
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("qs.nav.collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [collapseEnabled]);

  const toggleCollapseFeature = useCallback(() => {
    setCollapseEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("qs.nav.collapseEnabled", next ? "1" : "0");
        if (!next) localStorage.setItem("qs.nav.collapsed", "0");
      } catch {
        /* ignore */
      }
      if (!next) setCollapsed(false);
      return next;
    });
  }, []);

  useEffect(() => {
    const sync = () =>
      setDocExpanded(document.documentElement.dataset.qsDocExpanded === "1");
    sync();
    window.addEventListener("qs:doc-expanded-change", sync);
    return () => window.removeEventListener("qs:doc-expanded-change", sync);
  }, []);

  // 点击日志以外区域 → 收缩运行日志（执行中不收）
  useEffect(() => {
    if (!consoleOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (busy) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-qs-console-dock]")) return;
      setConsoleOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointer, true);
    }, 80);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointer, true);
    };
  }, [consoleOpen, busy, setConsoleOpen]);

  const onNavigate = useCallback(
    (ws: WorkspaceKey, nextPage: PageId) => {
      if (document.documentElement.dataset.qsDocExpanded === "1") {
        window.dispatchEvent(new CustomEvent("qs:doc-force-collapse"));
        closePanel();
      }
      setWorkspace(ws);
      setPage(nextPage);
    },
    [closePanel]
  );

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden bg-[var(--bg-base)]${
        annotate ? " token-annotate" : ""
      }`}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          workspace={workspace}
          page={page}
          onNavigate={onNavigate}
          busy={busy}
          collapsed={collapsed}
          collapseEnabled={collapseEnabled}
          onToggleCollapse={toggleCollapse}
          onToggleCollapseFeature={toggleCollapseFeature}
        />

        <div
          className={`flex min-w-0 flex-col overflow-hidden transition-[width,opacity,flex-grow] duration-200 ${
            docExpanded
              ? "pointer-events-none w-0 min-w-0 flex-none opacity-0"
              : "flex-1 opacity-100"
          }`}
        >
          <NavProvider workspace={workspace} page={page} onNavigate={onNavigate}>
            <main className="scroll-thin min-h-0 flex-1 overflow-auto bg-[var(--bg-base)]">
              <div className="w-full min-w-0 px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-7">
                {children({ workspace, page })}
              </div>
            </main>

            <ConsoleDock
              open={consoleOpen}
              onToggle={() => setConsoleOpen((v) => !v)}
              height={consoleHeight}
              onHeightChange={setConsoleHeight}
              lines={lines}
              onClear={() => setLines([])}
            />
          </NavProvider>
        </div>

        <DocSidePanel />
      </div>
    </div>
  );
}

export function AppShell({
  annotate = false,
  children,
}: {
  annotate?: boolean;
  children: (ctx: { workspace: WorkspaceKey; page: PageId }) => ReactNode;
}) {
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(220);
  const [lines, setLines] = useState<string[]>([
    "[shell] 功能执行时会自动展开运行日志；点击其它区域可收起。",
  ]);

  const pushLog = useCallback((message: string, level?: string) => {
    setLines((prev) => [...prev, message].slice(-500));
    if (level === "error" || isErrorLog({ level, message })) setConsoleOpen(true);
  }, []);

  useEffect(() => {
    return window.qsApi?.onLog?.((payload) => {
      pushLog(payload.message, payload.level);
    });
  }, [pushLog]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("qs:open-settings"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ToastProvider>
      <ToastBridge />
      <TaskProvider
        onLocalLog={(message, level) => pushLog(message, level)}
        onTaskStart={() => {
          // 任意功能执行：自动弹出日志
          setConsoleOpen(true);
        }}
      >
        <DocPanelProvider>
          <ShellBody
            annotate={annotate}
            consoleOpen={consoleOpen}
            setConsoleOpen={setConsoleOpen}
            consoleHeight={consoleHeight}
            setConsoleHeight={setConsoleHeight}
            lines={lines}
            setLines={setLines}
          >
            {children}
          </ShellBody>
        </DocPanelProvider>
      </TaskProvider>
    </ToastProvider>
  );
}
