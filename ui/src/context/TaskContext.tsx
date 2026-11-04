import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { emitToast } from "@/components/ui/toast";
import {
  friendlyStartMessage,
  friendlySuccessMessage,
  formatElapsed,
  labelForTask,
  withElapsed,
} from "@/lib/taskLabels";

export type TaskResult = {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
};

type TaskContextValue = {
  busy: boolean;
  runTask: (type: string, params?: Record<string, unknown>) => Promise<TaskResult>;
};

const TaskContext = createContext<TaskContextValue | null>(null);

/** 采集 / 下载类任务：启动时弹出运行日志（现已对所有任务展开，此函数仍可用于特殊逻辑） */
export function isCollectOrDownloadTask(type: string) {
  return /fetch_profile|fetch_media|fetch_note|weibo\.(hot|detail|comments|daily)|publish_/i.test(
    type
  );
}

export function TaskProvider({
  children,
  onLocalLog,
  onTaskStart,
  onTaskEnd,
}: {
  children: ReactNode;
  /** 仅用于 UI 侧本地提示行；主进程 task:log 仍由 AppShell onLog 接收 */
  onLocalLog?: (message: string, level?: "info" | "warn" | "error") => void;
  /** 任务真正开始执行时回调（用于展开运行日志等） */
  onTaskStart?: (type: string) => void;
  onTaskEnd?: (type: string, ok: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const runTask = useCallback(
    async (type: string, params: Record<string, unknown> = {}): Promise<TaskResult> => {
      const label = labelForTask(type);
      if (!window.qsApi?.runTask) {
        const error = "当前环境无 qsApi.runTask（请在 Electron 中运行）";
        onLocalLog?.(error, "error");
        emitToast(label.primary, label.secondary, error, "error");
        return { ok: false, error };
      }
      if (busyRef.current) {
        onLocalLog?.("已有任务在执行", "warn");
        emitToast(label.primary, label.secondary, "已有任务在执行，请稍后再试", "info");
        return { ok: false, error: "busy" };
      }
      busyRef.current = true;
      setBusy(true);
      const startedAt = Date.now();
      onTaskStart?.(type);
      onLocalLog?.(`>>> 开始任务 ${type}`, "info");
      emitToast(label.primary, label.secondary, friendlyStartMessage(type), "loading");
      try {
        const res = (await window.qsApi.runTask(type, params)) as TaskResult;
        const elapsed = Date.now() - startedAt;
        if (res?.ok) {
          const hint =
            (res.result?.csvPath as string) ||
            (res.result?.xlsxPath as string) ||
            (res.result?.outRoot as string) ||
            (res.result?.cookiePath as string) ||
            "";
          onLocalLog?.(
            `<<< 完成 ${type}（耗时 ${formatElapsed(elapsed)}）${hint ? `: ${hint}` : ""}`,
            "info"
          );
          emitToast(
            label.primary,
            label.secondary,
            withElapsed(friendlySuccessMessage(type, res.result || {}), elapsed),
            "success"
          );
          onTaskEnd?.(type, true);
          return { ok: true, result: { ...(res.result || {}), elapsedMs: elapsed } };
        }
        const err = res?.error || "未知错误";
        onLocalLog?.(`<<< 失败 ${type}（耗时 ${formatElapsed(elapsed)}）: ${err}`, "error");
        emitToast(label.primary, label.secondary, withElapsed(err, elapsed), "error");
        onTaskEnd?.(type, false);
        return { ok: false, error: err, result: { elapsedMs: elapsed } };
      } catch (e) {
        const elapsed = Date.now() - startedAt;
        const err = e instanceof Error ? e.message : String(e);
        onLocalLog?.(`${err}（耗时 ${formatElapsed(elapsed)}）`, "error");
        emitToast(label.primary, label.secondary, withElapsed(err, elapsed), "error");
        onTaskEnd?.(type, false);
        return { ok: false, error: err, result: { elapsedMs: elapsed } };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onLocalLog, onTaskStart, onTaskEnd]
  );

  const value = useMemo(() => ({ busy, runTask }), [busy, runTask]);

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTask() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTask must be used within TaskProvider");
  return ctx;
}
