import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { useWeiboFlow } from "./WeiboFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

export function DetailPage() {
  const { busy, runTask } = useTask();
  const { goTo } = useNav();
  const { lastHotCsv, setLastHotCsv, lastDetailCsv, setLastDetailCsv, setLastOut } =
    useWeiboFlow();
  const [csvPath, setCsvPath] = useState(lastHotCsv);
  const [hotLimit, setHotLimit] = useState(10);
  const [maxTopics, setMaxTopics] = useState(0);
  const [error, setError] = useState("");
  
  useEffect(() => {
    if (lastHotCsv) setCsvPath(lastHotCsv);
  }, [lastHotCsv]);

  async function pickCsv() {
    const p = await window.qsApi?.selectFile?.([{ name: "CSV", extensions: ["csv"] }]);
    if (p) {
      setCsvPath(p);
      setLastHotCsv(p);
      setError("");
    }
  }

  return (
    <PageFrame
      pageId="weibo.detail"
      title="榜单详情"
      hint="基于热搜 CSV，HTTP 抓取每个话题下热门微博。需已登录。0 话题数 = 全部。"
    >
      <Field label="热搜 CSV" className="w-full">
        <div className="flex w-full gap-2">
          <Input
            className="min-w-0 flex-1"
            value={csvPath}
            onChange={(e) => setCsvPath(e.target.value)}
            placeholder="选择或粘贴 weibo_hot_*.csv"
            disabled={busy}
          />
          <Button type="button" variant="secondary" className="h-9 shrink-0 px-4" disabled={busy} onClick={pickCsv}>
            选择
          </Button>
        </div>
      </Field>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="每话题热门条数">
          <Input
            type="number"
            min={1}
            max={50}
            value={hotLimit}
            onChange={(e) => setHotLimit(Number(e.target.value || 10))}
            disabled={busy}
          />
        </Field>
        <Field label="话题上限（0=全部）" hint="调试时可先设较小值">
          <Input
            type="number"
            min={0}
            max={100}
            value={maxTopics}
            onChange={(e) => setMaxTopics(Number(e.target.value || 0))}
            disabled={busy}
          />
        </Field>
      </div>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {lastDetailCsv ? (
        <p className="max-w-full truncate text-xs text-[var(--text-muted)]">
          上次详情：{lastDetailCsv}
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
              setError("请选择热搜 CSV");
              return;
            }
            setError("");
            setLastHotCsv(path);
            const res = await runTask("weibo.detail", {
              csvPath: path,
              hotLimit,
              maxTopics,
            });
            if (!res.ok) {
              setError(res.error || "详情采集失败");
              return;
            }
            const out = (res.result?.csvPath as string) || "";
            const xlsx = (res.result?.xlsxPath as string) || "";
            if (out) {
              setLastDetailCsv(out);
              setLastOut(xlsx || out);
            }
          }}
        >
          开始抓取详情
        </Button>
        {lastDetailCsv ? (
          <>
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-fit px-4"
              disabled={busy}
              onClick={() => window.qsApi?.openPath?.(lastDetailCsv)}
            >
              打开 CSV
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-fit px-4"
              disabled={busy}
              onClick={() => goTo("weibo.comments")}
            >
              去评论区
            </Button>
          </>
        ) : null}
      </div>
    </PageFrame>
  );
}
