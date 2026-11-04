import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckRow,
  Field,
  Input,
  SectionCard,
  Select,
  Textarea,
} from "@/components/ui/field";
import { useTask } from "@/context/TaskContext";

export function XhsWorkspace() {
  const { busy, runTask } = useTask();

  const [profileUrl, setProfileUrl] = useState("");
  const [maxNotes, setMaxNotes] = useState(0);
  const [csvPath, setCsvPath] = useState("");
  const [noteType, setNoteType] = useState<"all" | "image" | "video">("all");
  const [mediaMax, setMediaMax] = useState(20);

  const [imageDir, setImageDir] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteTags, setNoteTags] = useState("");
  const [noteSchedule, setNoteSchedule] = useState(false);

  const [videoPath, setVideoPath] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoContent, setVideoContent] = useState("");
  const [videoTags, setVideoTags] = useState("");
  const [videoSchedule, setVideoSchedule] = useState(false);

  const [lastOut, setLastOut] = useState("");

  async function pickCsv() {
    const p = await window.qsApi?.selectFile?.([{ name: "CSV", extensions: ["csv"] }]);
    if (p) setCsvPath(p);
  }

  async function pickImageDir() {
    const p = await window.qsApi?.selectDir?.();
    if (p) setImageDir(p);
  }

  async function pickVideo() {
    const p = await window.qsApi?.selectFile?.([
      { name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "m4v"] },
    ]);
    if (p) setVideoPath(p);
  }

  async function openOut(path?: string) {
    const target = path || lastOut;
    if (!target) return;
    await window.qsApi?.openPath?.(target);
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
          小红书工作区
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          登录态保存在本机；采集、下载与发布均通过 Playwright 自动化完成。执行日志见底部面板。
        </p>
        {lastOut ? (
          <button
            type="button"
            onClick={() => openOut()}
            className="mt-2 cursor-pointer text-left text-xs font-medium text-[var(--accent)] hover:underline"
          >
            最近输出：{lastOut}
          </button>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          step="01"
          title="账号登录"
          hint="优先读取本地 Cookie；失效后自动打开扫码页。"
        >
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button
              loading={busy}
              disabled={busy}
              onClick={async () => {
                const res = await runTask("xhs.login", {});
                const path = res.result?.cookiePath as string | undefined;
                if (path) setLastOut(path);
              }}
            >
              开始登录
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          step="02"
          title="主页笔记采集"
          hint="滚动主页并拦截接口，导出 CSV（标题 / 链接 / 封面 / 点赞）。"
        >
          <Field label="主页链接">
            <Input
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder="https://www.xiaohongshu.com/user/profile/..."
              disabled={busy}
            />
          </Field>
          <Field label="最多条数（0 = 全部）">
            <Input
              type="number"
              min={0}
              value={maxNotes}
              onChange={(e) => setMaxNotes(Number(e.target.value || 0))}
              disabled={busy}
            />
          </Field>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button
              loading={busy}
              disabled={busy || !profileUrl.trim()}
              onClick={async () => {
                const res = await runTask("xhs.fetch_profile", {
                  profileUrl: profileUrl.trim(),
                  maxNotes,
                });
                const path = res.result?.csvPath as string | undefined;
                if (path) {
                  setLastOut(path);
                  setCsvPath(path);
                }
              }}
            >
              开始采集
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          step="03"
          title="媒体下载"
          hint="读取采集 CSV，解析笔记并下载封面/图集/视频，汇总为 xlsx。"
          className="lg:col-span-2"
        >
          <Field label="主页 CSV">
            <div className="flex gap-2">
              <Input
                className="flex-1"
                value={csvPath}
                onChange={(e) => setCsvPath(e.target.value)}
                placeholder="选择 xhs_profile_notes_*.csv"
                disabled={busy}
              />
              <Button type="button" variant="secondary" disabled={busy} onClick={pickCsv}>
                选择
              </Button>
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <Field label="篇数上限">
              <Input
                type="number"
                min={1}
                max={20}
                value={mediaMax}
                onChange={(e) => setMediaMax(Number(e.target.value || 20))}
                disabled={busy}
              />
            </Field>
          </div>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button
              loading={busy}
              disabled={busy || !csvPath.trim()}
              onClick={async () => {
                const res = await runTask("xhs.fetch_media", {
                  csvPath: csvPath.trim(),
                  noteType,
                  maxNotes: mediaMax,
                });
                const path =
                  (res.result?.xlsxPath as string) || (res.result?.outRoot as string);
                if (path) setLastOut(path);
              }}
            >
              开始下载
            </Button>
            {lastOut ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => openOut()}>
                打开输出
              </Button>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard step="04" title="发布图文" hint="选择图片目录，填写标题与正文后提交创作者中心。">
          <Field label="图片目录">
            <div className="flex gap-2">
              <Input
                className="flex-1"
                value={imageDir}
                onChange={(e) => setImageDir(e.target.value)}
                disabled={busy}
              />
              <Button type="button" variant="secondary" disabled={busy} onClick={pickImageDir}>
                选择
              </Button>
            </div>
          </Field>
          <Field label="标题">
            <Input
              value={noteTitle}
              maxLength={20}
              onChange={(e) => setNoteTitle(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="正文">
            <Textarea
              value={noteContent}
              rows={3}
              onChange={(e) => setNoteContent(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="话题">
            <Input
              value={noteTags}
              placeholder="#话题A #话题B"
              onChange={(e) => setNoteTags(e.target.value)}
              disabled={busy}
            />
          </Field>
          <CheckRow checked={noteSchedule} onChange={setNoteSchedule} disabled={busy}>
            定时发布
          </CheckRow>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button
              loading={busy}
              disabled={busy || !imageDir.trim() || !noteTitle.trim()}
              onClick={() =>
                runTask("xhs.publish_note", {
                  imageDir: imageDir.trim(),
                  title: noteTitle.trim(),
                  content: noteContent,
                  tags: noteTags.trim(),
                  schedule: noteSchedule,
                })
              }
            >
              发布图文
            </Button>
          </div>
        </SectionCard>

        <SectionCard step="05" title="发布视频" hint="选择视频文件，填写标题与正文后提交创作者中心。">
          <Field label="视频文件">
            <div className="flex gap-2">
              <Input
                className="flex-1"
                value={videoPath}
                onChange={(e) => setVideoPath(e.target.value)}
                disabled={busy}
              />
              <Button type="button" variant="secondary" disabled={busy} onClick={pickVideo}>
                选择
              </Button>
            </div>
          </Field>
          <Field label="标题">
            <Input
              value={videoTitle}
              maxLength={20}
              onChange={(e) => setVideoTitle(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="正文">
            <Textarea
              value={videoContent}
              rows={3}
              onChange={(e) => setVideoContent(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="话题">
            <Input
              value={videoTags}
              onChange={(e) => setVideoTags(e.target.value)}
              disabled={busy}
            />
          </Field>
          <CheckRow checked={videoSchedule} onChange={setVideoSchedule} disabled={busy}>
            定时发布
          </CheckRow>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button
              loading={busy}
              disabled={busy || !videoPath.trim() || !videoTitle.trim()}
              onClick={() =>
                runTask("xhs.publish_video", {
                  videoPath: videoPath.trim(),
                  title: videoTitle.trim(),
                  content: videoContent,
                  tags: videoTags.trim(),
                  schedule: videoSchedule,
                })
              }
            >
              发布视频
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
