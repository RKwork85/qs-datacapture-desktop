import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, FolderSearch, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, SectionCard } from "@/components/ui/field";
import { emitToast } from "@/components/ui/toast";
import { brandIcons } from "@/assets/brands";
import { useDocPanel } from "@/context/DocPanelContext";
import { formatElapsed } from "@/lib/taskLabels";
import { cn } from "@/lib/utils";

type PlatformTab = "dy" | "xhs" | "weibo";
type TaskKind = "links" | "search";

type LinkForm = {
  urls: string[];
  limit: number;
};

type SearchForm = {
  keywords: string[];
  limit: number;
};

type FormErrors = {
  urls?: string[];
  keywords?: string;
  limit?: string;
  form?: string;
};

type QueuedTask = {
  id: string;
  type: string;
  status: string;
  createdAt?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

const PLATFORM_TABS: { id: PlatformTab; label: string; hint: string; icon: string }[] = [
  {
    id: "dy",
    label: "抖音",
    hint: "先提交到队列，再点「执行任务」批量跑",
    icon: brandIcons.dy,
  },
  {
    id: "xhs",
    label: "小红书",
    hint: "先提交到队列，再点「执行任务」批量跑",
    icon: brandIcons.xhs,
  },
  {
    id: "weibo",
    label: "微博",
    hint: "先提交到队列，再点「执行任务」批量跑",
    icon: brandIcons.weibo,
  },
];

const KIND_TABS: { id: TaskKind; label: string }[] = [
  { id: "links", label: "链接爬取" },
  { id: "search", label: "搜索词爬取" },
];

const URL_RE = /^https?:\/\/.+/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 150;

function emptyLinkForm(): LinkForm {
  return { urls: [""], limit: DEFAULT_LIMIT };
}

function emptySearchForm(): SearchForm {
  return { keywords: [], limit: DEFAULT_LIMIT };
}

function isValidUrl(value: string) {
  const v = value.trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return URL_RE.test(u.href);
  } catch {
    return false;
  }
}

function clampLimit(n: number) {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  error,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const merged = [...value];
    for (const p of parts) {
      if (!merged.includes(p)) merged.push(p);
    }
    onChange(merged);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-[var(--radius-sm)] border bg-[var(--bg-elevated)] px-2 py-1.5 transition-colors",
          error
            ? "border-[var(--danger)] ring-2 ring-rose-100"
            : "border-[var(--border)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-soft)]"
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]"
          >
            <span className="truncate">{tag}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`删除 ${tag}`}
              className="rounded p-0.5 hover:bg-white/70 disabled:opacity-50"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          placeholder={value.length ? "继续输入后回车" : placeholder}
          className="min-w-[140px] flex-1 bg-transparent px-1 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
        />
      </div>
      {error ? <span className="text-xs text-[var(--danger)]">{error}</span> : null}
    </div>
  );
}

function PlatformPicker({
  value,
  onChange,
  disabled,
}: {
  value: PlatformTab;
  onChange: (next: PlatformTab) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium text-[var(--text-secondary)]">选择平台:</span>
      <div
        role="tablist"
        aria-label="选择平台"
        className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[#eef1f6] p-1"
      >
        {PLATFORM_TABS.map((t) => {
          const active = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => onChange(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors disabled:opacity-50",
                active
                  ? "bg-white font-semibold text-[var(--accent)] shadow-sm"
                  : "font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <img
                src={t.icon}
                alt=""
                draggable={false}
                className="h-4 w-4 rounded-[3px] object-cover"
              />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KindTabs({
  value,
  onChange,
  disabled,
}: {
  value: TaskKind;
  onChange: (next: TaskKind) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="任务类型"
      className="mb-4 inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-white p-1"
    >
      {KIND_TABS.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-[var(--radius-sm)] px-4 py-1.5 text-sm transition-colors disabled:opacity-50",
              active
                ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function LimitField({
  value,
  onChange,
  disabled,
  error,
  hint,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  error?: string;
  hint?: string;
}) {
  return (
    <Field
      label="条数上限"
      hint={error ? undefined : hint || `单次最多 ${MAX_LIMIT} 条`}
      className="w-full max-w-[200px]"
    >
      <Input
        type="number"
        min={1}
        max={MAX_LIMIT}
        value={value}
        disabled={disabled}
        className={cn(error && "border-[var(--danger)]")}
        onChange={(e) => onChange(clampLimit(Number(e.target.value)))}
      />
      {error ? <span className="text-xs text-[var(--danger)]">{error}</span> : null}
    </Field>
  );
}

function LinkTaskForm({
  platform,
  value,
  onChange,
  errors,
  disabled,
}: {
  platform: PlatformTab;
  value: LinkForm;
  onChange: (next: LinkForm) => void;
  errors: FormErrors;
  disabled?: boolean;
}) {
  const linkLabel =
    platform === "xhs" ? "笔记/主页链接" : platform === "dy" ? "视频/主页链接" : "话题/博文链接";
  const linkHint =
    platform === "xhs"
      ? "支持小红书主页或笔记 URL，可添加多条"
      : platform === "dy"
        ? "支持抖音主页或视频 URL，可添加多条"
        : "支持微博话题或博文 URL，可添加多条";
  const linkPlaceholder =
    platform === "xhs"
      ? "https://www.xiaohongshu.com/user/profile/..."
      : platform === "dy"
        ? "https://www.douyin.com/user/..."
        : "https://weibo.com/...";
  const sectionTitle =
    platform === "weibo" ? "链接爬取" : `单条${platform === "xhs" ? "笔记" : "视频"}/主页链接爬取`;

  return (
    <SectionCard step="01" title={sectionTitle} hint={linkHint}>
      <div className="flex flex-col gap-2.5">
        {value.urls.map((url, index) => {
          const isLast = index === value.urls.length - 1;
          return (
            <Field
              key={index}
              label={index === 0 ? linkLabel : undefined}
              className="min-w-0 w-full"
              hint={
                errors.urls?.[index]
                  ? undefined
                  : isLast
                    ? "填写完整 http(s) 链接；主页采集受条数上限约束"
                    : undefined
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  value={url}
                  disabled={disabled}
                  placeholder={linkPlaceholder}
                  className={cn(
                    "min-w-0 flex-1",
                    errors.urls?.[index] && "border-[var(--danger)]"
                  )}
                  onChange={(e) => {
                    const urls = [...value.urls];
                    urls[index] = e.target.value;
                    onChange({ ...value, urls });
                  }}
                />
                {isLast ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={disabled}
                    onClick={() => onChange({ ...value, urls: [...value.urls, ""] })}
                  >
                    <Plus className="h-4 w-4" />
                    添加
                  </Button>
                ) : null}
                {value.urls.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={disabled}
                    aria-label="删除该行"
                    onClick={() =>
                      onChange({
                        ...value,
                        urls: value.urls.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              {errors.urls?.[index] ? (
                <span className="text-xs text-[var(--danger)]">{errors.urls[index]}</span>
              ) : null}
            </Field>
          );
        })}
        <div className="flex flex-wrap items-end gap-3">
          <LimitField
            value={value.limit}
            disabled={disabled}
            error={errors.limit}
            hint="主页/列表采集条数上限"
            onChange={(limit) => onChange({ ...value, limit })}
          />
        </div>
      </div>
      {errors.form ? <p className="text-sm text-[var(--danger)]">{errors.form}</p> : null}
    </SectionCard>
  );
}

function SearchTaskForm({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: SearchForm;
  onChange: (next: SearchForm) => void;
  errors: FormErrors;
  disabled?: boolean;
}) {
  return (
    <SectionCard
      step="01"
      title="搜索词数据爬取"
      hint="输入搜索词后回车生成标签，支持逗号批量添加"
    >
      <Field label="搜索词">
        <TagInput
          value={value.keywords}
          disabled={disabled}
          error={errors.keywords}
          placeholder="输入搜索词后回车"
          onChange={(keywords) => onChange({ ...value, keywords })}
        />
      </Field>
      <LimitField
        value={value.limit}
        disabled={disabled}
        error={errors.limit}
        hint="每个搜索词拉取的数据条数上限"
        onChange={(limit) => onChange({ ...value, limit })}
      />
      {errors.form ? <p className="text-sm text-[var(--danger)]">{errors.form}</p> : null}
    </SectionCard>
  );
}

function validateLinkForm(form: LinkForm): FormErrors {
  const filledUrls = form.urls.map((u) => u.trim());
  const urlErrors = filledUrls.map((v) => {
    if (!v) return "";
    if (!isValidUrl(v)) return "请输入有效的 URL（需以 http:// 或 https:// 开头）";
    return "";
  });
  const hasUrlError = urlErrors.some(Boolean);
  const hasUrl = filledUrls.some(Boolean);
  if (!hasUrl) {
    return {
      urls: hasUrlError ? urlErrors : undefined,
      form: "请至少填写一条链接",
    };
  }
  if (form.limit < 1 || form.limit > MAX_LIMIT) {
    return { urls: hasUrlError ? urlErrors : undefined, limit: `条数需在 1–${MAX_LIMIT}` };
  }
  return { urls: hasUrlError ? urlErrors : undefined };
}

function validateSearchForm(form: SearchForm): FormErrors {
  if (!form.keywords.length) {
    return { form: "请至少添加一个搜索词" };
  }
  if (form.limit < 1 || form.limit > MAX_LIMIT) {
    return { limit: `条数需在 1–${MAX_LIMIT}` };
  }
  return {};
}

function statusTone(status: string) {
  if (status === "done") return "text-[var(--success)]";
  if (status === "failed") return "text-[var(--danger)]";
  if (status === "running") return "text-[var(--accent)]";
  return "text-[var(--text-secondary)]";
}

function fmtTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function taskKindLabel(type: string, params?: Record<string, unknown>) {
  if (type.endsWith(".crawl_search") || (Array.isArray(params?.keywords) && params!.keywords.length)) {
    return "搜索词";
  }
  if (type.endsWith(".crawl_batch") || type.endsWith(".crawl_links")) return "链接";
  return type;
}

function parentDir(filePath: string) {
  const norm = String(filePath || "").replace(/[/\\]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return idx > 0 ? norm.slice(0, idx) : norm;
}

/** 从嵌套 result 中提取可打开的产物路径 */
function extractTaskArtifacts(task: QueuedTask): { file: string; dir: string } {
  let file = "";
  let dir = "";
  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    for (const key of ["xlsxPath", "csvPath", "outRoot"] as const) {
      const v = String(o[key] || "").trim();
      if (!v) continue;
      if (key === "outRoot") {
        if (!dir) dir = v;
      } else if (!file) {
        file = v;
      }
    }
    for (const v of Object.values(o)) visit(v, depth + 1);
  };
  visit(task.result);
  if (!dir && file) dir = parentDir(file);
  return { file, dir };
}

export function TaskSubmitPage() {
  const { browseFolder, openDoc } = useDocPanel();
  const [platform, setPlatform] = useState<PlatformTab>("dy");
  const [kind, setKind] = useState<TaskKind>("links");
  const [linkForms, setLinkForms] = useState<Record<PlatformTab, LinkForm>>({
    dy: emptyLinkForm(),
    xhs: emptyLinkForm(),
    weibo: emptyLinkForm(),
  });
  const [searchForms, setSearchForms] = useState<Record<PlatformTab, SearchForm>>({
    dy: emptySearchForm(),
    xhs: emptySearchForm(),
    weibo: emptySearchForm(),
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState("");
  const [sessionUser, setSessionUser] = useState("");
  const [controlReady, setControlReady] = useState(false);
  const [controlError, setControlError] = useState("");
  const [recent, setRecent] = useState<QueuedTask[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const activeHint = useMemo(
    () => PLATFORM_TABS.find((t) => t.id === platform)?.hint || "",
    [platform]
  );

  const pendingCount = useMemo(
    () => recent.filter((t) => t.status === "pending").length,
    [recent]
  );

  const refreshRecent = useCallback(async () => {
    if (!window.qsApi?.controlListTasks) return;
    setLoadingRecent(true);
    try {
      const res = (await window.qsApi.controlListTasks()) as {
        ok?: boolean;
        tasks?: QueuedTask[];
        error?: string;
      };
      if (res?.ok && Array.isArray(res.tasks)) {
        setRecent(res.tasks.slice(0, 20));
      } else if (res?.error) {
        setControlError(res.error);
      }
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  const ensureSession = useCallback(async () => {
    if (!window.qsApi?.controlEnsureSession) {
      const err = "当前环境无控制服接口（请在 Electron 中运行）";
      setControlReady(false);
      setControlError(err);
      setSessionUser("");
      return { ok: false as const, error: err };
    }
    const res = (await window.qsApi.controlEnsureSession()) as {
      ok?: boolean;
      username?: string;
      error?: string;
    };
    if (res?.ok) {
      setSessionUser(res.username || "agent");
      setControlReady(true);
      setControlError("");
      return { ok: true as const };
    }
    setSessionUser("");
    setControlReady(false);
    const err = res?.error || "控制服会话失败";
    setControlError(err);
    return { ok: false as const, error: err };
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await ensureSession();
      if (s.ok) await refreshRecent();
    })();
  }, [ensureSession, refreshRecent]);

  function clearMessages() {
    setToast("");
    setToastError("");
    setErrors({});
  }

  function resetActive() {
    if (kind === "links") {
      setLinkForms((prev) => ({ ...prev, [platform]: emptyLinkForm() }));
    } else {
      setSearchForms((prev) => ({ ...prev, [platform]: emptySearchForm() }));
    }
    clearMessages();
  }

  async function submitActive() {
    clearMessages();
    if (kind === "links") {
      const form = linkForms[platform];
      const nextErrors = validateLinkForm(form);
      setErrors(nextErrors);
      if (nextErrors.urls || nextErrors.limit || nextErrors.form) return;
    } else {
      const form = searchForms[platform];
      const nextErrors = validateSearchForm(form);
      setErrors(nextErrors);
      if (nextErrors.keywords || nextErrors.limit || nextErrors.form) return;
    }

    setSubmitting(true);
    try {
      const session = await ensureSession();
      if (!session.ok) {
        setToastError(session.error);
        return;
      }
      if (!window.qsApi?.controlCreateTask) {
        setToastError("当前环境无 controlCreateTask");
        return;
      }

      let type = "";
      let params: Record<string, unknown> = { platform };
      if (kind === "links") {
        const form = linkForms[platform];
        const urls = form.urls.map((u) => u.trim()).filter(Boolean);
        type = `${platform}.crawl_batch`;
        params = {
          platform,
          kind: "links",
          urls,
          maxNotes: clampLimit(form.limit),
          limit: clampLimit(form.limit),
        };
      } else {
        const form = searchForms[platform];
        type = `${platform}.crawl_search`;
        params = {
          platform,
          kind: "search",
          keywords: form.keywords.map((k) => k.trim()).filter(Boolean),
          maxNotes: clampLimit(form.limit),
          limit: clampLimit(form.limit),
        };
      }

      const res = (await window.qsApi.controlCreateTask({
        type,
        params,
        priority: 0,
      })) as { ok?: boolean; task?: QueuedTask; error?: string };

      if (!res?.ok || !res.task) {
        setToastError(res?.error || "提交失败");
        return;
      }

      if (kind === "links") {
        setLinkForms((prev) => ({ ...prev, [platform]: emptyLinkForm() }));
      } else {
        setSearchForms((prev) => ({ ...prev, [platform]: emptySearchForm() }));
      }
      setToast(
        `已加入队列 ${res.task.id.slice(0, 8)}…（未执行）。可继续补充提交，或点「执行任务」。`
      );
      await refreshRecent();
    } catch (e) {
      setToastError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function runQueue() {
    clearMessages();
    setRunning(true);
    const startedAt = Date.now();
    try {
      const session = await ensureSession();
      if (!session.ok) {
        setToastError(session.error);
        return;
      }
      if (!window.qsApi?.controlRunPending) {
        // 兼容旧 preload：退化为单次 poll
        await window.qsApi?.controlPoll?.();
        const elapsed = Date.now() - startedAt;
        setToast(`已触发执行（单次领取） · 耗时 ${formatElapsed(elapsed)}`);
        emitToast(
          "调度中心",
          "执行任务",
          `已触发执行（单次领取） · 耗时 ${formatElapsed(elapsed)}`,
          "success"
        );
        await refreshRecent();
        return;
      }
      const res = (await window.qsApi.controlRunPending()) as {
        ok?: boolean;
        ran?: number;
        error?: string;
      };
      const elapsed = Date.now() - startedAt;
      if (!res?.ok) {
        const msg = res?.error || "执行失败";
        setToastError(`${msg} · 耗时 ${formatElapsed(elapsed)}`);
        emitToast(
          "调度中心",
          "执行任务",
          `${msg} · 耗时 ${formatElapsed(elapsed)}`,
          "error"
        );
        return;
      }
      const n = Number(res.ran || 0);
      const msg =
        n > 0
          ? `已执行 ${n} 个排队任务 · 耗时 ${formatElapsed(elapsed)}`
          : `队列中没有待执行任务 · 耗时 ${formatElapsed(elapsed)}`;
      setToast(msg);
      emitToast("调度中心", "执行任务", msg, n > 0 ? "success" : "info");
      await refreshRecent();
    } catch (e) {
      const elapsed = Date.now() - startedAt;
      const msg = e instanceof Error ? e.message : String(e);
      setToastError(`${msg} · 耗时 ${formatElapsed(elapsed)}`);
      emitToast(
        "调度中心",
        "执行任务",
        `${msg} · 耗时 ${formatElapsed(elapsed)}`,
        "error"
      );
    } finally {
      setRunning(false);
    }
  }

  const busy = submitting || running;

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          任务提交
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{activeHint}</p>
        {controlReady && sessionUser ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            控制服：已就绪（{sessionUser}）
            {pendingCount ? ` · 待执行 ${pendingCount}` : ""}
          </p>
        ) : controlError ? (
          <p className="mt-1 text-xs text-red-600">控制服：未连接 — {controlError}</p>
        ) : (
          <p className="mt-1 text-xs text-[var(--text-muted)]">控制服：正在连接…</p>
        )}
      </header>

      <div className="mb-5">
        <PlatformPicker
          value={platform}
          disabled={busy}
          onChange={(id) => {
            setPlatform(id);
            clearMessages();
          }}
        />
      </div>

      <KindTabs
        value={kind}
        disabled={busy}
        onChange={(k) => {
          setKind(k);
          clearMessages();
        }}
      />

      {kind === "links" ? (
        <LinkTaskForm
          platform={platform}
          value={linkForms[platform]}
          onChange={(next) => {
            setLinkForms((prev) => ({ ...prev, [platform]: next }));
            clearMessages();
          }}
          errors={errors}
          disabled={busy}
        />
      ) : (
        <SearchTaskForm
          value={searchForms[platform]}
          onChange={(next) => {
            setSearchForms((prev) => ({ ...prev, [platform]: next }));
            clearMessages();
          }}
          errors={errors}
          disabled={busy}
        />
      )}

      {toast ? <p className="mt-4 text-sm font-medium text-[var(--success)]">{toast}</p> : null}
      {toastError ? (
        <p className="mt-4 text-sm font-medium text-[var(--danger)]">{toastError}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="h-9 w-fit px-6"
          loading={submitting}
          disabled={busy || !controlReady}
          onClick={() => void submitActive()}
        >
          提交任务
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-9 w-fit px-6"
          loading={running}
          disabled={busy || !controlReady}
          onClick={() => void runQueue()}
        >
          执行任务{pendingCount ? `（${pendingCount}）` : ""}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-6"
          disabled={busy}
          onClick={resetActive}
        >
          重置
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy || loadingRecent}
          onClick={() => void refreshRecent()}
        >
          刷新队列
        </Button>
      </div>

      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">任务队列</h2>
          <span className="text-xs text-[var(--text-muted)]">
            {loadingRecent ? "加载中…" : `显示 ${recent.length} 条 · 待执行 ${pendingCount}`}
          </span>
        </div>
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]">
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--text-muted)]">
              暂无任务。填写后点「提交任务」加入队列，再点「执行任务」。
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {recent.map((t) => {
                const { file, dir } = extractTaskArtifacts(t);
                const canBrowse = Boolean(file || dir);
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm"
                  >
                    <span className="font-mono text-xs text-[var(--text-muted)]">
                      {t.id.slice(0, 8)}
                    </span>
                    <span className="rounded bg-[#eef1f6] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                      {taskKindLabel(t.type, t.params)}
                    </span>
                    <span className="font-medium text-[var(--text-primary)]">{t.type}</span>
                    <span className={cn("text-xs font-semibold", statusTone(t.status))}>
                      {t.status}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">{fmtTime(t.createdAt)}</span>
                    {Array.isArray(t.params?.urls) && (t.params!.urls as string[]).length ? (
                      <span className="text-xs text-[var(--text-muted)]">
                        urls {(t.params!.urls as string[]).length}
                      </span>
                    ) : null}
                    {Array.isArray(t.params?.keywords) &&
                    (t.params!.keywords as string[]).length ? (
                      <span className="text-xs text-[var(--text-muted)]">
                        kw {(t.params!.keywords as string[]).length}
                      </span>
                    ) : null}
                    {t.params?.limit != null || t.params?.maxNotes != null ? (
                      <span className="text-xs text-[var(--text-muted)]">
                        条数 {String(t.params?.maxNotes ?? t.params?.limit)}
                      </span>
                    ) : null}

                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 gap-1 px-2.5 text-xs"
                        disabled={!canBrowse}
                        title={
                          canBrowse
                            ? "在右侧栏浏览产物目录/文件"
                            : "暂无产物路径（任务未完成或无输出）"
                        }
                        onClick={() => {
                          if (file) openDoc(file);
                          else if (dir) browseFolder(dir);
                        }}
                      >
                        <FolderSearch className="h-3.5 w-3.5" />
                        浏览文件
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2.5 text-xs"
                        disabled={!canBrowse}
                        title={
                          canBrowse ? "用资源管理器打开本地目录" : "暂无本地路径"
                        }
                        onClick={() => {
                          const target = dir || file;
                          if (target) void window.qsApi?.openPath?.(target);
                        }}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        本地文件
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
