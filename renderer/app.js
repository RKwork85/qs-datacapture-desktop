const logView = document.getElementById("logView");
const busyBadge = document.getElementById("busyBadge");
const versionText = document.getElementById("versionText");
const ctrlStatus = document.getElementById("ctrlStatus");

let running = false;

function appendLog({ level, message }) {
  const line = message || "";
  logView.textContent += `${line}\n`;
  logView.scrollTop = logView.scrollHeight;
  if (level === "error") busyBadge.textContent = "出错";
}

function setBusy(v) {
  running = v;
  busyBadge.textContent = v ? "执行中" : "空闲";
  busyBadge.classList.toggle("busy", v);
  busyBadge.classList.toggle("is-busy", v);
  busyBadge.classList.toggle("is-idle", !v);
  document.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.disabled = v && btn.dataset.action !== "control.poll";
  });
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.panel}`).classList.add("active");
  });
});

document.getElementById("clearLog").addEventListener("click", () => {
  logView.textContent = "";
});

document.querySelectorAll("[data-pick]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const kind = btn.dataset.pick;
    if (kind === "xhsCsv") {
      const p = await window.qsApi.selectFile([
        { name: "CSV", extensions: ["csv"] },
      ]);
      if (p) document.getElementById("xhsCsvPath").value = p;
    } else if (kind === "xhsImageDir") {
      const p = await window.qsApi.selectDir();
      if (p) document.getElementById("xhsImageDir").value = p;
    } else if (kind === "xhsVideo") {
      const p = await window.qsApi.selectFile([
        { name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "m4v"] },
      ]);
      if (p) document.getElementById("xhsVideoPath").value = p;
    }
  });
});

async function run(type, params) {
  if (running) {
    appendLog({ level: "warn", message: "已有任务在执行" });
    return;
  }
  setBusy(true);
  appendLog({ level: "info", message: `>>> 开始任务 ${type}` });
  try {
    const res = await window.qsApi.runTask(type, params);
    if (res.ok) {
      appendLog({
        level: "info",
        message: `<<< 完成 ${type}: ${JSON.stringify(res.result || {}, null, 0).slice(0, 500)}`,
      });
      const pathHint =
        res.result?.csvPath ||
        res.result?.xlsxPath ||
        res.result?.outRoot ||
        res.result?.cookiePath ||
        res.result?.authPath;
      if (pathHint) {
        appendLog({ level: "info", message: `输出: ${pathHint}` });
      }
    } else {
      appendLog({ level: "error", message: `<<< 失败 ${type}: ${res.error}` });
    }
  } catch (e) {
    appendLog({ level: "error", message: String(e.message || e) });
  } finally {
    setBusy(false);
  }
}

document.querySelectorAll("button[data-action]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.action;
    if (action === "xhs.login") return run("xhs.login", {});
    if (action === "xhs.fetch_profile") {
      return run("xhs.fetch_profile", {
        profileUrl: document.getElementById("xhsProfileUrl").value.trim(),
        maxNotes: Number(document.getElementById("xhsMaxNotes").value || 0),
      });
    }
    if (action === "xhs.fetch_media") {
      return run("xhs.fetch_media", {
        csvPath: document.getElementById("xhsCsvPath").value.trim(),
        noteType: document.getElementById("xhsNoteType").value,
        maxNotes: Number(document.getElementById("xhsMediaMax").value || 20),
      });
    }
    if (action === "xhs.publish_note") {
      return run("xhs.publish_note", {
        imageDir: document.getElementById("xhsImageDir").value.trim(),
        title: document.getElementById("xhsNoteTitle").value.trim(),
        content: document.getElementById("xhsNoteContent").value,
        tags: document.getElementById("xhsNoteTags").value.trim(),
        schedule: document.getElementById("xhsNoteSchedule").checked,
      });
    }
    if (action === "xhs.publish_video") {
      return run("xhs.publish_video", {
        videoPath: document.getElementById("xhsVideoPath").value.trim(),
        title: document.getElementById("xhsVideoTitle").value.trim(),
        content: document.getElementById("xhsVideoContent").value,
        tags: document.getElementById("xhsVideoTags").value.trim(),
        schedule: document.getElementById("xhsVideoSchedule").checked,
      });
    }
    if (action === "weibo.login") {
      return run("weibo.login", {
        force: document.getElementById("weiboForceLogin").checked,
      });
    }
    if (action === "weibo.hot") {
      return run("weibo.hot", {
        limit: Number(document.getElementById("weiboHotLimit").value || 50),
      });
    }
    if (action === "weibo.daily") {
      return run("weibo.daily", {
        hotLimit: Number(document.getElementById("weiboDailyHotLimit").value || 10),
        maxTopics: Number(document.getElementById("weiboMaxTopics").value || 0),
        commentPosts: Number(document.getElementById("weiboCommentPosts").value || 3),
        commentTop: Number(document.getElementById("weiboCommentTop").value || 100),
        workers: Number(document.getElementById("weiboWorkers").value || 2),
        skipCommentZone: document.getElementById("weiboSkipComment").checked,
      });
    }
    if (action === "control.login") {
      const username = document.getElementById("ctrlUser").value.trim();
      const password = document.getElementById("ctrlPass").value;
      const res = await window.qsApi.controlLogin({ username, password });
      if (res.ok) {
        ctrlStatus.textContent = `已登录：${res.username}`;
        appendLog({ level: "info", message: "控制服登录成功，已尝试连接 WebSocket" });
      } else {
        ctrlStatus.textContent = `登录失败：${res.error || "unknown"}`;
        appendLog({ level: "error", message: `控制服登录失败：${res.error}` });
      }
      return;
    }
    if (action === "control.connectWs") {
      const res = await window.qsApi.controlConnectWs();
      appendLog({
        level: "info",
        message: res.ok ? "WebSocket 重连已发起" : `WS 失败：${res.error}`,
      });
      return;
    }
    if (action === "control.poll") {
      await window.qsApi.controlPoll();
      appendLog({ level: "info", message: "已触发控制服任务拉取" });
      return;
    }
    if (action === "control.createTask") {
      let params = {};
      try {
        params = JSON.parse(document.getElementById("ctrlTaskParams").value || "{}");
      } catch (e) {
        appendLog({ level: "error", message: `params JSON 无效: ${e.message}` });
        return;
      }
      const type = document.getElementById("ctrlTaskType").value;
      const res = await window.qsApi.controlCreateTask({ type, params });
      if (res.ok) {
        appendLog({
          level: "info",
          message: `已创建任务 ${res.task.id} (${res.task.type})，桌面将自动领取`,
        });
      } else {
        appendLog({ level: "error", message: `创建任务失败：${res.error}` });
      }
    }
  });
});

window.qsApi.onLog(appendLog);
window.qsApi.onControlEvent((payload) => {
  if (payload.type === "ws") {
    appendLog({
      level: "info",
      message: `[WS] ${payload.status}${payload.error ? " " + payload.error : ""}`,
    });
  }
  if (payload.type === "poll" && payload.data?.version) {
    versionText.textContent = `本地 v${payload.data.version.version || "?"} / 服务端最新 ${
      payload.data.version.version || "?"
    }`;
  }
});

window.qsApi.getConfig().then((cfg) => {
  versionText.textContent = `v${cfg.version || "0.1.0"}`;
});
