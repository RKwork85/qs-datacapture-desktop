import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { LastCsvBar } from "@/components/LastCsvBar";
import { emitToast } from "@/components/ui/toast";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { useXhsFlow } from "./XhsFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

function looksLikeProfileUrl(url: string) {
  return /xiaohongshu\.com\/user\/profile\//i.test(url);
}

export function CollectPage() {
  const { busy, runTask } = useTask();
  const { goTo } = useNav();
  const { setLastCsvPath, setLastOut, lastProfileUrl, setLastProfileUrl, lastCsvPath } =
    useXhsFlow();
  const [profileUrl, setProfileUrl] = useState(lastProfileUrl);
  const [maxNotes, setMaxNotes] = useState(0);
  const [error, setError] = useState("");

  return (
    <PageFrame
      pageId="xhs.collect"
      title="笔记采集"
      hint="输入创作者主页链接，滚动采集笔记列表并导出 CSV。成功后自动进入「媒体下载」。"
    >
      <Field label="主页链接" className="w-full" hint="需包含 /user/profile/">
        <Input
          value={profileUrl}
          onChange={(e) => {
            setProfileUrl(e.target.value);
            setError("");
          }}
          placeholder="https://www.xiaohongshu.com/user/profile/..."
          disabled={busy}
        />
      </Field>
      <Field label="最多条数（0 = 全部）" className="w-full max-w-xs">
        <Input
          type="number"
          min={0}
          value={maxNotes}
          onChange={(e) => setMaxNotes(Number(e.target.value || 0))}
          disabled={busy}
        />
      </Field>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {lastCsvPath ? (
        <LastCsvBar csvPath={lastCsvPath} onGoMedia={() => goTo("xhs.media")} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className={actionBtnClass}
          loading={busy}
          disabled={busy || !profileUrl.trim()}
          onClick={async () => {
            const url = profileUrl.trim();
            if (!looksLikeProfileUrl(url)) {
              setError("请填写有效的小红书主页链接（需包含 /user/profile/）");
              emitToast("小红书", "笔记采集", "请填写有效的主页链接（需包含 /user/profile/）", "error");
              return;
            }
            setError("");
            setLastProfileUrl(url);
            const res = await runTask("xhs.fetch_profile", {
              profileUrl: url,
              maxNotes,
            });
            if (!res.ok) {
              setError(res.error || "采集失败");
              return;
            }
            const path = (res.result?.csvPath as string) || "";
            if (path) {
              setLastCsvPath(path);
              setLastOut(path);
            }
            window.setTimeout(() => goTo("xhs.media"), 400);
          }}
        >
          开始采集
        </Button>
      </div>
    </PageFrame>
  );
}
