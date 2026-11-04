import type { PageId } from "@/nav/tree";
import { DyFlowProvider } from "./DyFlowContext";
import { LoginPage } from "./LoginPage";
import { CollectPage } from "./CollectPage";
import { MediaPage } from "./MediaPage";
import { PublishNotePage } from "./PublishNotePage";
import { PublishVideoPage } from "./PublishVideoPage";
import { PageStub } from "@/pages/PageStub";

function DyPage({ page }: { page: PageId }) {
  switch (page) {
    case "dy.login":
      return <LoginPage />;
    case "dy.collect":
      return <CollectPage />;
    case "dy.media":
      return <MediaPage />;
    case "dy.publish_note":
      return <PublishNotePage />;
    case "dy.publish_video":
      return <PublishVideoPage />;
    default:
      return <PageStub workspace="dy" page={page} />;
  }
}

export function DyRouter({ page }: { page: PageId }) {
  return (
    <DyFlowProvider>
      <DyPage page={page} />
    </DyFlowProvider>
  );
}
