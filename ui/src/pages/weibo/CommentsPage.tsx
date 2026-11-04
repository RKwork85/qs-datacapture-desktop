import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { useWeiboFlow } from "./WeiboFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

export function CommentsPage() {
  const { busy, runTask } = useTask();
  const { goTo } = useNav();
  const {
    lastDetailCsv,
    setLastDetailCsv,
    lastCommentCsv,
    setLastCommentCsv,
    setLastOut,
  } = useWeiboFlow();
  const [csvPath, setCsvPath] = useState(lastDetailCsv);
  const [commentPosts, setCommentPosts] = useState(3);
  const [commentTop, setCommentTop] = useState(100);
  const [error, setError] = useState("");
  
  useEffect(() => {
    if (lastDetailCsv) setCsvPath(lastDetailCsv);
  }, [lastDetailCsv]);

  async function pickCsv() {
    const p = await window.qsApi?.selectFile?.([{ name: "CSV", extensions: ["csv"] }]);
    if (p) {
      setCsvPath(p);
      setLastDetailCsv(p);
      setError("");
    }
  }

  return (
    <PageFrame
      pageId="weibo.comments"
      title="榜单评论区"
      hint="基于详情 CSV，按点赞取每话题 Top 帖并抓热门评论。需已登录。"
    >
      <Field label="详情 CSV" className="w-full">
        <div className="flex w-full gap-2">
          <Input
            className="min-w-0 flex-1"
            value={csvPath}
            onChange={(e) => setCsvPath(e.target.value)}
            placeholder="选择或粘贴 weibo_detail_*.csv"
            disabled={busy}
          />
          <Button type="button" variant="secondary" className="h-9 shrink-0 px-4" disabled={busy} onClick={pickCsv}>
            选择
          </Button>
        </div>
      </Field>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="每话题取帖数" hint="按点赞排序">
          <Input
            type="number"
            min={1}
            max={20}
            value={commentPosts}
            onChange={(e) => setCommentPosts(Number(e.target.value || 3))}
            disabled={busy}
          />
        </Field>
        <Field label="每帖评论上限">
          <Input
            type="number"
            min={1}
            max={200}
            value={commentTop}
            onChange={(e) => setCommentTop(Number(e.target.value || 100))}
            disabled={busy}
          />
        </Field>
      </div>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
            {lastCommentCsv ? (
        <p className="max-w-full truncate text-xs text-[var(--text-muted)]">
          上次评论：{lastCommentCsv}
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
              setError("请选择详情 CSV");
              return;
            }
            setError("");
            setLastDetailCsv(path);
            const res = await runTask("weibo.comments", {
              csvPath: path,
              commentPosts,
              commentTop,
            });
            if (!res.ok) {
              setError(res.error || "评论区采集失败");
              return;
            }
            const out = (res.result?.csvPath as string) || "";
            const xlsx = (res.result?.xlsxPath as string) || "";
            if (out) {
              setLastCommentCsv(out);
              setLastOut(xlsx || out);
            }
          }}
        >
          开始抓取评论
        </Button>
        {lastCommentCsv ? (
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-fit px-4"
            disabled={busy}
            onClick={() => window.qsApi?.openPath?.(lastCommentCsv)}
          >
            打开 CSV
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy}
          onClick={() => goTo("weibo.detail")}
        >
          回榜单详情
        </Button>
      </div>
    </PageFrame>
  );
}
