import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { LastCsvBar } from "@/components/LastCsvBar";
import { emitToast } from "@/components/ui/toast";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { useDyFlow } from "./DyFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

function looksLikeProfileUrl(url: string) {
  return /douyin\.com\/user\//i.test(url);
}

export function CollectPage() {
  const { busy, runTask } = useTask();
  const { goTo } = useNav();
  const { setLastCsvPath, setLastOut, lastProfileUrl, setLastProfileUrl, lastCsvPath } =
    useDyFlow();
  const [profileUrl, setProfileUrl] = useState(lastProfileUrl);
  const [maxNotes, setMaxNotes] = useState(30);
  const [error, setError] = useState("");

  return (
    <PageFrame
      pageId="dy.collect"
      title="作品采集"
      hint="输入创作者主页链接，滚动采集作品列表并导出 CSV。成功后自动进入「媒体下载」。"
    >
      <Field label="主页链接" className="w-full" hint="需包含 /user/">
        <Input
          value={profileUrl}
          onChange={(e) => {
            setProfileUrl(e.target.value);
            setError("");
          }}
          placeholder="https://www.douyin.com/user/..."
          disabled={busy}
        />
      </Field>
      <Field label="最多条数" className="w-full max-w-xs" hint="上限 150，建议 30 内">
        <Input
          type="number"
          min={1}
          max={150}
          value={maxNotes}
          onChange={(e) => setMaxNotes(Math.min(150, Number(e.target.value || 30)))}
          disabled={busy}
        />
      </Field>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {lastCsvPath ? (
        <LastCsvBar csvPath={lastCsvPath} onGoMedia={() => goTo("dy.media")} />
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
              setError("请填写有效的抖音主页链接（需包含 /user/）");
              emitToast("抖音", "作品采集", "请填写有效的主页链接（需包含 /user/）", "error");
              return;
            }
            setError("");
            setLastProfileUrl(url);
            const res = await runTask("dy.fetch_profile", {
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
            window.setTimeout(() => goTo("dy.media"), 400);
          }}
        >
          开始采集
        </Button>
      </div>
    </PageFrame>
  );
}

