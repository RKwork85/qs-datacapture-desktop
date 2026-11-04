import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { marked } from "marked";
import {
  Columns2,
  ExternalLink,
  FileImage,
  FileSpreadsheet,
  FileText,
  Film,
  FolderOpen,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useDocPanel, type DocKind, type DocTab } from "@/context/DocPanelContext";
import { emitToast } from "@/components/ui/toast";
import { StartHub } from "./StartHub";
import { cn } from "@/lib/utils";

type BrowsePlatform = "dy" | "xhs" | "weibo";

function looksLikeHttpUrl(raw: string) {
  const v = String(raw || "").trim();
  if (!v) return false;
  return /^https?:\/\/\S+/i.test(v);
}

function platformFromUrl(raw: string): BrowsePlatform | null {
  const v = String(raw || "").toLowerCase();
  if (/douyin\.com|iesdouyin\.com|tiktok\.com/.test(v)) return "dy";
  if (/xiaohongshu\.com|xhslink\.com/.test(v)) return "xhs";
  if (/weibo\.com|weibo\.cn/.test(v)) return "weibo";
  return null;
}

async function openTableLink(url: string) {
  const href = url.trim();
  const platform = platformFromUrl(href);
  if (!platform) {
    emitToast("表格链接", "无法识别平台", "仅支持抖音 / 小红书 / 微博链接", "warn");
    return;
  }
  const label =
    platform === "dy" ? "抖音" : platform === "xhs" ? "小红书" : "微博";
  try {
    const res = await window.qsApi?.browseOpen?.({ platform, url: href });
    if (res?.ok) {
      emitToast("表格链接", `已用${label}登录态打开`, "浏览器保持打开，可继续下载", "success");
      return;
    }
    emitToast(
      "表格链接",
      "打开失败",
      res?.error || `请先完成${label}账号登录后再试`,
      "error"
    );
  } catch (e) {
    emitToast(
      "表格链接",
      "打开失败",
      e instanceof Error ? e.message : String(e),
      "error"
    );
  }
}

function TableCellValue({ value }: { value: string }) {
  const text = String(value || "");
  if (!looksLikeHttpUrl(text)) {
    return <>{text || "—"}</>;
  }
  return (
    <button
      type="button"
      title={`携带 Cookie 打开：${text}`}
      className="block w-full truncate text-left text-inherit"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void openTableLink(text);
      }}
    >
      {text}
    </button>
  );
}

const DOC_WIDTH_KEY = "qs.doc.panel.width";
const DOC_WIDTH_MIN = 360;
const DOC_WIDTH_MAX = 960;
const DOC_WIDTH_DEFAULT = 480;
const DOC_WIDTH_SPLIT_MIN = 880;
/** 主工作区最多被收缩 60% → 右侧栏拖拽上限 = 工作区宽度的 60%（主区至少留 40%） */
const WORK_SHRINK_MAX_RATIO = 0.6;

type WorkLayout = { navW: number; rowW: number; workW: number };

function measureWorkLayout(panelEl: HTMLElement | null): WorkLayout {
  const row = panelEl?.parentElement;
  const sidebar = document.querySelector("[data-qs-sidebar]");
  const navW =
    sidebar instanceof HTMLElement
      ? Math.ceil(sidebar.getBoundingClientRect().width)
      : 252;
  const rowW = row?.clientWidth || window.innerWidth || 1280;
  const workW = Math.max(0, Math.floor(rowW - navW));
  return { navW, rowW, workW };
}

/** 放大铺满：占满左侧导航以外的全部工作区（与拖拽上限无关） */
function measureFillWidth(panelEl: HTMLElement | null) {
  const { workW } = measureWorkLayout(panelEl);
  return Math.max(DOC_WIDTH_MIN, workW);
}

/**
 * 拖拽收缩上限：右栏最多占工作区 60%。
 * 小窗口时允许低于 DOC_WIDTH_MIN，避免 360 已超过 60% 导致无法布局。
 */
function measureDragMaxWidth(panelEl: HTMLElement | null) {
  const { workW } = measureWorkLayout(panelEl);
  const byRatio = Math.floor(workW * WORK_SHRINK_MAX_RATIO);
  const hardCap = Math.min(DOC_WIDTH_MAX, byRatio);
  const softMin = Math.min(DOC_WIDTH_MIN, hardCap);
  return Math.max(softMin, hardCap);
}

function clampPanelWidth(w: number, panelEl: HTMLElement | null) {
  const max = measureDragMaxWidth(panelEl);
  const min = Math.min(DOC_WIDTH_MIN, max);
  return Math.min(max, Math.max(min, w));
}

function setDocExpandedAttr(on: boolean) {
  try {
    if (on) document.documentElement.dataset.qsDocExpanded = "1";
    else delete document.documentElement.dataset.qsDocExpanded;
    window.dispatchEvent(new Event("qs:doc-expanded-change"));
  } catch {
    /* ignore */
  }
}

function loadDocWidth() {
  try {
    const n = Number(localStorage.getItem(DOC_WIDTH_KEY) || DOC_WIDTH_DEFAULT);
    return Number.isFinite(n)
      ? Math.min(DOC_WIDTH_MAX, Math.max(DOC_WIDTH_MIN, n))
      : DOC_WIDTH_DEFAULT;
  } catch {
    return DOC_WIDTH_DEFAULT;
  }
}

marked.setOptions({ gfm: true, breaks: true });

function kindLabel(kind: DocKind) {
  if (kind === "xlsx") return "Excel";
  if (kind === "markdown") return "Markdown";
  if (kind === "csv") return "CSV";
  if (kind === "text") return "Text";
  if (kind === "image") return "图片";
  if (kind === "video") return "视频";
  return "文件";
}

function KindIcon({ kind }: { kind: DocKind }) {
  if (kind === "xlsx" || kind === "csv") {
    return <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />;
  }
  if (kind === "image") return <FileImage className="h-3.5 w-3.5 text-sky-600" />;
  if (kind === "video") return <Film className="h-3.5 w-3.5 text-violet-600" />;
  return <FileText className="h-3.5 w-3.5 text-[var(--accent)]" />;
}

function TableSheetView({ path, kind }: { path: string; kind: "xlsx" | "csv" }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const loader =
      kind === "csv" ? window.qsApi?.previewCsv?.(path) : window.qsApi?.previewXlsx?.(path);
    Promise.resolve(loader)
      .then((res) => {
        if (cancelled) return;
        if (!res || res.ok === false) {
          setError(res?.error || "读取失败");
          setHeaders([]);
          setRows([]);
          return;
        }
        setHeaders(res.headers || []);
        setRows(res.rows || []);
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
  }, [path, kind, tick]);

  if (loading) return <p className="p-8 text-sm text-[var(--text-muted)]">读取表格中…</p>;
  if (error) return <p className="p-8 text-sm text-[var(--danger)]">{error}</p>;
  if (!headers.length || !rows.length) {
    return <p className="p-8 text-sm text-[var(--text-muted)]">暂无行数据</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[#eef2f7] px-4 py-2">
        <span className="text-xs text-[var(--text-muted)]">
          {kind === "csv" ? "CSV" : "Excel"} · {rows.length} 行
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--text-primary)]"
          onClick={() => setTick((n) => n + 1)}
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-[#f1f5f9]">
              {headers.map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b border-r border-[#e2e8f0] bg-[#f1f5f9] px-2.5 py-2 text-xs font-semibold text-[var(--text-secondary)] first:border-l shadow-[0_1px_0_#e2e8f0]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  "group transition-colors duration-150",
                  i % 2 === 0 ? "bg-white" : "bg-[#f8fafc]",
                  "hover:bg-[var(--accent-soft)] hover:shadow-[inset_3px_0_0_0_var(--accent)]"
                )}
              >
                {headers.map((h) => {
                  const cell = r[h] || "";
                  const isLink = looksLikeHttpUrl(cell);
                  return (
                    <td
                      key={h}
                      className={cn(
                        "max-w-[240px] truncate border-b border-r border-[#e2e8f0] px-2.5 py-1.5 text-[var(--text-secondary)] first:border-l",
                        isLink && "cursor-pointer hover:bg-[#eef3f8]"
                      )}
                      title={cell || ""}
                    >
                      <TableCellValue value={cell} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TextDocView({ path, kind }: { path: string; kind: DocKind }) {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    window.qsApi
      ?.readTextFile?.(path)
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok) {
          setError(res?.error || "读取失败");
          setRaw("");
          return;
        }
        setRaw(res.content || "");
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
  }, [path, tick]);

  const html = useMemo(() => {
    if (kind !== "markdown") return "";
    try {
      return marked.parse(raw, { async: false }) as string;
    } catch {
      return "";
    }
  }, [kind, raw]);

  if (loading) return <p className="p-8 text-sm text-[var(--text-muted)]">读取文档中…</p>;
  if (error) return <p className="p-8 text-sm text-[var(--danger)]">{error}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end border-b border-[#eef2f7] px-4 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--text-primary)]"
          onClick={() => setTick((n) => n + 1)}
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-6 py-5">
        {kind === "markdown" ? (
          <div
            className="doc-md prose-doc max-w-none"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-[var(--text-primary)]">
            {raw || "（空文件）"}
          </pre>
        )}
      </div>
    </div>
  );
}

function ImageDocView({ path }: { path: string }) {
  const [src, setSrc] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSrc("");
    window.qsApi
      ?.readMediaDataUrl?.(path)
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok || !res.dataUrl) {
          setError(res?.error || "读取图片失败");
          return;
        }
        setSrc(res.dataUrl);
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
  }, [path, tick]);

  if (loading) return <p className="p-8 text-sm text-[var(--text-muted)]">加载图片中…</p>;
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-[var(--danger)]">{error}</p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          onClick={() => window.qsApi?.openPath?.(path)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          用系统程序打开
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[#eef2f7] px-4 py-2">
        <span className="text-xs text-[var(--text-muted)]">图片预览</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--text-primary)]"
          onClick={() => setTick((n) => n + 1)}
        >
          <RefreshCw className="h-3 w-3" />
          刷新
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#0b1220]/15] p-4">
        <img
          src={src}
          alt=""
          className="max-h-full max-w-full rounded-md object-contain shadow-lg"
        />
      </div>
    </div>
  );
}

function VideoDocView({ path }: { path: string }) {
  const [src, setSrc] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSrc("");
    window.qsApi
      ?.toFileUrl?.(path)
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok || !res.url) {
          setError(res?.error || "无法预览视频");
          return;
        }
        setSrc(res.url);
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
  }, [path]);

  if (loading) return <p className="p-8 text-sm text-[var(--text-muted)]">准备视频预览…</p>;
  if (error || !src) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-[var(--danger)]">{error || "无法预览"}</p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          onClick={() => window.qsApi?.openPath?.(path)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          用系统程序打开
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[#eef2f7] px-4 py-2">
        <span className="text-xs text-[var(--text-muted)]">视频预览</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[#f1f5f9]"
          onClick={() => window.qsApi?.openPath?.(path)}
        >
          <ExternalLink className="h-3 w-3" />
          系统打开
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0b1220] p-3">
        <video src={src} controls className="max-h-full max-w-full rounded-md" />
      </div>
    </div>
  );
}

function DocBody({ tab }: { tab: DocTab }) {
  if (tab.kind === "xlsx") return <TableSheetView path={tab.path} kind="xlsx" />;
  if (tab.kind === "csv") return <TableSheetView path={tab.path} kind="csv" />;
  if (tab.kind === "image") return <ImageDocView path={tab.path} />;
  if (tab.kind === "video") return <VideoDocView path={tab.path} />;
  if (tab.kind === "unknown") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-[var(--text-muted)]">暂不支持此文件类型的内嵌预览</p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          onClick={() => window.qsApi?.openPath?.(tab.path)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          用系统程序打开
        </button>
      </div>
    );
  }
  return <TextDocView path={tab.path} kind={tab.kind} />;
}

type DirFileItem = { name: string; path: string; mtime: number; size?: number };

function FolderBrowser({ dirPath }: { dirPath: string }) {
  const { openDoc, showStart, closePanel, split } = useDocPanel();
  const [files, setFiles] = useState<DirFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    window.qsApi
      ?.listDirFiles?.(dirPath)
      .then((res) => {
        if (cancelled) return;
        if (res?.ok === false) {
          setError(res.error || "读取目录失败");
          setFiles([]);
          return;
        }
        setFiles((res?.files as DirFileItem[]) || []);
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
  }, [dirPath, tick]);

  const [docExpanded, setDocExpanded] = useState(
    () => document.documentElement.dataset.qsDocExpanded === "1"
  );
  useEffect(() => {
    const sync = () =>
      setDocExpanded(document.documentElement.dataset.qsDocExpanded === "1");
    window.addEventListener("qs:doc-expanded-change", sync);
    return () => window.removeEventListener("qs:doc-expanded-change", sync);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[#eef2f7] px-3">
        <FolderOpen className="h-4 w-4 text-[var(--accent)]" />
        <span className="flex-1 text-sm font-semibold text-[var(--text-primary)]">浏览数据</span>
        <button
          type="button"
          title={docExpanded ? "还原窗口" : "放大窗口"}
          className={cn(
            "rounded-md p-1.5 hover:bg-[#f1f5f9]",
            docExpanded ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--text-muted)]"
          )}
          onClick={() => window.dispatchEvent(new Event("qs:doc-toggle-expand"))}
        >
          {docExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          title="分栏 (Ctrl+\\)"
          className={cn(
            "rounded-md p-1.5 hover:bg-[#f1f5f9]",
            split ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
          )}
          onClick={() => window.dispatchEvent(new Event("qs:doc-toggle-split"))}
        >
          <Columns2 className="h-4 w-4" />
        </button>
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
          title="返回开始"
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[#f1f5f9]"
          onClick={showStart}
        >
          开始
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
        <div
          className="break-all font-mono text-[11px] leading-relaxed text-[var(--text-muted)]"
          title={dirPath}
        >
          {dirPath}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading ? <p className="text-sm text-[var(--text-muted)]">加载中…</p> : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        {!loading && !error && !files.length ? (
          <p className="text-sm text-[var(--text-muted)]">该目录暂无文件</p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left",
                  "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out",
                  "hover:border-emerald-200/80 hover:bg-emerald-50/70 hover:shadow-sm",
                  "active:scale-[0.99] active:bg-emerald-50"
                )}
                onClick={() => openDoc(f.path, f.name)}
                title={f.path}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 transition-colors duration-150 group-hover:bg-emerald-100 group-hover:text-emerald-700">
                  <FileSpreadsheet className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--text-primary)] transition-colors group-hover:text-emerald-900">
                    {f.name}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[var(--text-muted)] group-hover:text-emerald-700/70">
                    {f.mtime ? new Date(f.mtime).toLocaleString() : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DocPaneFrame({
  tab,
  focused,
  label,
  onFocus,
}: {
  tab: DocTab | null;
  focused: boolean;
  label: string;
  onFocus: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col border-t",
        focused ? "border-[var(--accent)]/40 bg-white" : "border-transparent bg-[#fafbfc]"
      )}
      onMouseDown={onFocus}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[#eef2f7] px-3 py-1.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
            focused ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[#eef2f7] text-[var(--text-muted)]"
          )}
        >
          {label}
        </span>
        {tab ? (
          <>
            <span className="rounded bg-[#eef2f7] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {kindLabel(tab.kind)}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]"
              title={tab.path}
            >
              {tab.path}
            </span>
            <button
              type="button"
              title="打开所在目录"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--accent)]"
              onClick={() => window.qsApi?.openPath?.(tab.path)}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <span className="text-[11px] text-[var(--text-muted)]">点击上方标签或打开文档</span>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-white">
        {tab ? (
          <DocBody key={tab.id} tab={tab} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--text-muted)]">
            此栏暂无文档
          </div>
        )}
      </div>
    </div>
  );
}

export function DocSidePanel() {
  const {
    open,
    view,
    tabs,
    activeId,
    activeTab,
    secondaryId,
    secondaryTab,
    split,
    activePane,
    folderPath,
    focusTab,
    closeTab,
    closePanel,
    openFilePicker,
    showStart,
    toggleSplit,
    setActivePane,
  } = useDocPanel();

  const panelRef = useRef<HTMLElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(loadDocWidth);
  const [expanded, setExpanded] = useState(false);
  const widthBeforeExpand = useRef(DOC_WIDTH_DEFAULT);
  const expandedRef = useRef(expanded);
  const splitRef = useRef(split);
  expandedRef.current = expanded;
  splitRef.current = split;

  const persistWidth = useCallback((w: number) => {
    try {
      localStorage.setItem(DOC_WIDTH_KEY, String(w));
    } catch {
      /* ignore */
    }
  }, []);

  const applyExpand = useCallback(
    (next: boolean) => {
      if (next) {
        // 进入铺满：记住当前「非铺满」宽度，供还原；铺满本身不占用拖拽 60% 上限
        if (!expandedRef.current) {
          widthBeforeExpand.current = clampPanelWidth(panelWidth, panelRef.current);
        }
        setPanelWidth(measureFillWidth(panelRef.current));
        setExpanded(true);
        setDocExpandedAttr(true);
        return;
      }
      const restore = clampPanelWidth(
        widthBeforeExpand.current || DOC_WIDTH_DEFAULT,
        panelRef.current
      );
      setPanelWidth(restore);
      persistWidth(restore);
      setExpanded(false);
      setDocExpandedAttr(false);
    },
    [panelWidth, persistWidth]
  );

  /** 放大态：始终铺满工作区（随窗口/导航变化） */
  useEffect(() => {
    if (!open || !expanded) return;
    const sync = () => setPanelWidth(measureFillWidth(panelRef.current));
    sync();
    window.addEventListener("resize", sync);
    const sidebar = document.querySelector("[data-qs-sidebar]");
    const ro =
      sidebar && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(sync)
        : null;
    if (sidebar && ro) ro.observe(sidebar);
    const row = panelRef.current?.parentElement;
    if (row && ro) ro.observe(row);
    return () => {
      window.removeEventListener("resize", sync);
      ro?.disconnect();
    };
  }, [open, expanded]);

  /** 非放大态：窗口变化时把宽度钳在 60% 以内，避免小窗/全屏切换后挤爆主区 */
  useEffect(() => {
    if (!open || expanded) return;
    const sync = () => {
      setPanelWidth((w) => {
        const next = clampPanelWidth(w, panelRef.current);
        if (next !== w) persistWidth(next);
        return next;
      });
    };
    sync();
    window.addEventListener("resize", sync);
    const sidebar = document.querySelector("[data-qs-sidebar]");
    const ro =
      sidebar && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(sync)
        : null;
    if (sidebar && ro) ro.observe(sidebar);
    const row = panelRef.current?.parentElement;
    if (row && ro) ro.observe(row);
    return () => {
      window.removeEventListener("resize", sync);
      ro?.disconnect();
    };
  }, [open, expanded, persistWidth]);

  useEffect(() => {
    if (!open && expanded) {
      setExpanded(false);
      setDocExpandedAttr(false);
    }
  }, [open, expanded]);

  const toggleExpand = useCallback(() => {
    applyExpand(!expandedRef.current);
  }, [applyExpand]);

  const onToggleSplit = useCallback(() => {
    const turningOn = !splitRef.current;
    toggleSplit();
    // 分栏需要更宽可视区：不够则走「放大铺满」，不走拖拽 60% 上限
    if (turningOn && panelWidth < DOC_WIDTH_SPLIT_MIN) {
      applyExpand(true);
    }
  }, [toggleSplit, panelWidth, applyExpand]);

  /** 空白处 / Esc：放大先还原 → 分栏先退出 → 再收起 */
  const softDismiss = useCallback(() => {
    if (expandedRef.current) {
      applyExpand(false);
      return;
    }
    if (splitRef.current) {
      toggleSplit();
      return;
    }
    closePanel();
  }, [applyExpand, toggleSplit, closePanel]);

  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      // 从铺满拖动：先退出放大，并以 60% 上限为起点，避免与铺满态打架
      const dragMax = measureDragMaxWidth(panelRef.current);
      const dragMin = Math.min(DOC_WIDTH_MIN, dragMax);
      let startW = panelWidth;
      if (expanded) {
        startW = dragMax;
        setExpanded(false);
        setDocExpandedAttr(false);
        setPanelWidth(startW);
      } else {
        startW = clampPanelWidth(panelWidth, panelRef.current);
      }
      const onMove = (ev: MouseEvent) => {
        const next = Math.min(dragMax, Math.max(dragMin, startW + (startX - ev.clientX)));
        setPanelWidth(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.setTimeout(() => {
          setPanelWidth((w) => {
            const capped = clampPanelWidth(w, panelRef.current);
            persistWidth(capped);
            return capped;
          });
        }, 0);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panelWidth, persistWidth, expanded]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        softDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, softDismiss]);

  useEffect(() => {
    const onExpandEvt = () => toggleExpand();
    const onForceCollapse = () => {
      if (expandedRef.current) applyExpand(false);
      else setDocExpandedAttr(false);
    };
    const onSplitEvt = () => onToggleSplit();
    window.addEventListener("qs:doc-toggle-expand", onExpandEvt);
    window.addEventListener("qs:doc-force-collapse", onForceCollapse);
    window.addEventListener("qs:doc-toggle-split", onSplitEvt);
    return () => {
      window.removeEventListener("qs:doc-toggle-expand", onExpandEvt);
      window.removeEventListener("qs:doc-force-collapse", onForceCollapse);
      window.removeEventListener("qs:doc-toggle-split", onSplitEvt);
    };
  }, [toggleExpand, onToggleSplit, applyExpand]);

  /** 仅点击侧栏外的「空白处」才收起；点到按钮/链接等可交互元素不收起 */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = panelRef.current;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (root?.contains(target)) return;
      if (!(target instanceof Element)) return;
      // 打开/切换侧栏的触发控件
      if (target.closest("[data-qs-doc-toggle]")) return;
      // 可交互控件：交给原逻辑，不收起侧栏
      if (
        target.closest(
          [
            "button",
            "a",
            "input",
            "select",
            "textarea",
            "label",
            "summary",
            "option",
            "[role='button']",
            "[role='link']",
            "[role='menuitem']",
            "[role='tab']",
            "[role='switch']",
            "[role='checkbox']",
            "[role='radio']",
            "[role='option']",
            "[contenteditable='true']",
            "[data-qs-no-doc-close]",
          ].join(",")
        )
      ) {
        return;
      }
      softDismiss();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, softDismiss]);

  return (
    <aside
      ref={panelRef}
      data-qs-doc-panel
      className={cn(
        "relative flex h-full flex-col overflow-hidden border-l border-[#e2e8f0] bg-white",
        "shadow-[-8px_0_24px_rgba(15,23,42,0.06)]",
        open ? "opacity-100" : "w-0 border-l-0 opacity-0",
        open && expanded ? "min-w-0 flex-1" : "shrink-0"
      )}
      style={open && !expanded ? { width: panelWidth } : undefined}
      aria-hidden={!open}
    >
      {open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧面板宽度"
          title="拖动调整宽度（最多占工作区 60%；放大铺满不受此限）"
          onMouseDown={onResizeStart}
          className="group absolute -left-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
        >
          <span className="my-auto h-12 w-1 rounded-full bg-transparent transition-colors group-hover:bg-[var(--accent)]/45 group-active:bg-[var(--accent)]/70" />
        </div>
      ) : null}

      {open && view === "start" ? <StartHub /> : null}

      {open && view === "folder" && folderPath ? <FolderBrowser dirPath={folderPath} /> : null}

      {open && view === "docs" ? (
        <>
          <div className="flex h-10 shrink-0 items-stretch border-b border-[#eef2f7] bg-[#f8fafc]">
            <button
              type="button"
              title="返回开始"
              className="flex w-9 shrink-0 items-center justify-center border-r border-[#eef2f7] text-[var(--text-muted)] hover:bg-white hover:text-[var(--accent)]"
              onClick={showStart}
            >
              <span className="text-xs font-bold">开</span>
            </button>
            <div className="scroll-thin flex min-w-0 flex-1 items-stretch overflow-x-auto">
              {tabs.map((t) => {
                const inPrimary = t.id === activeId;
                const inSecondary = split && t.id === secondaryId;
                const highlighted =
                  (activePane === "primary" && inPrimary) ||
                  (activePane === "secondary" && inSecondary) ||
                  (!split && inPrimary);
                return (
                  <div
                    key={t.id}
                    className={cn(
                      "group relative flex max-w-[200px] items-center gap-1.5 border-r border-[#eef2f7] px-3",
                      highlighted
                        ? "bg-white text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:bg-white/70"
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left"
                      onClick={() => focusTab(t.id)}
                      title={
                        split
                          ? `${t.path}\n将加载到${activePane === "primary" ? "左" : "右"}栏`
                          : t.path
                      }
                    >
                      <KindIcon kind={t.kind} />
                      <span className="truncate text-[12.5px] font-medium">{t.title}</span>
                      {split && (inPrimary || inSecondary) ? (
                        <span className="shrink-0 rounded bg-[#eef2f7] px-1 text-[9px] font-semibold text-[var(--text-muted)]">
                          {inPrimary && inSecondary ? "双" : inPrimary ? "左" : "右"}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 opacity-0 hover:bg-[#e2e8f0] group-hover:opacity-100"
                      onClick={() => closeTab(t.id)}
                      aria-label="关闭标签"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {highlighted ? (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--accent)]" />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              title="打开外部文档"
              className="flex w-9 shrink-0 items-center justify-center text-[var(--text-muted)] hover:bg-white hover:text-[var(--accent)]"
              onClick={() => void openFilePicker()}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-qs-doc-toggle
              title={expanded ? "还原窗口" : "放大窗口"}
              className={cn(
                "flex w-9 shrink-0 items-center justify-center hover:bg-white",
                expanded
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--accent)]"
              )}
              onClick={toggleExpand}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              data-qs-doc-toggle
              title="分栏 (Ctrl+\\)"
              className={cn(
                "flex w-9 shrink-0 items-center justify-center hover:bg-white",
                split ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--accent)]"
              )}
              onClick={onToggleSplit}
            >
              <Columns2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="收起侧栏"
              className="flex w-9 shrink-0 items-center justify-center text-[var(--text-muted)] hover:bg-white hover:text-[var(--text-primary)]"
              onClick={closePanel}
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>

          {split ? (
            <div className="flex min-h-0 flex-1">
              <DocPaneFrame
                tab={activeTab}
                focused={activePane === "primary"}
                label="左栏"
                onFocus={() => setActivePane("primary")}
              />
              <div className="w-px shrink-0 bg-[#e2e8f0]" />
              <DocPaneFrame
                tab={secondaryTab}
                focused={activePane === "secondary"}
                label="右栏"
                onFocus={() => setActivePane("secondary")}
              />
            </div>
          ) : (
            <>
              {activeTab ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-[#eef2f7] px-3 py-1.5">
                  <span className="rounded bg-[#eef2f7] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {kindLabel(activeTab.kind)}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]"
                    title={activeTab.path}
                  >
                    {activeTab.path}
                  </span>
                  <button
                    type="button"
                    title="打开所在目录"
                    className="rounded p-1 text-[var(--text-muted)] hover:bg-[#f1f5f9] hover:text-[var(--accent)]"
                    onClick={() => window.qsApi?.openPath?.(activeTab.path)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}

              <div className="min-h-0 flex-1 bg-white">
                {activeTab ? (
                  <DocBody key={activeTab.id} tab={activeTab} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
                    <p className="text-sm text-[var(--text-muted)]">打开外部文档以在此预览</p>
                    <button
                      type="button"
                      className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
                      onClick={() => void openFilePicker()}
                    >
                      选择文件
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      ) : null}
    </aside>
  );
}
