import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, FolderSearch, Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, SectionCard } from "@/components/ui/field";
import { brandIcons } from "@/assets/brands";
import { useDocPanel } from "@/context/DocPanelContext";
import { cn } from "@/lib/utils";

export type FrequencyKey = "2min" | "10min" | "1hour" | "at" | "hourly";
export type WeiboStep = "hot" | "detail" | "comments";
export type PlatformKey = "dy" | "xhs" | "weibo";

export type ScheduleRow = {
  id: string;
  name: string;
  platform: string;
  step: string;
  frequency: FrequencyKey;
  atTime: string;
  params?: Record<string, unknown>;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  lastStatus?: string;
  lastError?: string;
  runCount?: number;
};

type DraftForm = {
  name: string;
  frequency: FrequencyKey;
  atTime: string;
  realtimeLimit: string;
  maxTopics: string;
};

const PAGE_SIZE = 8;

const PLATFORM_TABS: {
  id: PlatformKey;
  label: string;
  icon: string;
  ready: boolean;
  hint: string;
}[] = [
  {
    id: "dy",
    label: "抖音",
    icon: brandIcons.dy,
    ready: false,
    hint: "分平台配置定时采集；到期自动入队执行",
  },
  {
    id: "xhs",
    label: "小红书",
    icon: brandIcons.xhs,
    ready: false,
    hint: "分平台配置定时采集；到期自动入队执行",
  },
  {
    id: "weibo",
    label: "微博",
    icon: brandIcons.weibo,
    ready: true,
    hint: "按功能标签提交定时任务；后序标签会先执行前置步骤",
  },
];

const FREQUENCY_OPTIONS: { value: FrequencyKey; label: string; hint: string }[] = [
  { value: "2min", label: "2 分钟", hint: "每隔 2 分钟执行一次" },
  { value: "10min", label: "10 分钟", hint: "每隔 10 分钟执行一次" },
  { value: "1hour", label: "1 小时", hint: "每隔 1 小时执行一次" },
  { value: "at", label: "定时爬取", hint: "在指定时刻执行，之后按每天同一时刻续期" },
  { value: "hourly", label: "整点", hint: "每个整点执行" },
];

const FREQUENCY_LABEL: Record<FrequencyKey, string> = {
  "2min": "2 分钟",
  "10min": "10 分钟",
  "1hour": "1 小时",
  at: "定时爬取",
  hourly: "整点",
};

const WEIBO_TABS: {
  step: WeiboStep;
  label: string;
  chain: string[];
  desc: string;
  stepNo: string;
}[] = [
  {
    step: "hot",
    label: "热搜榜",
    chain: ["热搜榜"],
    desc: "仅执行热搜榜采集",
    stepNo: "01",
  },
  {
    step: "detail",
    label: "榜单详情",
    chain: ["热搜榜", "榜单详情"],
    desc: "按顺序先热搜，再抓榜单详情",
    stepNo: "02",
  },
  {
    step: "comments",
    label: "榜单评论区",
    chain: ["热搜榜", "榜单详情", "榜单评论区"],
    desc: "按顺序执行热搜 → 详情 → 评论区",
    stepNo: "03",
  },
];

const STEP_LABEL: Record<string, string> = {
  hot: "热搜榜",
  detail: "榜单详情",
  comments: "榜单评论区",
};

function emptyDraft(step: WeiboStep): DraftForm {
  return {
    name: `定时_${step}`,
    frequency: "10min",
    atTime: "",
    realtimeLimit: "50",
    maxTopics: "0",
  };
}

function fmtTime(ms?: number) {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function recentRunLabel(row: ScheduleRow) {
  const st = String(row.lastStatus || "").toLowerCase();
  if (st === "queued" || st === "running") {
    return { text: "最近 执行中", tone: "muted" as const };
  }
  if (st === "done") {
    return {
      text: `最近 ${fmtTime(row.lastRunAt)} · 成功`,
      tone: "success" as const,
    };
  }
  if (st === "failed") {
    return {
      text: `最近 ${fmtTime(row.lastRunAt)} · 失败`,
      tone: "danger" as const,
    };
  }
  if (row.lastRunAt) {
    return { text: `最近 ${fmtTime(row.lastRunAt)}`, tone: "muted" as const };
  }
  return { text: "最近 —", tone: "muted" as const };
}

function defaultAtTimeValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function PlatformPicker({
  value,
  onChange,
}: {
  value: PlatformKey;
  onChange: (next: PlatformKey) => void;
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
              onClick={() => onChange(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors",
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

function StepTabs({
  value,
  onChange,
}: {
  value: WeiboStep;
  onChange: (next: WeiboStep) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="功能标签"
      className="mb-4 inline-flex flex-wrap items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-white p-1"
    >
      {WEIBO_TABS.map((t) => {
        const active = value === t.step;
        return (
          <button
            key={t.step}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.step)}
            className={cn(
              "rounded-[var(--radius-sm)] px-4 py-1.5 text-sm transition-colors",
              active
                ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            <span
              className={cn(
                "mr-1.5 text-xs tabular-nums",
                active ? "text-[var(--accent)]/80" : "text-[var(--text-muted)]"
              )}
            >
              {t.stepNo}
            </span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

async function resolvePlatformDataDir(platform: PlatformKey) {
  const roots = (await window.qsApi?.getDataRoots?.().catch(() => null)) as
    | { root?: string; xhs?: string; weibo?: string; dy?: string }
    | null;
  if (!roots) return "";
  if (platform === "dy") return String(roots.dy || "");
  if (platform === "xhs") return String(roots.xhs || "");
  return String(roots.weibo || "");
}

export function PlatformSchedulePage({
  initialPlatform = "weibo",
  title = "定时任务",
}: {
  initialPlatform?: PlatformKey;
  title?: string;
}) {
  const { browseFolder } = useDocPanel();
  const [platform, setPlatform] = useState<PlatformKey>(initialPlatform);
  const [tab, setTab] = useState<WeiboStep>("hot");
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [sessionUser, setSessionUser] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftForm>(emptyDraft("hot"));
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof DraftForm, string>>>({});

  const platformMeta = PLATFORM_TABS.find((t) => t.id === platform) || PLATFORM_TABS[2];
  const activeTab = WEIBO_TABS.find((t) => t.step === tab) || WEIBO_TABS[0];
  const ready = platformMeta.ready;

  const refresh = useCallback(async () => {
    if (!window.qsApi?.controlListSchedules) {
      setError("桌面端未就绪");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const session = (await window.qsApi.controlEnsureSession?.()) as {
        ok?: boolean;
        username?: string;
        error?: string;
      };
      if (session?.ok && session.username) setSessionUser(session.username);
      await window.qsApi.controlConnectWs?.();
      const res = (await window.qsApi.controlListSchedules({ platform })) as {
        ok?: boolean;
        schedules?: ScheduleRow[];
        error?: string;
      };
      if (!res?.ok) {
        setError(res?.error || "拉取定时任务失败");
        setRows([]);
        return;
      }
      setRows((res.schedules || []) as ScheduleRow[]);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = window.qsApi?.onControlEvent?.((payload) => {
      const msg = payload as { type?: string; msg?: { event?: string } };
      if (
        msg?.type === "ws-message" &&
        (msg.msg?.event === "schedule.fired" ||
          msg.msg?.event === "schedule.updated" ||
          msg.msg?.event === "schedule.deleted" ||
          msg.msg?.event === "task.updated")
      ) {
        void refresh();
      }
    });
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      off?.();
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [tab, platform]);

  const filtered = useMemo(
    () => rows.filter((r) => String(r.step || "") === tab),
    [rows, tab]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  function flash(msg: string) {
    setToast(msg);
    setError("");
    window.setTimeout(() => setToast(""), 2600);
  }

  function validate(form: DraftForm) {
    const next: Partial<Record<keyof DraftForm, string>> = {};
    if (!form.name.trim()) next.name = "请填写任务名称";
    if (form.frequency === "at" && !form.atTime.trim()) {
      next.atTime = "请选择定时时间";
    }
    return next;
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyDraft(tab));
    setFormErrors({});
  }

  function startEdit(row: ScheduleRow) {
    setTab((row.step as WeiboStep) || "hot");
    setEditingId(row.id);
    setDraft({
      name: row.name || "",
      frequency: (row.frequency as FrequencyKey) || "10min",
      atTime: row.atTime || "",
      realtimeLimit: String(row.params?.realtimeLimit ?? 50),
      maxTopics: String(row.params?.maxTopics ?? 0),
    });
    setFormErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitForm() {
    const errs = validate(draft);
    setFormErrors(errs);
    if (Object.keys(errs).length) return;
    if (!ready) {
      setError("当前平台定时任务尚未接入");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await window.qsApi?.controlEnsureSession?.();
      await window.qsApi?.controlConnectWs?.();
      const params = {
        realtimeLimit: Math.max(1, Number(draft.realtimeLimit) || 50),
        maxTopics: Math.max(0, Number(draft.maxTopics) || 0),
        hotLimit: 10,
      };
      const payload = {
        name: draft.name.trim(),
        platform,
        step: tab,
        frequency: draft.frequency,
        atTime: draft.frequency === "at" ? draft.atTime.trim() : "",
        params,
        enabled: true,
      };

      if (editingId) {
        const res = await window.qsApi?.controlUpdateSchedule?.({
          id: editingId,
          ...payload,
        });
        if (!res?.ok) {
          setError(res?.error || "更新失败");
          return;
        }
        flash("定时任务已更新");
      } else {
        const res = await window.qsApi?.controlCreateSchedule?.(payload);
        if (!res?.ok) {
          setError(res?.error || "提交失败");
          return;
        }
        flash("定时任务已提交");
      }
      resetForm();
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleEnabled(row: ScheduleRow) {
    const nextEnabled = !row.enabled;
    const ok = window.confirm(
      nextEnabled ? `确认开启「${row.name}」？` : `确认暂停「${row.name}」？`
    );
    if (!ok) return;
    const res = await window.qsApi?.controlUpdateSchedule?.({
      id: row.id,
      enabled: nextEnabled,
    });
    if (!res?.ok) {
      setError(res?.error || "更新状态失败");
      return;
    }
    flash(nextEnabled ? "已开启" : "已暂停");
    await refresh();
  }

  async function removeRow(row: ScheduleRow) {
    const ok = window.confirm(`确认删除定时任务「${row.name}」？`);
    if (!ok) return;
    const res = await window.qsApi?.controlDeleteSchedule?.(row.id);
    if (!res?.ok) {
      setError(res?.error || "删除失败");
      return;
    }
    if (editingId === row.id) resetForm();
    flash("已删除");
    await refresh();
  }

  async function runNow(row: ScheduleRow) {
    const chain =
      WEIBO_TABS.find((t) => t.step === row.step)?.chain.join(" → ") || row.step;
    const ok = window.confirm(`立即执行「${row.name}」？\n将按顺序：${chain}`);
    if (!ok) return;
    const res = await window.qsApi?.controlRunSchedule?.(row.id);
    if (!res?.ok) {
      setError(res?.error || res?.runError || "触发失败");
      return;
    }
    flash(res.runError ? `已入队（执行异常：${res.runError}）` : "已触发执行");
    await refresh();
  }

  async function browsePlatformData() {
    const dir = await resolvePlatformDataDir(platform);
    if (!dir) {
      setError("未找到平台数据目录");
      return;
    }
    browseFolder(dir);
  }

  async function openLocalPlatformData() {
    const dir = await resolvePlatformDataDir(platform);
    if (!dir) {
      setError("未找到平台数据目录");
      return;
    }
    await window.qsApi?.openPath?.(dir);
  }

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          {title}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{platformMeta.hint}</p>
        {sessionUser ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            控制服：已连接（{sessionUser}）
            {rows.filter((r) => r.enabled).length
              ? ` · 开启中 ${rows.filter((r) => r.enabled).length}`
              : ""}
          </p>
        ) : (
          <p className="mt-1 text-xs text-[var(--text-muted)]">控制服：提交时将自动建立会话</p>
        )}
      </header>

      <div className="mb-5">
        <PlatformPicker
          value={platform}
          onChange={(id) => {
            setPlatform(id);
            resetForm();
            setError("");
            setToast("");
          }}
        />
      </div>

      {!ready ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-white px-6 py-16 text-center shadow-soft">
          <p className="text-base font-medium text-[var(--text-primary)]">
            {platformMeta.label}定时任务即将接入
          </p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            请先选择「微博」；抖音 / 小红书将沿用同一套标签与频率模型
          </p>
        </div>
      ) : (
        <>
          <StepTabs
            value={tab}
            onChange={(step) => {
              setTab(step);
              setEditingId(null);
              setDraft(emptyDraft(step));
              setFormErrors({});
              setError("");
              setToast("");
            }}
          />

          <SectionCard
            step={activeTab.stepNo}
            title={editingId ? `编辑 · ${activeTab.label}` : activeTab.label}
            hint={`${activeTab.desc} · 执行链：${activeTab.chain.join(" → ")}`}
          >
            <div className="flex flex-col gap-3">
              <Field label="任务名称">
                <Input
                  value={draft.name}
                  placeholder="例如：早间热搜巡检"
                  className={cn(formErrors.name && "border-[var(--danger)]")}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, name: e.target.value }));
                    setFormErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                />
                {formErrors.name ? (
                  <span className="text-xs text-[var(--danger)]">{formErrors.name}</span>
                ) : null}
              </Field>

              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label="执行频率"
                  hint={FREQUENCY_OPTIONS.find((f) => f.value === draft.frequency)?.hint}
                  className="w-full max-w-[220px]"
                >
                  <Select
                    value={draft.frequency}
                    onChange={(e) => {
                      const frequency = e.target.value as FrequencyKey;
                      setDraft((d) => ({
                        ...d,
                        frequency,
                        atTime:
                          frequency === "at" && !d.atTime
                            ? defaultAtTimeValue()
                            : d.atTime,
                      }));
                    }}
                  >
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                {draft.frequency === "at" ? (
                  <Field label="定时时间" className="w-full max-w-[240px]">
                    <Input
                      type="datetime-local"
                      value={draft.atTime}
                      className={cn(formErrors.atTime && "border-[var(--danger)]")}
                      onChange={(e) => {
                        setDraft((d) => ({ ...d, atTime: e.target.value }));
                        setFormErrors((prev) => ({ ...prev, atTime: undefined }));
                      }}
                    />
                    {formErrors.atTime ? (
                      <span className="text-xs text-[var(--danger)]">{formErrors.atTime}</span>
                    ) : null}
                  </Field>
                ) : null}

                <Field label="热搜条数" className="w-full max-w-[140px]">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.realtimeLimit}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, realtimeLimit: e.target.value }))
                    }
                  />
                </Field>

                {tab !== "hot" ? (
                  <Field label="详情话题上限" hint="0=不限制" className="w-full max-w-[160px]">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.maxTopics}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, maxTopics: e.target.value }))
                      }
                    />
                  </Field>
                ) : null}
              </div>
            </div>
          </SectionCard>

          {toast ? (
            <p className="mt-4 text-sm font-medium text-[var(--success)]">{toast}</p>
          ) : null}
          {error ? (
            <p className="mt-4 text-sm font-medium text-[var(--danger)]">{error}</p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="h-9 w-fit px-6"
              loading={submitting}
              disabled={submitting}
              onClick={() => void submitForm()}
            >
              {editingId ? "保存修改" : "提交定时任务"}
            </Button>
            {editingId ? (
              <Button
                type="button"
                variant="secondary"
                className="h-9 w-fit px-6"
                disabled={submitting}
                onClick={resetForm}
              >
                取消编辑
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-fit px-6"
                disabled={submitting}
                onClick={resetForm}
              >
                清空
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className="h-9 w-fit px-6"
              disabled={loading}
              onClick={() => void refresh()}
            >
              {loading ? "刷新中…" : "刷新看板"}
            </Button>
          </div>

          <section className="mt-8">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                任务看板
                <span className="ml-2 font-normal text-[var(--text-muted)]">
                  {activeTab.stepNo} {activeTab.label} · {filtered.length} 条
                </span>
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 gap-1.5"
                  title="在右侧栏浏览平台数据目录"
                  onClick={() => void browsePlatformData()}
                >
                  <FolderSearch className="h-3.5 w-3.5" />
                  数据浏览
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5"
                  title="用资源管理器打开本地数据目录"
                  onClick={() => void openLocalPlatformData()}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  打开本地数据
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)]">
              {pageRows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[var(--text-muted)]">
                  当前标签暂无定时任务，填写上方表单后提交
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {pageRows.map((row) => {
                    const freqLabel =
                      row.frequency === "at" && row.atTime
                        ? `定时 ${row.atTime}`
                        : FREQUENCY_LABEL[row.frequency as FrequencyKey] || row.frequency;
                    return (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm"
                      >
                        <div className="min-w-[140px] max-w-[220px]">
                          <div
                            className="truncate font-medium text-[var(--text-primary)]"
                            title={row.name}
                          >
                            {row.name}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {STEP_LABEL[row.step] || row.step}
                          </div>
                        </div>

                        <span className="rounded bg-[#eef1f6] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                          {freqLabel}
                        </span>
                        <span className="text-xs tabular-nums text-[var(--text-muted)]">
                          执行 {row.runCount ?? 0} 次
                        </span>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={row.enabled}
                          title={row.enabled ? "点击暂停" : "点击开启"}
                          onClick={() => void toggleEnabled(row)}
                          className={cn(
                            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                            row.enabled
                              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                              : "bg-[#f1f5f9] text-[var(--text-muted)]"
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              row.enabled ? "bg-[var(--accent)]" : "bg-[#94a3b8]"
                            )}
                          />
                          {row.enabled ? "开启" : "暂停"}
                        </button>

                        <span className="text-xs text-[var(--text-muted)]">
                          下次 {row.enabled ? fmtTime(row.nextRunAt) : "—"}
                        </span>
                        {(() => {
                          const recent = recentRunLabel(row);
                          return (
                            <span
                              className={cn(
                                "text-xs",
                                recent.tone === "danger"
                                  ? "text-[var(--danger)]"
                                  : recent.tone === "success"
                                    ? "text-[var(--success)]"
                                    : "text-[var(--text-muted)]"
                              )}
                              title={row.lastError || ""}
                            >
                              {recent.text}
                            </span>
                          );
                        })()}

                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => void runNow(row)}
                          >
                            <Play className="h-3.5 w-3.5" />
                            立即
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => startEdit(row)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            编辑
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-[var(--danger)] hover:text-[var(--danger)]"
                            onClick={() => void removeRow(row)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[var(--text-muted)]">
                本标签 {filtered.length} 条 · 平台合计 {rows.length} 条 · 第 {safePage}/
                {totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
