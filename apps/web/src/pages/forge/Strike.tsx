/**
 * Strike: the builder's first run, as five stones. Connect and sign in,
 * take the developer role, name your city (the hammer strikes its coin),
 * shape it in the Workshop, then ask for a place in the League.
 */
import type { Project } from "@lykia/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { Coin } from "../../features/league/Coin";
import { ForgeStrike } from "../../features/league/ForgeStrike";
import { useSiwe } from "../../features/session/useSiwe";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Button, Card, Field, Input, Tag, cx, toast } from "../../mosaic";

type StepState = "done" | "now" | "later";

function Stone({ n, title, state, children }: { readonly n: number; readonly title: string; readonly state: StepState; readonly children?: React.ReactNode }) {
  return (
    <li className={cx("forge-stone", `forge-stone--${state}`)} aria-current={state === "now" ? "step" : undefined}>
      <span className="forge-stone__n" aria-hidden="true">{state === "done" ? "✓" : n}</span>
      <div className="forge-stone__body">
        <b>{title}</b>
        {children}
      </div>
    </li>
  );
}

export function Strike({ onPreview }: { readonly onPreview: (p: Project) => void }) {
  const siwe = useSiwe();
  const setSession = useSession((s) => s.set);
  const qc = useQueryClient();
  const developer = Boolean(siwe.signedIn && siwe.session?.roles.includes("developer"));
  const projects = useQuery({ queryKey: ["projects"], enabled: developer, queryFn: ({ signal }) => apiGet<{ projects: Project[] }>("/v1/projects", { signal }) });
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [struck, setStruck] = useState<Project | null>(null);
  const register = useMutation({
    mutationFn: () => apiPost("/v1/developers/register", { name: "Lykia builder" }),
    onSuccess: async () => {
      toast.success("Developer role added. Sign in once more to carry it.", { from: "LYKO" });
      setSession(null);
      await siwe.signIn();
    },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  const create = useMutation({
    mutationFn: () => apiPost<Project>("/v1/projects", { name: name.trim(), origins: origin ? [origin] : [] }),
    onSuccess: (p) => {
      setStruck(p);
      setName("");
      setOrigin("");
      void qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`${p.name} struck`, { description: p.id, from: "LYKO" });
    },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  const list = projects.data?.projects ?? [];
  const city = struck ?? list[0] ?? null;
  const listed = list.some((p) => p.league);
  const s1: StepState = siwe.signedIn ? "done" : "now";
  const s2: StepState = developer ? "done" : siwe.signedIn ? "now" : "later";
  const s3: StepState = city ? "done" : developer ? "now" : "later";
  const s4: StepState = city ? (listed ? "done" : "now") : "later";
  const s5: StepState = listed ? "done" : city ? "now" : "later";
  return (
    <div className="m-grid-2 m-grid-2--l" style={{ alignItems: "start" }}>
      <Card title="Strike a city" kicker="FIVE STONES · ABOUT FIVE MINUTES">
        <ol className="forge-stones">
          <Stone n={1} title="Connect and sign in on Arc" state={s1}>
            <p className="m-small m-muted">{"One signed message (SIWE), no transaction. Your wallet owns your cities."}</p>
            {s1 === "now" ? <Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy}>{siwe.address ? "SIGN IN" : "CONNECT A WALLET FIRST"}</Button> : <Tag tone="ok">{`SIGNED IN · ${siwe.session?.address.slice(0, 6)}…`}</Tag>}
          </Stone>
          <Stone n={2} title="Take the developer role" state={s2}>
            <p className="m-small m-muted">{"Free. Adds keys, projects, usage and webhooks to your address."}</p>
            {s2 === "now" ? <Button size="sm" tone="sea" onClick={() => register.mutate()} disabled={register.isPending}>{"BECOME A DEVELOPER"}</Button> : null}
          </Stone>
          <Stone n={3} title="Name your city" state={s3}>
            <p className="m-small m-muted">{"A city is a project: your brand, your site's origin, the modules you turn on, Fence caps that only ever tighten a user's rules, and your app fee."}</p>
            {developer ? (
              <div className="forge-form">
                <Field label="Name"><Input value={name} maxLength={64} placeholder="Acme Pay" onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Your site (optional)" hint="An exact origin. http://localhost needs no proof."><Input value={origin} placeholder="https://app.example.com" onChange={(e) => setOrigin(e.target.value.trim())} /></Field>
                <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>{create.isPending ? "STRIKING…" : "STRIKE THE COIN"}</Button>
              </div>
            ) : null}
          </Stone>
          <Stone n={4} title="Shape it in the Workshop" state={s4}>
            <p className="m-small m-muted">{"Colours, assistant name, modules and the live preview, with the code for React, HTML and hooks."}</p>
            {city ? <Button size="sm" tone="sea" onClick={() => onPreview(city)}>{`OPEN ${city.name.toUpperCase().slice(0, 18)} IN THE WORKSHOP`}</Button> : null}
          </Stone>
          <Stone n={5} title="Ask for a place in the League" state={s5}>
            <p className="m-small m-muted">{"A one-line pitch, a category and an emblem. The Lykia team reviews every community city before it is listed."}</p>
            {city ? <Button size="sm" tone="ghost" onClick={() => navigate("/forge/cities")}>{"REQUEST A LISTING"}</Button> : null}
          </Stone>
        </ol>
      </Card>
      <div className="forge-anvilbox" style={{ minWidth: 0 }}>
        <div className="m-frame m-frame--night forge-anvil__frame">
          <ForgeStrike strikeKey={struck?.id ?? "idle"} label={struck ? `The hammer struck ${struck.name}'s coin` : "The Forge's anvil, a hot blank waiting"} />
        </div>
        <div className="forge-anvilbox__coin m-floor">
          {struck ? <Coin key={struck.id} state="live" emblem="triskeles" codename={null} name={struck.name} size={112} delay={600} /> : <Coin state="coming" emblem="triskeles" codename={null} name="Your city" size={112} />}
          {struck ? null : <p className="m-small m-muted m-center" style={{ maxWidth: 360 }}>{"A blank, waiting. Name a city and the hammer strikes it in gold: the League's shared face on one side, your emblem on the other."}</p>}
          {struck ? <p className="m-small m-center"><b>{struck.name}</b>{" · "}<span className="num">{struck.id}</span></p> : null}
        </div>
      </div>
    </div>
  );
}
