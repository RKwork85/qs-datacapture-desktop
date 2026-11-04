import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { emitToast } from "@/components/ui/toast";
import { useDocPanel } from "@/context/DocPanelContext";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { useDyFlow } from "./DyFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

export function MediaPage() {
  const { busy, runTask } = useTask();
  const { goTo } = useNav();
  const { browseFolder } = useDocPanel();
  const { lastCsvPath, setLastCsvPath, setLastOut, lastOut } = useDyFlow();
  const [csvPath, setCsvPath] = useState(lastCsvPath);
  const [noteType, setNoteType] = useState<"all" | "image" | "video">("all");
  const [mediaMax, setMediaMax] = useState(3);
  const [error, setError] = useState("");
  const [doneOut, setDoneOut] = useState("");

  useEffect(() => {
    if (lastCsvPath) setCsvPath(lastCsvPath);
  }, [lastCsvPath]);

  async function pickCsv() {
    const p = await window.qsApi?.selectFile?.([{ name: "CSV", extensions: ["csv"] }]);
    if (p) {
      setCsvPath(p);
      setLastCsvPath(p);
      setError("");
    }
  }

  return (
    <PageFrame
      pageId="dy.media"
      title="媒体下载"
      hint="读取主页采集 CSV，解析作品并下载封面 / 图集 / 视频，汇总为 xlsx。可从「作品采集」自动带入路径。"
    >
      <Field label="主页 CSV" className="w-full">
        <div className="flex w-full gap-2">
          <Input
            className="min-w-0 flex-1"
            value={csvPath}
            onChange={(e) => {
              setCsvPath(e.target.value);
              setError("");
            }}
            placeholder="选择或粘贴 dy_aweme_*.csv 路径"
            disabled={busy}
          />
          <Button
            type="button"
            variant="secondary"
            className="h-9 shrink-0 px-4"
            disabled={busy}
            onClick={pickCsv}
          >
            选择
          </Button>
        </div>
      </Field>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="类型">
          <Select
            value={noteType}
            onChange={(e) => setNoteType(e.target.value as typeof noteType)}
            disabled={busy}
          >
            <option value="all">全部</option>
            <option value="image">仅图文</option>
            <option value="video">仅视频</option>
          </Select>
        </Field>
        <Field label="篇数上限" hint="单文件≤100MB，并发≤3，建议≤3">
          <Input
            type="number"
            min={1}
            max={150}
            value={mediaMax}
            onChange={(e) => setMediaMax(Math.min(150, Number(e.target.value || 3)))}
            disabled={busy}
          />
        </Field>
      </div>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {doneOut || lastOut ? (
        <p className="max-w-full truncate text-xs text-[var(--text-muted)]">
          最近输出：{doneOut || lastOut}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className={actionBtnClass}
          loading={busy}
          disabled={busy || !csvPath.trim()}
          onClick={async () => {
            const path = csvPath.trim();
            if (!path.toLowerCase().endsWith(".csv")) {
              setError("请选择或填写 .csv 文件路径");
              emitToast("抖音", "媒体下载", "请选择或填写 .csv 文件路径", "error");
              return;
            }
            setError("");
            setLastCsvPath(path);
            const res = await runTask("dy.fetch_media", {
              csvPath: path,
              noteType,
              maxNotes: mediaMax,
            });
            if (!res.ok) {
              setError(res.error || "下载失败");
              return;
            }
            const out =
              (res.result?.xlsxPath as string) ||
              (res.result?.outRoot as string) ||
              "";
            if (out) {
              setLastOut(out);
              setDoneOut(out);
            }
          }}
        >
          开始下载
        </Button>
        {(doneOut || lastOut) && (
          <Button
            type="button"
            variant="secondary"
            className="h-9 w-fit px-4"
            disabled={busy}
            onClick={() => window.qsApi?.openPath?.(doneOut || lastOut)}
          >
            打开输出
          </Button>
        )}
        <Button
          type="button"
          data-qs-doc-toggle
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy}
          title="在侧栏浏览该 CSV 所在目录"
          onClick={() => {
            const path = (csvPath || lastCsvPath || doneOut || lastOut || "").trim();
            const dir = path.replace(/[/\\][^/\\]+$/, "") || path;
            if (dir) browseFolder(dir);
          }}
        >
          浏览数据
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy}
          onClick={() => goTo("dy.publish_note")}
        >
          去发图文
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy}
          onClick={() => goTo("dy.publish_video")}
        >
          去发视频
        </Button>
      </div>
    </PageFrame>
  );
}

