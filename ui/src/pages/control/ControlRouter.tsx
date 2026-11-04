import type { PageId } from "@/nav/tree";
import { PageStub } from "@/pages/PageStub";
import { TaskSubmitPage } from "./TaskSubmitPage";
import { ScheduleTaskPage } from "./ScheduleTaskPage";

export function ControlRouter({ page }: { page: PageId }) {
  switch (page) {
    case "control.tasks":
      return <TaskSubmitPage />;
    case "control.schedule":
      return <ScheduleTaskPage />;
    case "control.version":
    default:
      return <PageStub workspace="control" page={page} />;
  }
}
