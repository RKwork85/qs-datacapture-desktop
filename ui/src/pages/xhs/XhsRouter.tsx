import type { PageId } from "@/nav/tree";
import { XhsFlowProvider } from "./XhsFlowContext";
import { LoginPage } from "./LoginPage";
import { CollectPage } from "./CollectPage";
import { MediaPage } from "./MediaPage";
import { PublishNotePage } from "./PublishNotePage";
import { PublishVideoPage } from "./PublishVideoPage";
import { PageStub } from "@/pages/PageStub";

function XhsPage({ page }: { page: PageId }) {
  switch (page) {
    case "xhs.login":
      return <LoginPage />;
    case "xhs.collect":
      return <CollectPage />;
    case "xhs.media":
      return <MediaPage />;
    case "xhs.publish_note":
      return <PublishNotePage />;
    case "xhs.publish_video":
      return <PublishVideoPage />;
    default:
      return <PageStub workspace="xhs" page={page} />;
  }
}

export function XhsRouter({ page }: { page: PageId }) {
  return (
    <XhsFlowProvider>
      <XhsPage page={page} />
    </XhsFlowProvider>
  );
}
