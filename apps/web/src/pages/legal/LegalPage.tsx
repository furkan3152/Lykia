/**
 * /legal/notice and /legal/privacy: the repository's DRAFT software notice
 * (risk disclosure, non-custodial posture, no warranty) and privacy note,
 * rendered from docs/legal so the site and the repository never drift.
 */
import { Link } from "../../app/routes/Link";
import { useRouteParam } from "../../app/routes/useRoute";
import { Markdown } from "../../features/legal/Markdown";
import { Card } from "../../mosaic";
import notice from "../../../../../docs/legal/software-notice.md?raw";
import privacy from "../../../../../docs/legal/privacy-note.md?raw";

const DOCS = {
  notice: { title: "Software notice and risk disclosure", source: notice },
  privacy: { title: "Privacy note", source: privacy },
} as const;

export default function LegalPage() {
  const param = useRouteParam("doc");
  const key = param === "privacy" ? "privacy" : "notice";
  const doc = DOCS[key];
  return (
    <div>
      <header className="m-head m-wrap">
        <span className="m-kick">{"DRAFT · NOT REVIEWED BY A LAWYER"}</span>
        <h1 className="m-title">{doc.title}</h1>
        <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 12 }}>
          <Link to="/legal/notice" className={key === "notice" ? "m-btn m-btn--sea" : "m-btn m-btn--ghost"}>{"NOTICE AND RISKS"}</Link>
          <Link to="/legal/privacy" className={key === "privacy" ? "m-btn m-btn--sea" : "m-btn m-btn--ghost"}>{"PRIVACY"}</Link>
        </div>
      </header>
      <section className="m-wrap" style={{ marginTop: 24, maxWidth: 860 }}>
        <Card title={doc.title} kicker={"DRAFT"}>
          <Markdown source={doc.source} />
        </Card>
      </section>
    </div>
  );
}
