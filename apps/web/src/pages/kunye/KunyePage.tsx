import { fenceHash, LYKO_LINES } from "@lykia/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useRouteParam } from "../../app/routes/useRoute";
import { chainFor } from "../../app/wallet/chains";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { pick, useLang } from "../../lib/i18n";
import { useLykiaStore } from "../../lib/lykiaStore";
import type { KunyeDraftResponse, KunyeRecord } from "../../lib/types";
import { KunyeTag } from "../../pixel/KunyeTag";
import { Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { LykoLoader } from "../../pixel/LykoLoader";
import { Tag } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { toast } from "../../ui/toast";

const INPUT = cx("w-full bg-paper px-2.5 py-2 font-mono text-[13px] text-ink px-frame-thin outline-none", FOCUS_RING);

function Lookup() {
  const lang = useLang();
  const environment = useEnvironment();
  const agentId = useRouteParam("agentId");
  const [input, setInput] = useState(agentId ?? "");
  const query = useQuery({
    queryKey: ["kunye", agentId, environment],
    enabled: typeof agentId === "string" && /^\d+$/u.test(agentId),
    queryFn: ({ signal }) => apiGet<KunyeRecord>(`/v1/kunye/${agentId}`, { query: { environment }, signal }),
  });
  const record = query.data;
  return (
    <section className="flex flex-col gap-4 bg-card p-5 px-frame px-drop">
      <h2 className="font-display text-2xl font-bold text-ink">{lang === "tr" ? "Bir künyeyi oku" : "Read a Künye"}</h2>
      <form
        className="flex items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d+$/u.test(input.trim())) navigate(routeHref("kunye", { agentId: input.trim() }));
        }}
      >
        <input className={INPUT} value={input} onChange={(e) => setInput(e.target.value)} placeholder={lang === "tr" ? "agent id, ör. 12" : "agent id, e.g. 12"} inputMode="numeric" aria-label="Agent id" />
        <Button type="submit" disabled={!/^\d+$/u.test(input.trim())}>
          {lang === "tr" ? "Oku" : "Read"}
        </Button>
      </form>
      {query.isLoading ? <LykoLoader label={lang === "tr" ? "Künye okunuyor" : "Reading the Künye"} /> : null}
      {query.isError ? <p className="text-[13px] text-down">{describeError(query.error)}</p> : null}
      {record ? (
        <div className="flex flex-col gap-3">
          <KunyeTag agentId={record.agentId} name={typeof (record.card as { name?: unknown } | undefined)?.name === "string" ? ((record.card as { name: string }).name) : `Agent ${record.agentId}`} fenceHash={record.fenceHash ?? null} owner={record.owner} />
          <dl className="grid grid-cols-2 gap-2 text-[13px]">
            <dt className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Sahip" : "Owner"}</dt>
            <dd className="break-all font-mono text-ink">{record.owner ?? "?"}</dd>
            <dt className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Çit hash'i" : "Fence hash"}</dt>
            <dd className="break-all font-mono text-ink">{record.fenceHash ?? (lang === "tr" ? "sabitlenmemiş" : "not pinned")}</dd>
            <dt className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "İtibar" : "Reputation"}</dt>
            <dd className="font-mono text-ink">{record.reputation ? `${record.reputation.count}${record.reputation.score ? ` · ${record.reputation.score}` : ""}` : "?"}</dd>
            <dt className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Doğrulamalar" : "Validations"}</dt>
            <dd className="font-mono text-ink">{record.validations ?? "?"}</dd>
          </dl>
          {record.uri ? <p className="break-all font-mono text-[11px] text-ink-3">{record.uri}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function Draft() {
  const lang = useLang();
  const environment = useEnvironment();
  const fence = useLykiaStore((s) => s.fence);
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [hash, setHash] = useState<string | null>(null);

  const draft = useMutation({
    mutationFn: () =>
      apiPost<KunyeDraftResponse>("/v1/kunye/draft", {
        owner: address,
        environment,
        name: name.trim(),
        description: description.trim(),
        fence,
        ...(endpoint.trim() ? { endpoints: [{ name: "MCP", endpoint: endpoint.trim() }] } : {}),
      }),
  });

  const register = useMutation({
    mutationFn: async () => {
      const tx = draft.data?.transaction;
      if (!tx) throw new Error("Draft the Künye first.");
      const target = chainFor(environment);
      if (chainId !== target.id) await switchChainAsync({ chainId: target.id });
      return sendTransactionAsync({ chainId: tx.chainId, to: tx.to, data: tx.data, value: BigInt(tx.value) });
    },
    onSuccess: (txHash) => {
      setHash(txHash);
      toast.success(lang === "tr" ? "Künye Arc'a gönderildi" : "Künye sent to Arc", { description: txHash, from: "LYKO" });
    },
  });

  return (
    <section className="flex flex-col gap-4 bg-card p-5 px-frame px-drop">
      <h2 className="font-display text-2xl font-bold text-ink">{lang === "tr" ? "Yeni künye" : "A new Künye"}</h2>
      <p className="text-[13px] text-ink-2">{lang === "tr" ? "Agent'ın kimliği ERC-8004 IdentityRegistry'ye yazılır; kartı, uyduğu Çit'in hash'ini taşır." : "The agent's identity goes into the ERC-8004 IdentityRegistry; its card carries the hash of the Fence it obeys."}</p>
      <KunyeTag agentId={null} name={name} fenceHash={fenceHash(fence)} owner={address ?? null} />
      <label className="flex flex-col gap-1">
        <span className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Ad" : "Name"}</span>
        <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Açıklama" : "Description"}</span>
        <textarea className={cx(INPUT, "min-h-[64px]")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "MCP uç noktası (isteğe bağlı)" : "MCP endpoint (optional)"}</span>
        <input className={INPUT} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://…/mcp" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Tag>
          {lang === "tr" ? "Çit" : "Fence"} · {fence.label ?? "custom"}
        </Tag>
        <Button onClick={() => draft.mutate()} disabled={!address || name.trim().length === 0 || draft.isPending}>
          {draft.isPending ? "…" : lang === "tr" ? "Taslak oluştur" : "Draft it"}
        </Button>
        <Button variant="ink" onClick={() => register.mutate()} disabled={!draft.data || register.isPending}>
          {register.isPending ? "…" : lang === "tr" ? "Arc'a kaydet" : "Register on Arc"}
        </Button>
      </div>
      {!address ? <p className="text-[12px] text-warn-ink">{lang === "tr" ? "Taslak için cüzdanını bağla; sahibi sensin." : "Connect your wallet to draft: you are the owner."}</p> : null}
      {draft.isError ? <p className="text-[13px] text-down">{describeError(draft.error)}</p> : null}
      {register.isError ? <p className="text-[13px] text-down">{describeError(register.error)}</p> : null}
      {hash ? <p className="break-all font-mono text-[12px] text-up">{hash}</p> : null}
      {draft.data ? (
        <details open className="bg-paper p-3 px-frame-thin">
          <summary className="cursor-pointer font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Kart (JSON)" : "Card (JSON)"} · {draft.data.cardDigest.slice(0, 20)}…</summary>
          <pre className="mt-2 max-h-[320px] overflow-auto font-mono text-[11px] text-ink-2">{JSON.stringify(draft.data.card, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}

export default function KunyePage() {
  const lang = useLang();
  return (
    <Page>
      <Section
        level={1}
        tag={lang === "tr" ? "Künye · ERC-8004 on Arc" : "Künye · ERC-8004 on Arc"}
        title={lang === "tr" ? "Her agent'ın bir künyesi olsun." : "Every agent wears a tag."}
        lede={pick(lang, { en: "Kangal dogs wear spiked collars against wolves. Lyko wears a Künye: an on-chain identity that says which Fence an agent obeys, with every verdict on record.", tr: "Kangal köpekleri kurtlara karşı çivili tasma takar. Lyko künye takar: bir agent'ın hangi Çit'e uyduğunu söyleyen, her kararı kayıtlı zincir üstü bir kimlik." })}
      >
        <div className="mx-auto mb-6 flex max-w-[640px] items-center justify-center gap-3">
          <Lyko mood="proud" size={72} label={null} />
          <p className="text-[14px] text-ink-2">{pick(lang, LYKO_LINES.proud)}</p>
        </div>
        <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-6 lg:grid-cols-2">
          <Draft />
          <Lookup />
        </div>
      </Section>
    </Page>
  );
}
