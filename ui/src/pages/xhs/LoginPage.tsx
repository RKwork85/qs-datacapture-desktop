import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { useXhsFlow } from "./XhsFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

type AuthStatus = {
  hasCookie?: boolean;
  ready?: boolean;
  missing?: string[];
  cookiePath?: string;
  mtime?: number;
};

function fmtMtime(ms?: number) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LoginPage() {
  const { busy, runTask } = useTask();
  const { goTo } = useNav();
  const { setLastOut } = useXhsFlow();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [checking, setChecking] = useState(true);

  async function refreshStatus() {
    setChecking(true);
    try {
      const st = await window.qsApi?.getXhsAuthStatus?.();
      setStatus(st || { hasCookie: false, ready: false });
      if (st?.cookiePath) setLastOut(st.cookiePath);
    } catch {
      setStatus({ hasCookie: false, ready: false });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function useLocalCookie() {
    const res = await runTask("xhs.login", {});
    if (!res.ok) {
      await refreshStatus();
      return;
    }
    const path = (res.result?.cookiePath as string) || status?.cookiePath || "";
    if (path) setLastOut(path);
    goTo("xhs.collect");
  }

  async function forceScan() {
    const res = await runTask("xhs.login", { forceScan: true });
    if (!res.ok) {
      await refreshStatus();
      return;
    }
    const path = (res.result?.cookiePath as string) || "";
    if (path) setLastOut(path);
    await refreshStatus();
    goTo("xhs.collect");
  }

  const ready = Boolean(status?.ready);

  return (
    <PageFrame
      pageId="xhs.login"
      title="账号登录"
      hint="打开软件时优先读取本机 Cookie；点「使用本地 Cookie 进入」会打开小红书并注入登录态。失效后再扫码。"
    >
      <div className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
        {checking ? (
          <p className="text-sm text-[var(--text-muted)]">正在读取本地 Cookie…</p>
        ) : ready ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--success)]">已读取本地 Cookie，可直接使用</p>
            <p className="truncate text-xs text-[var(--text-muted)]">
              {status?.cookiePath}
              {status?.mtime ? ` · ${fmtMtime(status.mtime)}` : ""}
            </p>
          </div>
        ) : status?.hasCookie ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--danger)]">本地 Cookie 不完整，需重新登录</p>
            <p className="text-xs text-[var(--text-muted)]">
              缺少：{(status.missing || []).join(", ") || "关键字段"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">未找到本地 Cookie，请扫码登录</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ready ? (
          <>
            <Button
              className={actionBtnClass}
              loading={busy}
              disabled={busy || checking}
              onClick={() => void useLocalCookie()}
            >
              使用本地 Cookie 进入
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-9 w-fit px-4"
              loading={busy}
              disabled={busy || checking}
              onClick={() => void forceScan()}
            >
              重新扫码
            </Button>
          </>
        ) : (
          <Button
            className={actionBtnClass}
            loading={busy}
            disabled={busy || checking}
            onClick={() => void forceScan()}
          >
            扫码登录
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy}
          onClick={() => goTo("xhs.collect")}
        >
          跳过，去采集
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy || checking}
          onClick={() => void refreshStatus()}
        >
          重新检测
        </Button>
      </div>
    </PageFrame>
  );
}
