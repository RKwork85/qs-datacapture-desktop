import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckRow, DateTimeInput, Field, Input, Select, Textarea } from "@/components/ui/field";
import { useNav } from "@/context/NavContext";
import { useTask } from "@/context/TaskContext";
import { emitToast } from "@/components/ui/toast";
import { XHS_DECLARATION_OPTIONS } from "@/pages/publishOptions";
import { useXhsFlow } from "./XhsFlowContext";
import { PageFrame, actionBtnClass } from "./PageFrame";

function sanitizeTags(raw: string) {
  return String(raw || "")
    .split(/[\s,，]+/)
    .map((t) =>
      t
        .replace(/\[话题\]/g, "")
        .replace(/^#+/, "")
        .replace(/#+$/, "")
        .replace(/[\[\]【】]/g, "")
        .trim()
    )
    .filter(Boolean)
    .map((n) => `#${n}`)
    .join(" ");
}

function stripTopicBadge(raw: string) {
  return String(raw || "").replace(/\[话题\]/g, "");
}

export function PublishVideoPage() {
  const { busy, runTask } = useTask();
  const { goTo } = useNav();
  const { videoDraft, setVideoDraft } = useXhsFlow();
  const { videoPath, title, content, tags, schedule, scheduleTime, declaration } = videoDraft;
  const [error, setError] = useState("");

  async function pickVideo() {
    const p = await window.qsApi?.selectFile?.([
      { name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "m4v"] },
    ]);
    if (p) {
      setVideoDraft({ videoPath: p });
      setError("");
    }
  }

  return (
    <PageFrame
      pageId="xhs.publish_video"
      title="视频发布"
      hint="表单会自动记住。也可从「数据记录」选已下载笔记一键填入。"
    >
      <Field label="视频文件" className="w-full" hint="支持 mp4 / mov / avi / mkv / m4v">
        <div className="flex w-full gap-2">
          <Input
            className="min-w-0 flex-1"
            value={videoPath}
            onChange={(e) => {
              setVideoDraft({ videoPath: e.target.value });
              setError("");
            }}
            placeholder="选择视频文件路径"
            disabled={busy}
          />
          <Button
            type="button"
            variant="secondary"
            className="h-9 shrink-0 px-4"
            disabled={busy}
            onClick={pickVideo}
          >
            选择
          </Button>
        </div>
      </Field>

      <Field label="标题" className="w-full" hint={`${title.length}/20`}>
        <Input
          value={title}
          maxLength={20}
          onChange={(e) => setVideoDraft({ title: e.target.value })}
          placeholder="不超过 20 字"
          disabled={busy}
        />
      </Field>

      <Field label="正文" className="w-full">
        <Textarea
          value={content}
          rows={5}
          onChange={(e) => setVideoDraft({ content: e.target.value })}
          placeholder="视频描述"
          disabled={busy}
        />
      </Field>

      <Field
        label="话题"
        className="w-full"
        hint="多个话题用空格或逗号分隔；粘贴带 [话题] 会自动去掉"
      >
        <Input
          value={tags}
          placeholder="#话题A #话题B"
          onChange={(e) => setVideoDraft({ tags: e.target.value })}
          onBlur={() => setVideoDraft({ tags: sanitizeTags(tags) })}
          disabled={busy}
        />
      </Field>

      <CheckRow
        checked={schedule}
        onChange={(v) => {
          setVideoDraft({ schedule: v, scheduleTime: v ? scheduleTime : "" });
        }}
        disabled={busy}
      >
        定时发布
      </CheckRow>

      {schedule ? (
        <Field label="定时时间" className="w-full max-w-sm" hint="点击右侧日历图标选择日期与时间">
          <DateTimeInput
            value={scheduleTime}
            onChange={(v) => setVideoDraft({ scheduleTime: v })}
            disabled={busy}
          />
        </Field>
      ) : null}

      <Field label="内容类型声明" className="w-full max-w-md" hint="对应创作者中心「添加内容类型声明」">
        <Select
          value={declaration}
          disabled={busy}
          onChange={(e) => setVideoDraft({ declaration: e.target.value })}
        >
          {XHS_DECLARATION_OPTIONS.map((o) => (
            <option key={o.value || "none"} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className={actionBtnClass}
          loading={busy}
          disabled={busy || !videoPath.trim() || !title.trim()}
          onClick={async () => {
            if (!videoPath.trim()) {
              setError("请选择视频文件");
              emitToast("小红书", "视频发布", "请先选择视频文件", "error");
              return;
            }
            if (!title.trim()) {
              setError("请填写标题");
              emitToast("小红书", "视频发布", "请填写标题后再发布", "error");
              return;
            }
            if (schedule && !scheduleTime.trim()) {
              setError("请选择定时时间");
              emitToast("小红书", "视频发布", "请选择定时发布时间", "error");
              return;
            }
            setError("");
            const cleanTags = sanitizeTags(tags);
            const cleanContent = stripTopicBadge(content);
            setVideoDraft({ tags: cleanTags, content: cleanContent });
            const res = await runTask("xhs.publish_video", {
              videoPath: videoPath.trim(),
              title: title.trim(),
              content: cleanContent,
              tags: cleanTags,
              schedule,
              scheduleTime: schedule ? scheduleTime.trim() : "",
              declaration: declaration.trim(),
            });
            if (!res.ok) setError(res.error || "发布失败");
          }}
        >
          发布视频
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy}
          onClick={() => goTo("data.storage")}
        >
          从存储载入
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit px-4"
          disabled={busy}
          onClick={() => goTo("xhs.publish_note")}
        >
          改发图文
        </Button>
      </div>
    </PageFrame>
  );
}
