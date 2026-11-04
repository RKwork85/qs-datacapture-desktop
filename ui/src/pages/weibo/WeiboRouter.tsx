import type { PageId } from "@/nav/tree";
import { WeiboFlowProvider } from "./WeiboFlowContext";
import { LoginPage } from "./LoginPage";
import { HotPage } from "./HotPage";
import { DetailPage } from "./DetailPage";
import { CommentsPage } from "./CommentsPage";
import { PageStub } from "@/pages/PageStub";

function WeiboPage({ page }: { page: PageId }) {
  switch (page) {
    case "weibo.login":
      return <LoginPage />;
    case "weibo.hot":
      return <HotPage />;
    case "weibo.detail":
      return <DetailPage />;
    case "weibo.comments":
      return <CommentsPage />;
    default:
      return <PageStub workspace="weibo" page={page} />;
  }
}

export function WeiboRouter({ page }: { page: PageId }) {
  return (
    <WeiboFlowProvider>
      <WeiboPage page={page} />
    </WeiboFlowProvider>
  );
}
