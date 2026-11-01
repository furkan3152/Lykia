/**
 * Lyko remembers: intent history, learned preferences, the address book and
 * recurring patterns. Everything is editable and forgettable; export is one
 * click. Endpoints still being built show "coming soon" rather than errors.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { useAsk } from "../../features/ask/store";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { useSiwe } from "../../features/session/useSiwe";
import { apiDelete, apiGet, apiPost, apiPut, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLang } from "../../lib/i18n";
import { availabilityOf } from "../../lib/optional";
import { useProfile } from "../../lib/profile";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, EmptyState, Field, Input, PageHead, Select, Skeleton, Tabs, Tag, toast } from "../../mosaic";
import { archive, ARCHIVE_H, ARCHIVE_W } from "../../mosaic/scenes";

export interface MemoryIntent { readonly id: string; readonly text: string; readonly outcome: string; readonly at: string; readonly intentId?: string | null }
export interface Preference { readonly id: string; readonly key: string; readonly value: string; readonly source?: string; readonly at?: string }
export interface Suggestion { readonly id: string; readonly sentence: string; readonly cadence?: string; readonly count?: number }
export interface Contact { readonly id: string; readonly name: string; readonly address: string; readonly confirmed: boolean; readonly learned?: boolean }
interface MemoryView { readonly preferences?: readonly Preference[]; readonly suggestions?: readonly Suggestion[]; readonly retentionDays?: number }

type Tab = "timeline" | "learned" | "contacts" | "patterns";

function Soon({ lang, what }: { lang: "en" | "tr"; what: string }) {
  return <EmptyState mood="resting" title={lang === "tr" ? "Yakında" : "Coming soon"}>{lang === "tr" ? `${what} sunucuda henüz açık değil.` : `${what} is not switched on on this server yet.`}</EmptyState>;
}

export default function MemoryPage() {
  const lang = useLang();
  const environment = useEnvironment();
  const { address } = useAccount();
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
  const memory = useQuery({ queryKey: ["memory", owner], enabled: Boolean(owner), retry: false, queryFn: ({ signal }) => apiGet<MemoryView>("/v1/memory", { query: q, signal }) });
  const intents = useQuery({ queryKey: ["memory-intents", owner], enabled: Boolean(owner), retry: false, queryFn: ({ signal }) => apiGet<{ intents: MemoryIntent[] }>("/v1/memory/intents", { query: q, signal }) });
  const contacts = useQuery({ queryKey: ["contacts", owner], enabled: Boolean(owner), retry: false, queryFn: ({ signal }) => apiGet<{ contacts: Contact[] }>("/v1/contacts", { query: q, signal }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["memory"] }).then(() => qc.invalidateQueries({ queryKey: ["contacts"] })).then(() => qc.invalidateQueries({ queryKey: ["memory-intents"] }));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok, { from: "LYKO" });
      void refresh();
    } catch (e) {
      toast.error(availabilityOf(e) === "soon" ? (lang === "tr" ? "Bu özellik yakında" : "Coming soon on this server") : describeError(e), { from: "LYKO" });
    }
  };
  const addContact = useMutation({ mutationFn: () => apiPost("/v1/contacts", { owner, name: name.trim(), address: addr.trim() }), onSuccess: () => { setName(""); setAddr(""); toast.success(lang === "tr" ? "Rehbere eklendi" : "Added to the address book", { from: "LYKO" }); void refresh(); }, onError: (e) => toast.error(describeError(e), { from: "LYKO" }) });
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
      toast.error(availabilityOf(e) === "soon" ? (lang === "tr" ? "Dışa aktarma yakında" : "Export is coming soon") : describeError(e), { from: "LYKO" });
    }
  };
  const count = (intents.data?.intents.length ?? 0) + (memory.data?.preferences?.length ?? 0);
  const soon = (e: unknown) => availabilityOf(e) === "soon";

  return (
    <div>
      <PageHead kicker={lang === "tr" ? "HAFIZA · LYKO HATIRLAR" : "MEMORY · LYKO REMEMBERS"} title={lang === "tr" ? <>Taşa <em>kazınanlar.</em></> : <>Carved <em>in stone.</em></>} sub={lang === "tr" ? "Ne istediğin, ne öğrendiği, kime gönderdiğin. Her şeyi düzenleyebilir, silebilir, dışa aktarabilirsin. Öğrenilen kişiler ilk onaylı gönderime kadar \"onaysız\" kalır." : "What you asked for, what Lyko learned, who you pay. Edit, delete or export any of it. Learned contacts stay \"unconfirmed\" until your first confirmed send."} mood="proud">
        <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 16 }}>
          <Button size="sm" tone="ghost" onClick={() => void exportAll()} disabled={!owner}>{lang === "tr" ? "JSON DIŞA AKTAR" : "EXPORT JSON"}</Button>
          <Button size="sm" tone="navy" disabled={!owner} onClick={() => { if (window.confirm(lang === "tr" ? "Lyko her şeyi unutsun mu?" : "Make Lyko forget everything?")) void run(() => apiPost("/v1/memory/forget", { owner, all: true }), lang === "tr" ? "Lyko her şeyi unuttu" : "Lyko forgot everything"); }}>{lang === "tr" ? "HEPSİNİ UNUT" : "FORGET ALL"}</Button>
          <Select aria-label="Retention" value={String(profile.retentionDays)} onChange={(e) => { setProfile({ ...profile, retentionDays: Number(e.target.value) }); if (siwe.signedIn) void apiPut("/v1/profile", { ...profile, retentionDays: Number(e.target.value) }).catch(() => undefined); }} style={{ width: 200 }}>
            {[7, 30, 90, 365, 0].map((d) => <option key={d} value={d}>{d === 0 ? (lang === "tr" ? "Hiç saklama" : "Keep nothing") : lang === "tr" ? `${d} gün sakla` : `Keep ${d} days`}</option>)}
          </Select>
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame build={(t) => archive({ memories: count, contacts: contacts.data?.contacts.length ?? 0, lit }, t)} width={ARCHIVE_W} height={ARCHIVE_H} dataKey={`${count}-${contacts.data?.contacts.length}-${lit}`} assembleKey="archive" label="A cliff of carved tablets, one per memory, and named stones for contacts" labels={[{ x: 50, y: 6, text: owner ? `${count} ${lang === "tr" ? "ANI" : "MEMORIES"} · ${contacts.data?.contacts.length ?? 0} ${lang === "tr" ? "KİŞİ" : "CONTACTS"}` : lang === "tr" ? "CÜZDAN BAĞLA" : "CONNECT A WALLET", tone: owner ? undefined : "ghost" }]} />
      </section>
      <section className="m-wrap" style={{ marginTop: 24 }}>
        <Tabs label="Memory" value={tab} onChange={setTab} tabs={[{ id: "timeline", label: lang === "tr" ? "ZAMAN ÇİZGİSİ" : "TIMELINE" }, { id: "learned", label: lang === "tr" ? "ÖĞRENİLENLER" : "LEARNED" }, { id: "contacts", label: lang === "tr" ? "REHBER" : "CONTACTS" }, { id: "patterns", label: lang === "tr" ? "ALIŞKANLIKLAR" : "PATTERNS" }]} />
        <div style={{ marginTop: 20 }}>
          {!owner ? (
            <Card title={lang === "tr" ? "Önce cüzdan" : "Wallet first"}><EmptyState mood="sleeping" title={lang === "tr" ? "Hafıza cüzdanına bağlı" : "Memory belongs to your wallet"} /></Card>
          ) : tab === "timeline" ? (
            <Card title={lang === "tr" ? "Niyet geçmişi" : "Intent history"} kicker={lang === "tr" ? "SONUÇLARIYLA" : "WITH OUTCOMES"}>
              {intents.isLoading ? <Skeleton h={160} /> : intents.isError ? (soon(intents.error) ? <Soon lang={lang} what="Intent history" /> : <p className="m-note m-note--bad">{describeError(intents.error)}</p>) : (intents.data?.intents ?? []).length === 0 ? <EmptyState title={lang === "tr" ? "Henüz bir şey yok" : "Nothing yet"} example={lang === "tr" ? "100 USDC'yi Morpho'ya yatır" : "Put half my USDC to work"} onExample={(x) => { begin(x); navigate("/app"); }} /> : (
                <div className="m-stops">
                  {(intents.data?.intents ?? []).map((m) => (
                    <div key={m.id} className="m-stop" data-status={/settled|done|ok/u.test(m.outcome) ? "settled" : /fail|deny/u.test(m.outcome) ? "failed" : undefined}>
                      <div className="flex justify-between gap-2 items-start">
                        <div><b>{m.text}</b><small>{new Date(m.at).toLocaleString()} · {m.outcome.toUpperCase()}</small></div>
                        <div className="flex gap-1">
                          <Button size="sm" tone="ghost" onClick={() => { begin(m.text); navigate("/app"); }}>{lang === "tr" ? "TEKRAR" : "AGAIN"}</Button>
                          <Button size="sm" tone="ghost" onClick={() => void run(() => apiDelete(`/v1/memory/${encodeURIComponent(m.id)}`, { query: q }), lang === "tr" ? "Unutuldu" : "Forgotten")}>✕</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : tab === "learned" ? (
            <Card title={lang === "tr" ? "Öğrenilen tercihler" : "Learned preferences"} kicker={lang === "tr" ? "DÜZENLE YA DA SİL" : "EDIT OR DELETE"}>
              {memory.isLoading ? <Skeleton h={120} /> : memory.isError ? (soon(memory.error) ? <Soon lang={lang} what="Memory" /> : <p className="m-note m-note--bad">{describeError(memory.error)}</p>) : (memory.data?.preferences ?? []).length === 0 ? <EmptyState title={lang === "tr" ? "Henüz öğrenilen yok" : "Nothing learned yet"} /> : (
                <table className="m-table"><thead><tr><th>{lang === "tr" ? "Ne" : "What"}</th><th>{lang === "tr" ? "Değer" : "Value"}</th><th>{lang === "tr" ? "Kaynak" : "Source"}</th><th /></tr></thead><tbody>
                  {(memory.data?.preferences ?? []).map((pref) => <tr key={pref.id}><td><b>{pref.key}</b></td><td className="num">{pref.value}</td><td className="m-small">{pref.source ?? "—"}</td><td className="r"><Button size="sm" tone="ghost" onClick={() => void run(() => apiDelete(`/v1/memory/${encodeURIComponent(pref.id)}`, { query: q }), lang === "tr" ? "Silindi" : "Deleted")}>✕</Button></td></tr>)}
                </tbody></table>
              )}
            </Card>
          ) : tab === "contacts" ? (
            <div className="m-grid-2 m-grid-2--l">
              <Card title={lang === "tr" ? "Rehber" : "Address book"} kicker={lang === "tr" ? "@İSİMLE GÖNDER" : "SEND BY @NAME"}>
                {contacts.isLoading ? <Skeleton h={120} /> : contacts.isError ? (soon(contacts.error) ? <Soon lang={lang} what="Contacts" /> : <p className="m-note m-note--bad">{describeError(contacts.error)}</p>) : (contacts.data?.contacts ?? []).length === 0 ? <EmptyState title={lang === "tr" ? "Rehber boş" : "No contacts yet"} /> : (
                  <table className="m-table"><thead><tr><th>Name</th><th>Address</th><th>Status</th><th /></tr></thead><tbody>
                    {(contacts.data?.contacts ?? []).map((c) => <tr key={c.id}><td><b>@{c.name}</b></td><td className="num m-small">{c.address.slice(0, 10)}…{c.address.slice(-6)}</td><td><Tag tone={c.confirmed ? "ok" : "ochre"}>{c.confirmed ? "confirmed" : c.learned ? "learned · unconfirmed" : "unconfirmed"}</Tag></td><td className="r"><Button size="sm" tone="ghost" onClick={() => void run(() => apiDelete(`/v1/contacts/${encodeURIComponent(c.id)}`, { query: q }), lang === "tr" ? "Silindi" : "Removed")}>✕</Button></td></tr>)}
                  </tbody></table>
                )}
              </Card>
              <Card title={lang === "tr" ? "Yeni kişi" : "New contact"} footer={<Button tone="sea" disabled={!name.trim() || !/^0x[0-9a-fA-F]{40}$/u.test(addr.trim()) || addContact.isPending} onClick={() => addContact.mutate()}>{lang === "tr" ? "EKLE" : "ADD"}</Button>}>
                <div style={{ display: "grid", gap: 10 }}>
                  <Field label={lang === "tr" ? "Ad" : "Name"} hint="@ayse, @supplier…"><Input value={name} onChange={(e) => setName(e.target.value.replace(/^@/u, ""))} /></Field>
                  <Field label={lang === "tr" ? "Adres" : "Address"}><Input value={addr} placeholder="0x…" onChange={(e) => setAddr(e.target.value)} /></Field>
                  <p className="m-note">{lang === "tr" ? "Elle eklenen kişiler de ilk onaylı gönderime kadar Çit'in alıcı listesine girmez." : "Even contacts you add stay off the Fence's recipient list until your first confirmed send."}</p>
                </div>
              </Card>
            </div>
          ) : (
            <Card title={lang === "tr" ? "Tekrarlayan alışkanlıklar" : "Recurring patterns"} kicker={lang === "tr" ? "TEK DOKUNUŞLA KALICI EMİR" : "ONE TAP TO A STANDING ORDER"}>
              {memory.isLoading ? <Skeleton h={120} /> : memory.isError ? (soon(memory.error) ? <Soon lang={lang} what="Patterns" /> : <p className="m-note m-note--bad">{describeError(memory.error)}</p>) : (memory.data?.suggestions ?? []).length === 0 ? <EmptyState title={lang === "tr" ? "Henüz alışkanlık yok" : "No patterns yet"}>{lang === "tr" ? "Aynı şeyi birkaç kez isteyince Lyko öneri getirir." : "Ask for the same thing a few times and Lyko will suggest a standing order."}</EmptyState> : (
                (memory.data?.suggestions ?? []).map((sg) => (
                  <div key={sg.id} className="m-row" style={{ alignItems: "center", justifyContent: "space-between" }}>
                    <div><b>“{sg.sentence}”</b><p className="m-small m-muted">{sg.cadence ?? ""}{sg.count ? ` · ${sg.count}×` : ""}</p></div>
                    <Button size="sm" onClick={() => void run(() => apiPost("/v1/standing", { owner, environment, text: sg.sentence }), lang === "tr" ? "Kalıcı emir oluşturuldu" : "Standing order created")}>{lang === "tr" ? "KALICI EMİR YAP" : "MAKE IT STANDING"}</Button>
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
