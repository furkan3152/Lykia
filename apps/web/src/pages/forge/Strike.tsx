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
import { t } from "../../i18n";

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
      toast.success(t("forge.strike.developerRoleAddedSignInOnce"), { from: "LYKO" });
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
      <Card title={t("forge.strike.strikeACity")} kicker={t("forge.strike.fiveStonesAboutFiveMinutes")}>
        <ol className="forge-stones">
          <Stone n={1} title={t("forge.strike.connectAndSignInOnArc")} state={s1}>
            <p className="m-small m-muted">{t("forge.strike.oneSignedMessageSiweNoTransaction")}</p>
            {s1 === "now" ? <Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy}>{siwe.address ? t("forge.strike.signIn") : t("forge.strike.connectAWalletFirst")}</Button> : <Tag tone="ok">{t("forge.strike.signedIn", { value: siwe.session?.address.slice(0, 6) })}</Tag>}
          </Stone>
          <Stone n={2} title={t("forge.strike.takeTheDeveloperRole")} state={s2}>
            <p className="m-small m-muted">{t("forge.strike.freeAddsKeysProjectsUsageAnd")}</p>
            {s2 === "now" ? <Button size="sm" tone="sea" onClick={() => register.mutate()} disabled={register.isPending}>{t("forge.strike.becomeADeveloper")}</Button> : null}
          </Stone>
          <Stone n={3} title={t("forge.strike.nameYourCity")} state={s3}>
            <p className="m-small m-muted">{t("forge.strike.aCityIsAProjectYour")}</p>
            {developer ? (
              <div className="forge-form">
                <Field label={t("forge.strike.name")}><Input value={name} maxLength={64} placeholder={t("forge.strike.acmePay")} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label={t("forge.strike.yourSiteOptional")} hint={t("forge.strike.anExactOriginHttpLocalhostNeeds")}><Input value={origin} placeholder="https://app.example.com" onChange={(e) => setOrigin(e.target.value.trim())} /></Field>
                <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>{create.isPending ? "STRIKING…" : t("forge.strike.strikeTheCoin")}</Button>
              </div>
            ) : null}
          </Stone>
          <Stone n={4} title={t("forge.strike.shapeItInTheWorkshop")} state={s4}>
            <p className="m-small m-muted">{t("forge.strike.coloursAssistantNameModulesAndThe")}</p>
            {city ? <Button size="sm" tone="sea" onClick={() => onPreview(city)}>{t("forge.strike.openInTheWorkshop", { value: city.name.toUpperCase().slice(0, 18) })}</Button> : null}
          </Stone>
          <Stone n={5} title={t("forge.strike.askForAPlaceInThe")} state={s5}>
            <p className="m-small m-muted">{t("forge.strike.aOneLinePitchACategory")}</p>
            {city ? <Button size="sm" tone="ghost" onClick={() => navigate("/forge/cities")}>{t("forge.strike.requestAListing")}</Button> : null}
          </Stone>
        </ol>
      </Card>
      <div className="forge-anvilbox" style={{ minWidth: 0 }}>
        <div className="m-frame m-frame--night forge-anvil__frame">
          <ForgeStrike strikeKey={struck?.id ?? "idle"} label={struck ? t("forge.strike.theHammerStruckSCoin", { name: struck.name }) : t("forge.strike.theForgeSAnvilAHot")} />
        </div>
        <div className="forge-anvilbox__coin m-floor">
          {struck ? <Coin key={struck.id} state="live" emblem="triskeles" codename={null} name={struck.name} size={112} delay={600} /> : <Coin state="coming" emblem="triskeles" codename={null} name={t("forge.strike.yourCity")} size={112} />}
          {struck ? null : <p className="m-small m-muted m-center" style={{ maxWidth: 360 }}>{t("forge.strike.aBlankWaitingNameACity")}</p>}
          {struck ? <p className="m-small m-center"><b>{struck.name}</b>{" · "}<span className="num">{struck.id}</span></p> : null}
        </div>
      </div>
    </div>
  );
}
