import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useNav } from "@/context/NavContext";
import { useXhsFlow } from "./XhsFlowContext";
import { PageFrame } from "./PageFrame";
import { cn } from "@/lib/utils";

type TabKey = "notes" | "note_pub" | "video_pub";

type BatchItem = {
  name: string;
  outRoot: string;
  xlsxPath: string;
  noteCount: number;
  mtime: number;
};

type NoteItem = {
  noteId: string;
  folder: string;
  title: string;
  desc: string;
  topics: string;
  type: string;
  nickname: string;
  imageCount: number;
  videoCount: number;
  videoPath: string;
  mtime: number;
};

type PublishItem = {
  id: string;
  noteTitle: string;
  at: string;
  status: string;
  likes: number | null;
  reads: number | null;
  path: string;
  scheduleTime: string;
  error: string;
  tags: string;
  content: string;
};

function fmtTime(ms: number) {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700",
    failed: "bg-rose-50 text-rose-700",
    scheduled: "bg-sky-50 text-sky-700",
  };
  const label =
    status === "failed" ? "失败" : status === "scheduled" ? "定时中" : "成功";
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
        map[status] || map.success
      )}
    >
      {label}
    </span>
  );
}

const TABS: { id: TabKey; label: string }[] = [
  { id: "notes", label: "笔记数据" },
  { id: "note_pub", label: "图文发布" },
  { id: "video_pub", label: "视频发布" },
];

export function RecordsPage() {
  const { goTo } = useNav();
  const { setLastOut, applyNoteForPublish, setNoteDraft, setVideoDraft } = useXhsFlow();
  const [tab, setTab] = useState<TabKey>("notes");
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [publishNotes, setPublishNotes] = useState<PublishItem[]>([]);
  const [publishVideos, setPublishVideos] = useState<PublishItem[]>([]);
  const [query, setQuery] = useState("");
  const [activeBatch, setActiveBatch] = useState("");
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notesLoading, setNotesLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await window.qsApi?.listXhsRecords?.();
      const nextBatches = (data?.batches as BatchItem[]) || [];
      setBatches(nextBatches);
      setPublishNotes((data?.publishNotes as PublishItem[]) || []);
      setPublishVideos((data?.publishVideos as PublishItem[]) || []);
      setActiveBatch((prev) => prev || nextBatches[0]?.outRoot || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!activeBatch || tab !== "notes") {
      setNotes([]);
      return;
    }
    let cancelled = false;
    setNotesLoading(true);
    window.qsApi
      ?.listNotesInBatch?.(activeBatch)
      .then((list) => {
        if (!cancelled) setNotes((list as NoteItem[]) || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setNotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBatch, tab]);

  const filteredBatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((b) => b.name.toLowerCase().includes(q));
  }, [batches, query]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.noteId.toLowerCase().includes(q) ||
        (n.nickname || "").toLowerCase().includes(q)
    );
  }, [notes, query]);

  const pubList = tab === "video_pub" ? publishVideos : publishNotes;
  const filteredPubs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pubList;
    return pubList.filter((p) => p.noteTitle.toLowerCase().includes(q));
  }, [pubList, query]);

  function publishNote(note: NoteItem) {
    const dest = applyNoteForPublish({
      folder: note.folder,
      title: note.title,
      desc: note.desc,
      topics: note.topics,
      videoPath: note.videoPath,
      type: note.type,
    });
    goTo(dest === "video" ? "xhs.publish_video" : "xhs.publish_note");
  }

  function republish(item: PublishItem, kind: "note" | "video") {
    if (kind === "video") {
      setVideoDraft({
        videoPath: item.path,
        title: item.noteTitle.slice(0, 20),
        content: item.content || "",
        tags: item.tags || "",
      });
      goTo("xhs.publish_video");
      return;
    }
    setNoteDraft({
      imageDir: item.path,
      title: item.noteTitle.slice(0, 20),
      content: item.content || "",
      tags: item.tags || "",
    });
    goTo("xhs.publish_note");
  }

  const dataDir =
    activeBatch ||
    batches[0]?.outRoot ||
    (batches[0] as BatchItem | undefined)?.xlsxPath ||
    "";

  return (
    <PageFrame
      pageId="data.records"
      title="数据中心"
      hint="管理本机笔记批次与发布记录。可搜索、展开批次，或一键带回发布页。"
      layout="wide"
    >
      <div className="flex w-full flex-col gap-4">
        <div className="flex w-full items-center gap-1 border-b border-[var(--border)]">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={cn(
                  "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
                  active
                    ? "border-[var(--accent)] font-semibold text-[var(--accent)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex w-full flex-wrap items-center gap-3">
          <Input
            className="max-w-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "notes" ? "按批次名 / 笔记标题搜索" : "按发布标题搜索"
            }
          />
          <div className="ml-auto flex flex-wrap gap-1">
            <Button type="button" variant="ghost" className="h-9 px-3" onClick={() => void refresh()}>
              刷新
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9 px-3"
              disabled={!dataDir}
              onClick={() => window.qsApi?.openPath?.(dataDir)}
            >
              打开数据目录
            </Button>
          </div>
        </div>

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        {loading ? <p className="text-sm text-[var(--text-muted)]">加载中…</p> : null}

        {tab === "notes" ? (
          <>
            <div className="w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-white shadow-soft">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-[#f8fafc] text-xs font-medium text-[var(--text-muted)]">
                    <th className="px-4 py-2.5 font-medium">批次名称</th>
                    <th className="px-4 py-2.5 font-medium">采集时间</th>
                    <th className="px-4 py-2.5 font-medium">数据量</th>
                    <th className="px-4 py-2.5 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {!filteredBatches.length && !loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        暂无下载批次
                      </td>
                    </tr>
                  ) : (
                    filteredBatches.map((b) => {
                      const active = b.outRoot === activeBatch;
                      return (
                        <tr
                          key={b.outRoot}
                          className={cn(
                            "border-t border-[#f1f5f9] transition-colors",
                            active ? "bg-[var(--accent-soft)]/40" : "hover:bg-[#f8fafc]"
                          )}
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              className="max-w-[360px] truncate text-left font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                              onClick={() => {
                                setActiveBatch(b.outRoot);
                                setLastOut(b.outRoot);
                              }}
                            >
                              {b.name}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">
                            {fmtTime(b.mtime)}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">
                            {b.noteCount} 篇
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-8 px-2 text-[var(--accent)]"
                                onClick={() => {
                                  setActiveBatch(b.outRoot);
                                  setLastOut(b.outRoot);
                                }}
                              >
                                查看笔记
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-8 px-2"
                                onClick={() => window.qsApi?.openPath?.(b.outRoot)}
                              >
                                打开
                              </Button>
                              {b.xlsxPath ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-8 px-2"
                                  onClick={() => window.qsApi?.openPath?.(b.xlsxPath)}
                                >
                                  表格
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="w-full">
              <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
                批次笔记
                {activeBatch ? (
                  <span className="ml-2 font-normal text-[var(--text-muted)]">
                    {activeBatch.split(/[/\\]/).pop()}
                  </span>
                ) : null}
              </h2>
              <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-white shadow-soft">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] text-xs font-medium text-[var(--text-muted)]">
                      <th className="px-4 py-2.5 font-medium">标题</th>
                      <th className="px-4 py-2.5 font-medium">类型</th>
                      <th className="px-4 py-2.5 font-medium">媒体数</th>
                      <th className="px-4 py-2.5 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notesLoading ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                          读取笔记…
                        </td>
                      </tr>
                    ) : !filteredNotes.length ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                          {activeBatch ? "该批次暂无笔记" : "请选择上方批次"}
                        </td>
                      </tr>
                    ) : (
                      filteredNotes.map((n) => (
                        <tr key={n.folder} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                          <td className="max-w-[320px] px-4 py-3">
                            <div className="truncate font-medium text-[var(--text-primary)]">
                              {n.title || n.noteId}
                            </div>
                            <div className="truncate text-xs text-[var(--text-muted)]">
                              {n.nickname || n.noteId}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">
                            {String(n.type).includes("video") ? "视频" : "图文"}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">
                            {n.videoCount ? `视频 ×${n.videoCount}` : `图 ×${n.imageCount}`}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-8 px-2 text-[var(--accent)]"
                                onClick={() => publishNote(n)}
                              >
                                去发布
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-8 px-2"
                                onClick={() => window.qsApi?.openPath?.(n.folder)}
                              >
                                查看
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-white shadow-soft">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#f8fafc] text-xs font-medium text-[var(--text-muted)]">
                  <th className="px-4 py-2.5 font-medium">发布标题</th>
                  <th className="px-4 py-2.5 font-medium">发布时间</th>
                  <th className="px-4 py-2.5 font-medium">状态</th>
                  <th className="px-4 py-2.5 font-medium">数据反馈</th>
                  <th className="px-4 py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {!filteredPubs.length && !loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                      暂无{tab === "video_pub" ? "视频" : "图文"}发布记录
                    </td>
                  </tr>
                ) : (
                  filteredPubs.map((p) => (
                    <tr key={p.id} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                      <td className="max-w-[280px] px-4 py-3">
                        <div className="truncate font-medium text-[var(--text-primary)]">
                          {p.noteTitle}
                        </div>
                        {p.error ? (
                          <div className="truncate text-xs text-[var(--danger)]">{p.error}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        {p.scheduleTime || p.at || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        {p.likes != null || p.reads != null
                          ? `赞 ${p.likes ?? "—"} / 阅读 ${p.reads ?? "—"}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 px-2 text-[var(--accent)]"
                            onClick={() =>
                              republish(p, tab === "video_pub" ? "video" : "note")
                            }
                          >
                            重新发布
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 px-2"
                            disabled={!p.path}
                            onClick={() => p.path && window.qsApi?.openPath?.(p.path)}
                          >
                            查看
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageFrame>
  );
}
