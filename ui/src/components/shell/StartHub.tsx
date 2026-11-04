import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  Compass,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Globe2,
  LayoutGrid,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useDocPanel } from "@/context/DocPanelContext";
import { useTask } from "@/context/TaskContext";
import { brandIcons } from "@/assets/brands";
import { cn } from "@/lib/utils";

const WS_ROOT_KEY = "qs.workspace.root";

function useDocExpanded() {
  const [expanded, setExpanded] = useState(
    () => document.documentElement.dataset.qsDocExpanded === "1"
  );
  useEffect(() => {
    const sync = () =>
      setExpanded(document.documentElement.dataset.qsDocExpanded === "1");
    window.addEventListener("qs:doc-expanded-change", sync);
    return () => window.removeEventListener("qs:doc-expanded-change", sync);
  }, []);
  return expanded;
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-[#e2e8f0] bg-[#f8fafc] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--text-muted)]">
      {children}
    </kbd>
  );
}

function loadSavedRoot() {
  try {
    return localStorage.getItem(WS_ROOT_KEY) || "";
  } catch {
    return "";
  }
}

function saveRoot(p: string) {
  try {
    if (p) localStorage.setItem(WS_ROOT_KEY, p);
    else localStorage.removeItem(WS_ROOT_KEY);
  } catch {
    /* ignore */
  }
}

type DirEntry = {
  name: string;
  path: string;
  isDir: boolean;
  mtime: number;
  size?: number;
};

function FileIcon({ name, isDir, open }: { name: string; isDir: boolean; open?: boolean }) {
  if (isDir) {
    return open ? (
      <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
    ) : (
      <Folder className="h-4 w-4 shrink-0 text-amber-500" />
    );
  }
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    return <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />;
  }
  return <FileText className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />;
}

function TreeNode({
  entry,
  depth,
  onOpenFile,
}: {
  entry: DirEntry;
  depth: number;
  onOpenFile: (path: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadChildren = useCallback(async () => {
    if (!entry.isDir) return;
    setLoading(true);
    try {
      const res = await window.qsApi?.listDirEntries?.(entry.path);
      setChildren((res?.entries as DirEntry[]) || []);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [entry.isDir, entry.path]);

  const toggle = async () => {
    if (!entry.isDir) {
      onOpenFile(entry.path, entry.name);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) await loadChildren();
  };

  return (
    <div>
      <button
        type="button"
        className={cn(
          "group flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-[13px] text-[var(--text-primary)]",
          "transition-colors duration-150 ease-out",
          entry.isDir
            ? "hover:bg-[#f1f5f9]"
            : /\.(xlsx|xls|csv)$/i.test(entry.name)
              ? "hover:bg-emerald-50 hover:text-emerald-900"
              : "hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => void toggle()}
        title={entry.path}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-secondary)]">
          {entry.isDir ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="w-3.5" />
          )}
        </span>
        <FileIcon name={entry.name} isDir={entry.isDir} open={expanded} />
        <span className="min-w-0 truncate">{entry.name}</span>
        {loading ? <span className="ml-auto text-[10px] text-[var(--text-muted)]">…</span> : null}
      </button>
      {entry.isDir && expanded && children
        ? children.map((c) => (
            <TreeNode key={c.path} entry={c} depth={depth + 1} onOpenFile={onOpenFile} />
          ))
        : null}
    </div>
  );
}

function WorkspaceTreeView({
  root,
  onBack,
  onRootChange,
}: {
  root: string;
  onBack: () => void;
  onRootChange: (next: string) => void;
}) {
  const { openDoc, closePanel } = useDocPanel();
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(root);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setDraft(root);
  }, [root]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    window.qsApi
      ?.listDirEntries?.(root)
      .then((res) => {
        if (cancelled) return;
        if (res?.ok === false) {
          setError(res.error || "读取失败");
          setEntries([]);
          return;
        }
        setEntries((res?.entries as DirEntry[]) || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [root, tick]);

  const commitRoot = (next: string) => {
    const p = next.trim();
    if (!p) return;
    onRootChange(p);
    setEditing(false);
  };

  const pickDir = async () => {
    const p = await window.qsApi?.selectDir?.();
    if (p) commitRoot(p);
  };

  const docExpanded = useDocExpanded();

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#eef2f7] px-3">
        <FolderOpen className="h-4 w-4 text-amber-500" />
        <span className="flex-1 text-sm font-semibold text-[var(--text-primary)]">工作区文件</span>
        <button
          type="button"
          title="刷新"
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[#f1f5f9]"
          onClick={() => setTick((n) => n + 1)}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[#f1f5f9]"
          onClick={onBack}
        >
          返回
        </button>
        <button
          type="button"
          title={docExpanded ? "还原窗口" : "放大窗口"}
          className={cn(
            "rounded-md p-1.5 hover:bg-[#f1f5f9]",
            docExpanded ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--accent)]"
          )}
          onClick={() => window.dispatchEvent(new Event("qs:doc-toggle-expand"))}
        >
          {docExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          title="分栏 (Ctrl+\\)"
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--accent)]"
          onClick={() => window.dispatchEvent(new Event("qs:doc-toggle-split"))}
        >
          <Columns2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="收起侧栏"
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[#f1f5f9]"
          onClick={closePanel}
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      <div className="border-b border-[#eef2f7] bg-[#f8fafc] px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            根路径
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[10px] text-[var(--accent)] hover:bg-white"
              onClick={() => {
                setDraft(root);
                setEditing(true);
              }}
              title="编辑路径"
            >
              <Pencil className="inline h-3 w-3" /> 修改
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[10px] text-[var(--accent)] hover:bg-white"
              onClick={() => void pickDir()}
            >
              选择目录
            </button>
          </div>
        </div>
        {editing ? (
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRoot(draft);
                if (e.key === "Escape") setEditing(false);
              }}
              className="min-w-0 flex-1 rounded border border-[var(--accent)] bg-white px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] outline-none"
            />
            <button
              type="button"
              className="shrink-0 rounded bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-white"
              onClick={() => commitRoot(draft)}
            >
              确定
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="w-full break-all text-left font-mono text-[11px] leading-relaxed text-[var(--accent)] hover:underline"
            title="点击修改根路径"
            onClick={() => {
              setDraft(root);
              setEditing(true);
            }}
          >
            {root || "（未设置）"}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-2">
        {loading ? <p className="px-4 text-sm text-[var(--text-muted)]">加载中…</p> : null}
        {error ? <p className="px-4 text-sm text-[var(--danger)]">{error}</p> : null}
        {!loading && !error && !entries.length ? (
          <p className="px-4 text-sm text-[var(--text-muted)]">目录为空</p>
        ) : null}
        {entries.map((e) => (
          <TreeNode
            key={e.path}
            entry={e}
            depth={0}
            onOpenFile={(p, name) => openDoc(p, name)}
          />
        ))}
      </div>
    </div>
  );
}

type AuthFlags = Record<"dy" | "xhs" | "weibo", boolean>;

export function StartHub() {
  const { openWorkspaceFiles, closePanel } = useDocPanel();
  const { busy } = useTask();
  const [comingSoon, setComingSoon] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browseMsg, setBrowseMsg] = useState("");
  const [dataRoot, setDataRoot] = useState("");
  const [showTree, setShowTree] = useState(false);
  const [authReady, setAuthReady] = useState<AuthFlags>({
    dy: false,
    xhs: false,
    weibo: false,
  });

  const refreshAuthFlags = useCallback(async () => {
    try {
      const [dy, xhs, weibo] = await Promise.all([
        window.qsApi?.getDyAuthStatus?.(),
        window.qsApi?.getXhsAuthStatus?.(),
        window.qsApi?.getWeiboAuthStatus?.(),
      ]);
      setAuthReady({
        dy: Boolean(dy?.ready || dy?.hasCookie),
        xhs: Boolean(xhs?.ready || xhs?.hasCookie),
        weibo: Boolean(weibo?.ready || weibo?.hasAuth),
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onFocus = () => setBrowserOpen(true);
    const onTree = () => setShowTree(true);
    window.addEventListener("qs:focus-browser", onFocus);
    window.addEventListener("qs:show-workspace-tree", onTree);
    return () => {
      window.removeEventListener("qs:focus-browser", onFocus);
      window.removeEventListener("qs:show-workspace-tree", onTree);
    };
  }, []);

  useEffect(() => {
    if (!browserOpen) return;
    void refreshAuthFlags();
  }, [browserOpen, refreshAuthFlags]);

  useEffect(() => {
    const saved = loadSavedRoot();
    window.qsApi
      ?.getDataRoots?.()
      .then((r) => {
        const fallback = r?.root || "";
        setDataRoot(saved || fallback);
      })
      .catch(() => setDataRoot(saved));
  }, []);

  useEffect(() => {
    if (!comingSoon) return;
    const t = window.setTimeout(() => setComingSoon(false), 2200);
    return () => window.clearTimeout(t);
  }, [comingSoon]);

  const applyRoot = (next: string) => {
    setDataRoot(next);
    saveRoot(next);
  };

  async function browse(platform: "dy" | "xhs" | "weibo") {
    const label =
      platform === "dy" ? "抖音" : platform === "xhs" ? "小红书" : "微博";
    if (!authReady[platform]) {
      setBrowseMsg(`未找到${label}本地登录态，请先在「账号登录」完成登录`);
      return;
    }
    setBrowseMsg("");
    setBrowserOpen(false);
    try {
      const res = await window.qsApi?.browseOpen?.({ platform });
      if (res?.ok) {
        setBrowseMsg(`已打开${label}（携带登录态）`);
        await refreshAuthFlags();
      } else {
        setBrowseMsg(res?.error || `打开${label}失败`);
      }
    } catch (e) {
      setBrowseMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function clearCookie(platform: "dy" | "xhs" | "weibo") {
    const label =
      platform === "dy" ? "抖音" : platform === "xhs" ? "小红书" : "微博";
    const ok = window.confirm(
      `确认清除${label}本地 Cookie / 登录态？\n清除后需重新在「账号登录」完成登录。`
    );
    if (!ok) return;
    setBrowseMsg("");
    try {
      const res = await window.qsApi?.clearAuth?.(platform);
      if (res?.ok) {
        setBrowseMsg(`已清除${label}登录态，请重新登录`);
        setAuthReady((prev) => ({ ...prev, [platform]: false }));
        await refreshAuthFlags();
      } else {
        setBrowseMsg(res?.error || `清除${label}登录态失败`);
      }
    } catch (e) {
      setBrowseMsg(e instanceof Error ? e.message : String(e));
    }
  }

  // Hooks 必须在任何条件 return 之前调用，否则点「工作区文件」会因 hooks 顺序错乱卡死
  const docExpanded = useDocExpanded();

  if (showTree && dataRoot) {
    return (
      <WorkspaceTreeView
        root={dataRoot}
        onBack={() => setShowTree(false)}
        onRootChange={applyRoot}
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#eef2f7] px-3">
        <Compass className="h-4 w-4 text-[var(--accent)]" />
        <span className="flex-1 text-sm font-semibold text-[var(--text-primary)]">开始</span>
        <button
          type="button"
          title={docExpanded ? "还原窗口" : "放大窗口"}
          className={cn(
            "rounded-md p-1.5 hover:bg-[#f1f5f9]",
            docExpanded ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--accent)]"
          )}
          onClick={() => window.dispatchEvent(new Event("qs:doc-toggle-expand"))}
        >
          {docExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          title="分栏 (Ctrl+\\)"
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--accent)]"
          onClick={() => window.dispatchEvent(new Event("qs:doc-toggle-split"))}
        >
          <Columns2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="收起侧栏"
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--text-primary)]"
          onClick={closePanel}
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto px-5 py-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-start justify-center pt-10 opacity-[0.06]"
        >
          <Compass className="h-40 w-40 text-[var(--accent)]" strokeWidth={1} />
        </div>

        <div className="relative z-[1] mx-auto flex w-full max-w-[420px] flex-col gap-3">
          <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
            <button
              type="button"
              onClick={() => {
                if (dataRoot) setShowTree(true);
                else void openWorkspaceFiles();
              }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#f8fbff]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff7ed] text-amber-500">
                <Folder className="h-5 w-5 fill-amber-400 text-amber-500" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">
                  工作区文件
                </span>
                <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                  在本页打开目录树
                </span>
              </span>
              <Kbd>Ctrl + P</Kbd>
            </button>
            {dataRoot ? (
              <WorkspaceRootEditor root={dataRoot} onChange={applyRoot} onOpenTree={() => setShowTree(true)} />
            ) : null}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setBrowserOpen((v) => !v)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left shadow-sm transition-colors",
                browserOpen
                  ? "border-[var(--accent)] bg-[#f1f5ff]"
                  : "border-[#e2e8f0] bg-white hover:border-[var(--accent)] hover:bg-[#f8fbff]"
              )}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eff6ff] text-sky-600">
                <Globe2 className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">浏览器</span>
                <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                  附带 Cookie 浏览抖音 / 小红书 / 微博
                </span>
              </span>
              <Kbd>Ctrl + T</Kbd>
            </button>

            {browserOpen ? (
              <div className="mt-2 overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-soft">
                {(
                  [
                    {
                      id: "dy" as const,
                      label: "抖音",
                      hint: "注入本地登录态打开",
                      icon: brandIcons.dy,
                    },
                    {
                      id: "xhs" as const,
                      label: "小红书",
                      hint: "注入本地 Cookie 打开",
                      icon: brandIcons.xhs,
                    },
                    {
                      id: "weibo" as const,
                      label: "微博",
                      hint: "注入本地登录态打开",
                      icon: brandIcons.weibo,
                    },
                  ] as const
                ).map((item, i) => (
                  <div key={item.id}>
                    {i > 0 ? <div className="h-px bg-[#eef2f7]" /> : null}
                    <div
                      className={cn(
                        "flex items-center gap-1 px-2 py-1.5",
                        authReady[item.id] ? "hover:bg-[#f8fafc]" : "opacity-50"
                      )}
                    >
                      <button
                        type="button"
                        disabled={busy || !authReady[item.id]}
                        title={
                          authReady[item.id]
                            ? `打开${item.label}`
                            : `未找到${item.label}本地登录态，请先在「账号登录」完成登录`
                        }
                        onClick={() => void browse(item.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <img
                          src={item.icon}
                          alt=""
                          className="h-6 w-6 rounded-[4px] object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-[var(--text-primary)]">
                            {item.label}
                          </span>
                          <span className="block text-xs text-[var(--text-muted)]">
                            {authReady[item.id]
                              ? item.hint
                              : "未登录，请先完成账号登录"}
                          </span>
                        </span>
                      </button>
                      {authReady[item.id] ? (
                        <button
                          type="button"
                          disabled={busy}
                          title={`清除${item.label} Cookie，清除后需重新登录`}
                          aria-label={`清除${item.label} Cookie`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void clearCookie(item.id);
                          }}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setComingSoon(true)}
            className="relative flex items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3.5 text-left shadow-sm transition-colors hover:bg-[#f8fafc]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1f5f9] text-[var(--text-secondary)]">
              <LayoutGrid className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--text-primary)]">更多工具</span>
              <span className="mt-0.5 block text-xs text-[var(--text-muted)]">扩展能力即将上线</span>
            </span>
            {comingSoon ? (
              <span className="absolute -top-2 right-3 rounded-full bg-[#0f172a] px-2.5 py-1 text-[11px] font-medium text-white shadow-lg">
                敬请期待
              </span>
            ) : (
              <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                敬请期待
              </span>
            )}
          </button>

          {browseMsg ? (
            <p className="px-1 text-center text-xs text-[var(--text-muted)]">{browseMsg}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorkspaceRootEditor({
  root,
  onChange,
  onOpenTree,
}: {
  root: string;
  onChange: (next: string) => void;
  onOpenTree: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(root);

  useEffect(() => {
    setDraft(root);
  }, [root]);

  const commit = () => {
    const p = draft.trim();
    if (p) onChange(p);
    setEditing(false);
  };

  return (
    <div className="flex items-start gap-2 border-t border-[#eef2f7] bg-[#f8fafc] px-4 py-2.5">
      <span className="shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        根路径
      </span>
      {editing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded border border-[var(--accent)] bg-white px-2 py-1 font-mono text-[11px] outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="text-[11px] font-medium text-[var(--accent)]"
              onClick={commit}
            >
              确定
            </button>
            <button
              type="button"
              className="text-[11px] text-[var(--text-muted)]"
              onClick={async () => {
                const p = await window.qsApi?.selectDir?.();
                if (p) {
                  onChange(p);
                  setEditing(false);
                  onOpenTree();
                }
              }}
            >
              选择目录
            </button>
            <button
              type="button"
              className="text-[11px] text-[var(--text-muted)]"
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          title="点击修改根路径"
          className="min-w-0 flex-1 break-all text-left font-mono text-[11px] leading-relaxed text-[var(--accent)] hover:underline"
          onClick={() => {
            setDraft(root);
            setEditing(true);
          }}
        >
          {root}
        </button>
      )}
    </div>
  );
}
