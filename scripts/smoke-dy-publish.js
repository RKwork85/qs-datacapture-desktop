/* eslint-disable no-console */
const path = require("path");

const mode = process.argv[2] || "note";

async function main() {
  const onLog = (level, msg) => {
    const line = typeof msg === "string" ? msg : String(msg);
    console.log(`[${level}] ${line}`);
  };

  if (mode === "video") {
    const { publishVideo } = require("../core/dy/publish-video");
    const res = await publishVideo({
      videoPath: String.raw`C:\Users\rkwork\Videos\ComfyUI_00001_.mp4`,
      title: "测试视频标题_自动化",
      content: "这是一条抖音视频发布测试内容，请忽略。",
      tags: "测试",
      onLog,
    });
    console.log("RESULT", JSON.stringify(res));
    return;
  }

  const { publishNote } = require("../core/dy/publish-note");
  const res = await publishNote({
    imageDir: String.raw`C:\Users\rkwork\Pictures\对症喝不踩雷_4款养生茶太实用了`,
    title: "对症喝不踩雷_测试图文",
    content: "这是一条抖音图文发布测试内容，请忽略。4款养生茶参考。",
    tags: "养生茶 测试",
    onLog,
  });
  console.log("RESULT", JSON.stringify(res));
}

main().catch((err) => {
  console.error("FAIL", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
