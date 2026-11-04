import { PlatformSchedulePage } from "@/pages/schedule/PlatformSchedulePage";

/** 调度中心：分平台定时任务（布局对齐「任务提交」） */
export function ScheduleTaskPage() {
  return <PlatformSchedulePage initialPlatform="weibo" title="定时任务" />;
}
