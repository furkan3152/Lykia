/**
 * Lyko remembers: intent history, learned preferences, the address book and
 * recurring patterns. Everything is editable and forgettable; export is one
 * click. Endpoints still being built show "coming soon" rather than errors.
 */
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { useAsk } from "../../features/ask/store";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { useSiwe } from "../../features/session/useSiwe";
import { apiDelete, apiGet, apiPost, apiPut, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { availabilityOf } from "../../lib/optional";
import { useProfile } from "../../lib/profile";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, EmptyState, Field, Input, PageHead, Select, Skeleton, Tabs, Tag, toast } from "../../mosaic";
import { archive, ARCHIVE_H, ARCHIVE_W } from "../../mosaic/scenes";
import { intlLocale, t as msg } from "../../i18n";

export interface MemoryIntent { readonly id: string; readonly text: string; readonly outcome: string; readonly at: string; readonly intentId?: string | null }
export interface Preference { readonly id: string; readonly key: string; readonly value: string; readonly source?: string; readonly at?: string }
export interface Suggestion { readonly id: string; readonly sentence: string; readonly cadence?: string; readonly count?: number }
export interface Contact { readonly id: string; readonly name: string; readonly address: string; readonly confirmed: boolean; readonly learned?: boolean }
interface MemoryView { readonly preferences?: readonly Preference[]; readonly suggestions?: readonly Suggestion[]; readonly retentionDays?: number }

type Tab = "timeline" | "learned" | "contacts" | "patterns";

function Soon({ what }: { what: string }) {
  return <EmptyState mood="resting" title={msg("memory.comingSoon")}>{msg("memory.isNotSwitchedOnOnThis", { what })}</EmptyState>;
}

export default function MemoryPage() {
  const environment = useEnvironment();
  const { address } = useLykiaWallet();
  const siwe = useSiwe();
  const lit = useLamp();
  const qc = useQueryClient();
  const begin = useAsk((s) => s.begin);
  const profile = useProfile((s) => s.profile);
  const setProfile = useProfile((s) => s.set);
  const [tab, setTab] = useState<Tab>("timeline");
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const owner = address ?? null;
  const q = { owner, environment };
  // Memory, intents and contacts are the signed-in owner's own: without a session the API answers 401.
  const memory = useQuery({ queryKey: ["memory", owner], enabled: Boolean(owner) && siwe.signedIn, retry: false, queryFn: ({ signal }) => apiGet<MemoryView>("/v1/memory", { query: q, signal }) });
  const intents = useQuery({ queryKey: ["memory-intents", owner], enabled: Boolean(owner) && siwe.signedIn, retry: false, queryFn: ({ signal }) => apiGet<{ intents: MemoryIntent[] }>("/v1/memory/intents", { query: q, signal }) });
  const contacts = useQuery({ queryKey: ["contacts", owner], enabled: Boolean(owner) && siwe.signedIn, retry: false, queryFn: ({ signal }) => apiGet<{ contacts: Contact[] }>("/v1/contacts", { query: q, signal }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["memory"] }).then(() => qc.invalidateQueries({ queryKey: ["contacts"] })).then(() => qc.invalidateQueries({ queryKey: ["memory-intents"] }));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok, { from: "LYKO" });
      void refresh();
    } catch (e) {
      toast.error(availabilityOf(e) === "soon" ? (msg("memory.comingSoonOnThisServer")) : describeError(e), { from: "LYKO" });
    }
  };
  const addContact = useMutation({ mutationFn: () => apiPost("/v1/contacts", { owner, name: name.trim(), address: addr.trim() }), onSuccess: () => { setName(""); setAddr(""); toast.success(msg("memory.addedToTheAddressBook"), { from: "LYKO" }); void refresh(); }, onError: (e) => toast.error(describeError(e), { from: "LYKO" }) });
  const exportAll = async () => {
    try {
      const data = await apiGet<unknown>("/v1/memory/export", { query: q });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `lykia-memory-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(availabilityOf(e) === "soon" ? (msg("memory.exportIsComingSoon")) : describeError(e), { from: "LYKO" });
    }
  };
  const count = (intents.data?.intents.length ?? 0) + (memory.data?.preferences?.length ?? 0);
  const soon = (e: unknown) => availabilityOf(e) === "soon";

  return (
    <div>
      <PageHead kicker={msg("memory.settingsMemory")} title={<>{msg("memory.whatLykia")} <em>{msg("memory.remembers")}</em></>} sub={msg("memory.whatYouAskedForWhatLyko")} mood="proud">
        <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 16 }}>
          <Button size="sm" tone="ghost" onClick={() => void exportAll()} disabled={!owner}>{msg("memory.exportJson")}</Button>
          <Button size="sm" tone="navy" disabled={!owner} onClick={() => { if (window.confirm(msg("memory.makeLykoForgetEverything"))) void run(() => apiPost("/v1/memory/forget", { owner, all: true }), msg("memory.lykoForgotEverything")); }}>{msg("memory.forgetAll")}</Button>
          <Select aria-label={msg("memory.retention")} value={String(profile.retentionDays)} onChange={(e) => { setProfile({ ...profile, retentionDays: Number(e.target.value) }); if (siwe.signedIn) void apiPut("/v1/profile", { ...profile, retentionDays: Number(e.target.value) }).catch(() => undefined); }} style={{ width: 200 }}>
            {[7, 30, 90, 365, 0].map((d) => <option key={d} value={d}>{d === 0 ? (msg("memory.keepNothing")) : msg("memory.keepDays", { d })}</option>)}
          </Select>
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame build={(t) => archive({ memories: count, contacts: contacts.data?.contacts.length ?? 0, lit }, t)} width={ARCHIVE_W} height={ARCHIVE_H} dataKey={`${count}-${contacts.data?.contacts.length}-${lit}`} assembleKey="archive" label={msg("memory.aCliffOfCarvedTabletsOne")} labels={[{ x: 50, y: 6, text: owner ? `${count} ${"MEMORIES"} · ${contacts.data?.contacts.length ?? 0} ${"CONTACTS"}` : msg("memory.connectAWallet"), tone: owner ? undefined : "ghost" }]} />
      </section>
      <section className="m-wrap" style={{ marginTop: 24 }}>
        <Tabs label={msg("memory.memory")} value={tab} onChange={setTab} tabs={[{ id: "timeline", label: "TIMELINE" }, { id: "learned", label: "LEARNED" }, { id: "contacts", label: "CONTACTS" }, { id: "patterns", label: "PATTERNS" }]} />
        <div style={{ marginTop: 20 }}>
          {!owner ? (
            <Card title={msg("memory.walletFirst")}><EmptyState mood="sleeping" title={msg("memory.memoryBelongsToYourWallet")} /></Card>
          ) : !siwe.signedIn ? (
            <Card title={msg("memory.signInFirst")}>
              <EmptyState mood="sleeping" title={msg("memory.signInToReadWhatLyko")} />
              <div className="m-center"><Button onClick={() => void siwe.signIn()} disabled={siwe.busy}>{msg("memory.signIn")}</Button></div>
            </Card>
          ) : tab === "timeline" ? (
            <Card title={msg("memory.intentHistory")} kicker={msg("memory.withOutcomes")}>
              {intents.isLoading ? <Skeleton h={160} /> : intents.isError ? (soon(intents.error) ? <Soon what={msg("memory.intentHistory")} /> : <p className="m-note m-note--bad">{describeError(intents.error)}</p>) : (intents.data?.intents ?? []).length === 0 ? <EmptyState title={msg("memory.nothingYet")} example={msg("memory.putHalfMyUsdcToWork")} onExample={(x) => { begin(x); navigate("/app"); }} /> : (
                <div className="m-stops">
                  {(intents.data?.intents ?? []).map((m) => (
                    <div key={m.id} className="m-stop" data-status={/settled|done|ok/u.test(m.outcome) ? "settled" : /fail|deny/u.test(m.outcome) ? "failed" : undefined}>
                      <div className="flex justify-between gap-2 items-start">
                        <div><b>{m.text}</b><small>{new Date(m.at).toLocaleString(intlLocale())} · {m.outcome.toUpperCase()}</small></div>
                        <div className="flex gap-1">
                          <Button size="sm" tone="ghost" onClick={() => { begin(m.text); navigate("/app"); }}>{msg("memory.again")}</Button>
                          <Button size="sm" tone="ghost" onClick={() => void run(() => apiDelete(`/v1/memory/${encodeURIComponent(m.id)}`, { query: q }), msg("memory.forgotten"))}>✕</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : tab === "learned" ? (
            <Card title={msg("memory.learnedPreferences")} kicker={msg("memory.editOrDelete")}>
              {memory.isLoading ? <Skeleton h={120} /> : memory.isError ? (soon(memory.error) ? <Soon what={msg("memory.memory")} /> : <p className="m-note m-note--bad">{describeError(memory.error)}</p>) : (memory.data?.preferences ?? []).length === 0 ? <EmptyState title={msg("memory.nothingLearnedYet")} /> : (
                <table className="m-table"><thead><tr><th>{msg("memory.what")}</th><th>{msg("memory.value")}</th><th>{msg("memory.source")}</th><th /></tr></thead><tbody>
                  {(memory.data?.preferences ?? []).map((pref) => <tr key={pref.id}><td><b>{pref.key}</b></td><td className="num">{pref.value}</td><td className="m-small">{pref.source ?? "—"}</td><td className="r"><Button size="sm" tone="ghost" onClick={() => void run(() => apiDelete(`/v1/memory/${encodeURIComponent(pref.id)}`, { query: q }), msg("memory.deleted"))}>✕</Button></td></tr>)}
                </tbody></table>
              )}
            </Card>
          ) : tab === "contacts" ? (
            <div className="m-grid-2 m-grid-2--l">
              <Card title={msg("memory.addressBook")} kicker={msg("memory.sendByName")}>
                {contacts.isLoading ? <Skeleton h={120} /> : contacts.isError ? (soon(contacts.error) ? <Soon what={msg("memory.contacts")} /> : <p className="m-note m-note--bad">{describeError(contacts.error)}</p>) : (contacts.data?.contacts ?? []).length === 0 ? <EmptyState title={msg("memory.noContactsYet")} /> : (
                  <table className="m-table"><thead><tr><th>{msg("memory.name")}</th><th>{msg("memory.address")}</th><th>{msg("memory.status")}</th><th /></tr></thead><tbody>
                    {(contacts.data?.contacts ?? []).map((c) => <tr key={c.id}><td><b>@{c.name}</b></td><td className="num m-small">{c.address.slice(0, 10)}…{c.address.slice(-6)}</td><td><Tag tone={c.confirmed ? "ok" : "ochre"}>{c.confirmed ? "confirmed" : c.learned ? msg("memory.learnedUnconfirmed") : "unconfirmed"}</Tag></td><td className="r"><Button size="sm" tone="ghost" onClick={() => void run(() => apiDelete(`/v1/contacts/${encodeURIComponent(c.id)}`, { query: q }), msg("memory.removed"))}>✕</Button></td></tr>)}
                  </tbody></table>
                )}
              </Card>
              <Card title={msg("memory.newContact")} footer={<Button tone="sea" disabled={!name.trim() || !/^0x[0-9a-fA-F]{40}$/u.test(addr.trim()) || addContact.isPending} onClick={() => addContact.mutate()}>{msg("memory.add")}</Button>}>
                <div style={{ display: "grid", gap: 10 }}>
                  <Field label={msg("memory.name")} hint="@ayse, @supplier…"><Input value={name} onChange={(e) => setName(e.target.value.replace(/^@/u, ""))} /></Field>
                  <Field label={msg("memory.address")}><Input value={addr} placeholder="0x…" onChange={(e) => setAddr(e.target.value)} /></Field>
                  <p className="m-note">{msg("memory.evenContactsYouAddStayOff")}</p>
                </div>
              </Card>
            </div>
          ) : (
            <Card title={msg("memory.recurringPatterns")} kicker={msg("memory.oneTapToAStandingOrder")}>
              {memory.isLoading ? <Skeleton h={120} /> : memory.isError ? (soon(memory.error) ? <Soon what={msg("memory.patterns")} /> : <p className="m-note m-note--bad">{describeError(memory.error)}</p>) : (memory.data?.suggestions ?? []).length === 0 ? <EmptyState title={msg("memory.noPatternsYet")}>{msg("memory.askForTheSameThingA")}</EmptyState> : (
                (memory.data?.suggestions ?? []).map((sg) => (
                  <div key={sg.id} className="m-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                    <div><b>“{sg.sentence}”</b><p className="m-small m-muted">{sg.cadence ?? ""}{sg.count ? ` · ${sg.count}×` : ""}</p></div>
                    <Button size="sm" onClick={() => void run(() => apiPost("/v1/standing", { owner, environment, text: sg.sentence }), msg("memory.standingOrderCreated"))}>{msg("memory.makeItStanding")}</Button>
                  </div>
                ))
              )}
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
