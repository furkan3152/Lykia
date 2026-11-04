/** A project's place in the League: its status, or the form that asks for a community listing. */
import { LEAGUE_CATEGORIES, LEAGUE_EMBLEMS, leagueSlug, type LeagueCategory, type LeagueEmblem, type Project } from "@lykia/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Link } from "../../app/routes/Link";
import { Coin } from "../../features/league/Coin";
import { CATEGORY_LABEL, STATE_LABEL } from "../../features/league/model";
import { apiPost, describeError } from "../../lib/api";
import { Button, Card, Field, Input, Select, Tag, toast } from "../../mosaic";

const REVIEW: Record<string, string> = { requested: "WAITING FOR THE COUNCIL", approved: "LISTED", rejected: "NOT APPROVED", delisted: "DELISTED" };

export function LeagueListing({ project }: { readonly project: Project }) {
  const qc = useQueryClient();
  const league = project.league;
  const [tagline, setTagline] = useState(league?.tagline ?? "");
  const [category, setCategory] = useState<LeagueCategory>(league?.category ?? "tools");
  const [emblem, setEmblem] = useState<LeagueEmblem>(league?.emblem ?? "triskeles");
  const [slug, setSlug] = useState(league?.slug ?? leagueSlug(project.name));
  const request = useMutation({
    mutationFn: () => apiPost(`/v1/projects/${project.id}/league/request`, { tagline: tagline.trim(), category, emblem, slug }),
    onSuccess: () => {
      toast.success("Listing requested", { description: "The Lykia team reviews it in Letoon.", from: "LYKO" });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  const canAsk = !league || (league.status === "community" && (league.review === "rejected" || league.review === "delisted"));
  return (
    <Card title="The League" kicker={league ? `${league.status.toUpperCase()} · ${REVIEW[league.review] ?? league.review.toUpperCase()}` : "NOT LISTED"}>
      <div className="mint-listing">
        <Coin state={league?.state ?? "coming"} emblem={emblem} codename={league?.codename ?? null} name={project.name} size={88} interactive={false} />
        <div style={{ minWidth: 0 }}>
          {league ? (
            <>
              <p className="m-small"><b>{league.tagline}</b></p>
              <p className="m-small m-muted">{`${CATEGORY_LABEL[league.category]} · ${STATE_LABEL[league.state].toLowerCase()} · /league/${league.slug}`}</p>
              {league.listed ? <Link to={`/league/${league.slug}`} className="m-btn m-btn--sm m-btn--ghost" style={{ marginTop: 8 }}>{"OPEN THE CITY"}</Link> : <Tag tone="ochre" style={{ marginTop: 8 }}>{REVIEW[league.review] ?? league.review}</Tag>}
            </>
          ) : (
            <p className="m-small m-muted">{"List this city in the League: a coin on /league and its own city page. Every community city is reviewed by the Lykia team first."}</p>
          )}
        </div>
      </div>
      {canAsk ? (
        <div className="mint-form" style={{ marginTop: 12 }}>
          <Field label="One line" hint="8 to 90 characters: what the city does."><Input value={tagline} maxLength={90} onChange={(e) => setTagline(e.target.value)} placeholder="Invoices that pay themselves" /></Field>
          <div className="m-grid-2" style={{ gap: 10 }}>
            <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value as LeagueCategory)}>{LEAGUE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
            <Field label="Emblem"><Select value={emblem} onChange={(e) => setEmblem(e.target.value as LeagueEmblem)}>{LEAGUE_EMBLEMS.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          </div>
          <Field label="Address" hint={`/league/${slug || "…"}`}><Input value={slug} maxLength={32} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, ""))} /></Field>
          <Button onClick={() => request.mutate()} disabled={request.isPending || tagline.trim().length < 8}>{"ASK FOR A LISTING"}</Button>
        </div>
      ) : null}
    </Card>
  );
}
