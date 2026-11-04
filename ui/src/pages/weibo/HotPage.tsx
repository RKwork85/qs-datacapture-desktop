import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { useWeiboFlow } from "./WeiboFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

export function HotPage() {
  const { busy, runTask } = useTask();
  const { goTo } = useNav();
  const { lastHotCsv, setLastHotCsv, setLastOut } = useWeiboFlow();
  const [limit, setLimit] = useState(50);
  const [error, setError] = useState("");

  return (
    <PageFrame
      pageId="weibo.hot"
      title="热搜榜"
      hint="拉取微博实时热搜并导出 CSV。成功后可继续抓取榜单详情。"
    >
      <Field label="条数上限" className="w-full max-w-xs" hint="不含置顶时的实时热点条数">
        <Input
          type="number"
          min={1}
          max={100}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value || 50))}
          disabled={busy}
        />
      </Field>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {lastHotCsv ? (
        <p className="max-w-full truncate text-xs text-[var(--text-muted)]">上次 CSV：{lastHotCsv}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className={actionBtnClass}
          loading={busy}
          disabled={busy}
          onClick={async () => {
            setError("");
            const res = await runTask("weibo.hot", { limit });
            if (!res.ok) {
              setError(res.error || "采集失败");
              return;
            }
            const csv = (res.result?.csvPath as string) || "";
            if (csv) {
              setLastHotCsv(csv);
              setLastOut(csv);
            }
          }}
        >
          开始采集
        </Button>
        {lastHotCsv ? (
          <>
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-fit px-4"
              disabled={busy}
              onClick={() => window.qsApi?.openPath?.(lastHotCsv)}
            >
              打开 CSV
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-fit px-4"
              disabled={busy}
              onClick={() => goTo("weibo.detail")}
            >
              去榜单详情
            </Button>
          </>
        ) : null}
      </div>
    </PageFrame>
  );
}
