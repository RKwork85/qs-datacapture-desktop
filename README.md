# 轻采QS数据采集工具

> 无广告，免登录，轻采数据采集，采数据，更轻松！

抖音 / 小红书 / 微博数据采集桌面端 + 本地调度中心  
基于 **React + Vite** 界面、**Playwright** 浏览器自动化，以及可选的本地 **Express 控制服**

| 项目 | 说明 |
|------|------|
| 名称 | **轻采QS** |
| 版本 | `1.0.0` |
| 运行平台 | Windows 10 / 11（64 位） |
| 应用标识 | `com.muzi_hhh.qs-datacapture` |
| 许可协议 | [PolyForm Noncommercial License 1.0.0](./LICENSE) |
| 声明 | 限于非商业性**学习与交流**；**禁止**商业使用、二次倒卖及营利性分发 |

---

## 功能概览

- ✅  **抖音** — 账号登录、作品采集、媒体下载、图文/视频发布
- ✅  **小红书** — 账号登录、笔记采集、媒体下载、图文/视频发布
- ✅  **微博** — 账号登录、热搜榜、榜单详情、榜单评论区
- ✅  **数据中心** — 数据看板、数据存储
- ✅  **调度中心** — 任务提交（链接/搜索词）、定时任务、版本更新（控制服随应用自动启动）
- ✅  **开始页** — 工作区文件、带 Cookie 打开浏览器、清除登录态

---

## 界面预览

素材目录：**[`docs/轻采desktop_showcase/`](./docs/轻采desktop_showcase/)**

| 说明 | 截图 |
|------|------|
| 工作区 | ![工作区](./docs/轻采desktop_showcase/软件首页图1.png) |
| 数据区 | ![数据区](./docs/轻采desktop_showcase/软件数据中心2.png) |
| 媒体数据 ① | ![媒体①](./docs/轻采desktop_showcase/xhs笔记图片展示1.png) |
| 媒体数据 ② | ![媒体①](./docs/轻采desktop_showcase/xhs_资讯采集.png) |
| 媒体数据 ③ | ![媒体③](./docs/轻采desktop_showcase/xhs_帅哥采集.png) |
| 媒体数据 ④ | ![媒体④](./docs/轻采desktop_showcase/xhs_美女采集.png) |
| 表格数据 ⑤ | ![表格⑤](./docs/轻采desktop_showcase/xhs_主页数据展示.png) |
| 表格数据 ⑥ | ![表格⑥](./docs/轻采desktop_showcase/dy个人主页作品数据展示3.png) |
| 表格数据 ⑦ | ![表格⑦](./docs/轻采desktop_showcase/wb热搜榜单详情数据展示2.png) |



---

## 技术栈
- **前端**：React 19、Vite 8、TypeScript、Tailwind CSS
- **控制服**：Express + JWT + WebSocket（默认 `127.0.0.1:3780`）
- **自动化**：Playwright
- **打包**：electron-builder

---

## 下载安装

Windows 安装包见 **[Releases](https://github.com/RKwork85/qs-datacapture-desktop/releases)**

---

### 数据存放与隐私说明

| 类型 | 位置 |
|------|------|
| 登录态 / Cookie | 本机 `auth/` |
| 采集结果 / 媒体 | 本机 `data/` |

```
**声明**  
本软件**不提供**、也**不依赖**对用户网络流量做中间人拦截、反向代理注入或「破译 / 脱壳」第三方网站私有接口来获取数据

```

**隐私说明**  
本软件在本地运行：登录态、Cookie 及采集数据仅保存在用户设备，**开发者不收集、不上传、不存储用户个人隐私或采集内容**

请遵守各平台服务条款与适用法律法规，在授权范围内使用采集能力；因违规使用产生的责任由使用者自行承担


## 许可协议 

本项目采用 **PolyForm Noncommercial License 1.0.0**（全文见 [`LICENSE`](./LICENSE)）

- **非商业性使用**：在遵守许可条款及 Required Notice 的前提下，可进行个人学习、自用、非商业性分享与修改
- **禁止性用途**：未经书面授权，不得用于商业性使用、二次倒卖、收费分发或任何形式的营利性利用
- **商业性使用**：须事先联系著作权人并取得**书面授权**联系：B站 `muzi_hhh` · [主页链接](https://space.bilibili.com/3494350415727030)

> 仅供学习交流，**严禁二次包装盗卖**！

---
