import { AppShell } from "@/components/shell/AppShell";
import { PageStub } from "@/pages/PageStub";
import { DyRouter } from "@/pages/dy/DyRouter";
import { XhsRouter } from "@/pages/xhs/XhsRouter";
import { WeiboRouter } from "@/pages/weibo/WeiboRouter";
import { DataRouter } from "@/pages/data/DataRouter";
import { ControlRouter } from "@/pages/control/ControlRouter";

export default function App() {
  return (
    <AppShell annotate={false}>
      {({ workspace, page }) => {
        if (workspace === "dy") return <DyRouter page={page} />;
        if (workspace === "xhs") return <XhsRouter page={page} />;
        if (workspace === "weibo") return <WeiboRouter page={page} />;
        if (workspace === "data") return <DataRouter page={page} />;
        if (workspace === "control") return <ControlRouter page={page} />;
        return <PageStub workspace={workspace} page={page} />;
      }}
    </AppShell>
  );
}
