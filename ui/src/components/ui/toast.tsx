import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info" | "loading";

export type ToastPayload = {
  /** 一级类目，如「抖音」 */
  primary: string;
  /** 二级功能，如「图文发布」 */
  secondary: string;
  /** 信息正文 */
  message: string;
  tone?: ToastTone;
  /** 自动消失毫秒；loading 默认不自动关 */
  duration?: number;
};

type ToastItem = ToastPayload & {
  id: number;
  tone: ToastTone;
};

type ToastApi = {
  /** 模板：一级类目 - 二级功能 - 信息 */
  push: (payload: ToastPayload) => number;
  toast: (primary: string, secondary: string, message: string, tone?: ToastTone) => number;
  success: (primary: string, secondary: string, message: string) => number;
  error: (primary: string, secondary: string, message: string) => number;
  info: (primary: string, secondary: string, message: string) => number;
  loading: (primary: string, secondary: string, message: string) => number;
  dismiss: (id: number) => void;
  /** 兼容旧两段式：module 可为「一级-二级」或单段 */
  legacy: (module: string, message: string, tone?: ToastTone) => number;
};

const ToastContext = createContext<ToastApi | null>(null);

let seq = 1;

function splitModule(module: string): { primary: string; secondary: string } {
  const raw = String(module || "").trim();
  if (!raw) return { primary: "工作台", secondary: "提示" };
  const parts = raw.split(/[-–—·|/]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { primary: parts[0], secondary: parts.slice(1).join("-") };
  return { primary: "工作台", secondary: parts[0] };
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  const cls = "h-4 w-4 shrink-0";
  if (tone === "success") return <CheckCircle2 className={cn(cls, "text-emerald-500")} />;
  if (tone === "error") return <AlertCircle className={cn(cls, "text-rose-500")} />;
  if (tone === "loading") return <Loader2 className={cn(cls, "animate-spin text-sky-500")} />;
  return <Info className={cn(cls, "text-sky-500")} />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (payload: ToastPayload) => {
      const id = seq++;
      const tone = payload.tone || "info";
      const item: ToastItem = {
        id,
        primary: String(payload.primary || "工作台").trim(),
        secondary: String(payload.secondary || "提示").trim(),
        message: String(payload.message || "").trim(),
        tone,
      };
      setItems((prev) => {
        // loading：同模块只保留一条
        const filtered =
          tone === "loading"
            ? prev.filter(
                (t) =>
                  !(
                    t.tone === "loading" &&
                    t.primary === item.primary &&
                    t.secondary === item.secondary
                  )
              )
            : prev.filter(
                (t) =>
                  !(
                    t.tone === "loading" &&
                    t.primary === item.primary &&
                    t.secondary === item.secondary
                  )
              );
        return [...filtered, item].slice(-4);
      });

      const duration =
        payload.duration ??
        (tone === "loading" ? 0 : tone === "error" ? 5200 : 3800);
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      toast: (primary, secondary, message, tone = "info") =>
        push({ primary, secondary, message, tone }),
      success: (primary, secondary, message) =>
        push({ primary, secondary, message, tone: "success" }),
      error: (primary, secondary, message) =>
        push({ primary, secondary, message, tone: "error" }),
      info: (primary, secondary, message) =>
        push({ primary, secondary, message, tone: "info" }),
      loading: (primary, secondary, message) =>
        push({ primary, secondary, message, tone: "loading", duration: 0 }),
      legacy: (module, message, tone = "info") => {
        const { primary, secondary } = splitModule(module);
        return push({ primary, secondary, message, tone });
      },
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-7 right-7 z-[9999] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2.5"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto qs-toast-enter overflow-hidden rounded-2xl border bg-white/95 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.28)] backdrop-blur-md",
              t.tone === "success" && "border-emerald-100",
              t.tone === "error" && "border-rose-100",
              t.tone === "info" && "border-sky-100",
              t.tone === "loading" && "border-slate-100"
            )}
            role="status"
          >
            <div
              className={cn(
                "h-0.5 w-full",
                t.tone === "success" && "bg-gradient-to-r from-emerald-300 to-emerald-400",
                t.tone === "error" && "bg-gradient-to-r from-rose-300 to-rose-400",
                t.tone === "info" && "bg-gradient-to-r from-sky-300 to-sky-400",
                t.tone === "loading" && "bg-gradient-to-r from-sky-200 via-sky-400 to-sky-200 qs-toast-shine"
              )}
            />
            <div className="flex items-start gap-3 px-3.5 py-3">
              <div className="mt-0.5">
                <ToneIcon tone={t.tone} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-none text-slate-400">
                  <span className="font-medium text-slate-500">{t.primary}</span>
                  <span className="opacity-40">·</span>
                  <span className="font-medium text-slate-500">{t.secondary}</span>
                </div>
                <p className="mt-1.5 text-[13.5px] font-medium leading-snug text-slate-700">
                  {t.message}
                </p>
              </div>
              {t.tone !== "loading" ? (
                <button
                  type="button"
                  className="mt-0.5 rounded-full p-0.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-500"
                  aria-label="关闭"
                  onClick={() => dismiss(t.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => 0,
      dismiss: () => {},
      toast: () => 0,
      success: () => 0,
      error: () => 0,
      info: () => 0,
      loading: () => 0,
      legacy: () => 0,
    } satisfies ToastApi;
  }
  return ctx;
}

/** 全局快捷调用（非 React 树内兜底） */
export function emitToast(
  primaryOrModule: string,
  secondaryOrMessage: string,
  messageOrTone?: string | ToastTone,
  tone?: ToastTone
) {
  // 三段式：primary, secondary, message, tone?
  // 两段式兼容：module, message, tone?
  const detail: Record<string, unknown> = {};
  if (
    messageOrTone === undefined ||
    messageOrTone === "success" ||
    messageOrTone === "error" ||
    messageOrTone === "info" ||
    messageOrTone === "loading"
  ) {
    detail.module = primaryOrModule;
    detail.message = secondaryOrMessage;
    detail.tone = (messageOrTone as ToastTone) || "info";
  } else {
    detail.primary = primaryOrModule;
    detail.secondary = secondaryOrMessage;
    detail.message = messageOrTone;
    detail.tone = tone || "info";
  }
  window.dispatchEvent(new CustomEvent("qs:toast", { detail }));
}

export function ToastBridge() {
  const api = useToast();
  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.primary && d.secondary) {
        api.push({
          primary: String(d.primary),
          secondary: String(d.secondary),
          message: String(d.message || ""),
          tone: d.tone || "info",
          duration: d.duration,
        });
        return;
      }
      api.legacy(String(d.module || "提示"), String(d.message || ""), d.tone || "info");
    };
    window.addEventListener("qs:toast", onToast);
    return () => window.removeEventListener("qs:toast", onToast);
  }, [api]);
  return null;
}
