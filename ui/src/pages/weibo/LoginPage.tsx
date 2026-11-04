import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { useWeiboFlow } from "./WeiboFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

type AuthStatus = {
  hasAuth?: boolean;
  ready?: boolean;
  authPath?: string;
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
  const { setLastOut } = useWeiboFlow();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [checking, setChecking] = useState(true);

  async function refreshStatus() {
    setChecking(true);
    try {
      const st = await window.qsApi?.getWeiboAuthStatus?.();
      setStatus(st || { hasAuth: false, ready: false });
      if (st?.authPath) setLastOut(st.authPath);
    } catch {
      setStatus({ hasAuth: false, ready: false });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function useLocal() {
    const res = await runTask("weibo.login", {});
    if (!res.ok) {
      await refreshStatus();
      return;
    }
    const path = (res.result?.authPath as string) || status?.authPath || "";
    if (path) setLastOut(path);
    goTo("weibo.hot");
  }

  async function forceScan() {
    const res = await runTask("weibo.login", { forceScan: true });
    if (!res.ok) {
      await refreshStatus();
      return;
    }
    const path = (res.result?.authPath as string) || "";
    if (path) setLastOut(path);
    await refreshStatus();
    goTo("weibo.hot");
  }

  const ready = Boolean(status?.ready);

  return (
    <PageFrame
      pageId="weibo.login"
      title="账号登录"
      hint="优先读取本机微博登录态并打开浏览器注入 Cookie；失效后再扫码。登录成功后浏览器保持打开。"
    >
      <div className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
        {checking ? (
          <p className="text-sm text-[var(--text-muted)]">正在读取本地登录态…</p>
        ) : ready ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--success)]">已读取本地登录态，可直接进入</p>
            <p className="truncate text-xs text-[var(--text-muted)]">
              {status?.authPath}
              {status?.mtime ? ` · ${fmtMtime(status.mtime)}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">未找到有效登录态，请扫码登录</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ready ? (
          <>
            <Button
              className={actionBtnClass}
              loading={busy}
              disabled={busy || checking}
              onClick={() => void useLocal()}
            >
              使用本地登录态进入
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
          onClick={() => goTo("weibo.hot")}
        >
          跳过，去热搜榜
        </Button>
      </div>
    </PageFrame>
  );
}
