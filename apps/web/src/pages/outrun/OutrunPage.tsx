/**
 * The old review route, /app/outrun/:id: Ask Lyko with the review modal
 * open over it, so links from the Fold, toasts and older messages keep
 * working. Closing the modal leaves the conversation at /app.
 */
import { useRouteParam } from "../../app/routes/useRoute";
import AskPage from "../ask/AskPage";

export default function OutrunPage() {
  const id = useRouteParam("id") ?? null;
  return <AskPage key={id ?? "none"} reviewId={id} />;
}
