// i18n-ignore-file: design kit for reviewing states during development; its fixtures stand in for API answers.
/** The Mosaic kit: every component and scene on one page. */
import { useState } from "react";

import { SceneFrame } from "../../features/scenes/SceneFrame";
import { usePulse } from "../../lib/pulseStore";
import { Button, Card, EmptyState, Field, Input, LykoFace, MeanderBand, Medallion, Modal, PageHead, PupIcon, Seal, Select, Skeleton, Sprite, Stat, Tabs, Tag, Toggle, toast } from "../../mosaic";
import * as S from "../../mosaic/scenes";
import { ALL_SPRITES, COLLARS, type FaceMood } from "../../mosaic/sprites";

const MOODS: FaceMood[] = ["watching", "happy", "alert", "growling", "proud", "resting", "sleeping", "herding"];

export default function KitPage() {
  const lit = usePulse((s) => s.lit);
  const [tab, setTab] = useState("a");
  const [mode, setMode] = useState<"x" | "y">("x");
  const [open, setOpen] = useState(false);
  const scenes = [
    { name: "bay", w: S.BAY_W, h: S.BAY_H, b: (t: number) => S.bay({ pens: [{ label: "A", apy: 5.8 }, { label: "B", apy: 6.1 }, { label: "C", apy: 4.3 }], flock: ["USDC", "EURC", "USDC", "cirBTC", "USDC", "EURC"], wolves: 2, lit }, t) },
    { name: "bay · night", w: S.BAY_W, h: S.BAY_H, b: (t: number) => S.bay({ pens: [{ label: "A", apy: 5.8 }, { label: "B", apy: 6.1 }, { label: "C", apy: 4.3 }], flock: ["USDC", "EURC", "USDC"], wolves: 2, lit: true, night: true }, t) },
    { name: "pasture", w: S.PASTURE_W, h: S.PASTURE_H, b: (t: number) => S.pasture({ holdings: [{ symbol: "USDC", usd: 6000, where: "wallet", kind: "token" }, { symbol: "EURC", usd: 2000, where: "wallet", kind: "token" }, { symbol: "USDC", usd: 4000, where: "morpho-vaults", kind: "vault" }], gatewayUsdc: 200, lit, threats: 1 }, t) },
    { name: "pastures", w: S.PASTURES_W, h: S.PASTURES_H, b: (t: number) => S.pastures({ pens: [{ label: "a", apy: 6.1, risk: "low" }, { label: "b", apy: 5.8, risk: "low" }, { label: "c", apy: 5.4, risk: "medium" }, { label: "d", apy: 4.3, risk: "high" }], grow: 1, lit }, t) },
    { name: "kennel", w: S.KENNEL_W, h: S.KENNEL_H, b: (t: number) => S.kennel({ pups: (Object.keys(COLLARS) as string[]).slice(1, 7).map((role, i) => ({ role, status: i === 5 ? "paused" : "active", depth: 1 })), lit }, t) },
    { name: "fence", w: S.FENCE_W, h: S.FENCE_H, b: (t: number) => S.fenceScene({ caps: [{ label: "a", usd: 1000 }, { label: "b", usd: 2500 }, { label: "c", usd: 5000 }, { label: "d", usd: null }], gates: 3, whistle: false, strangers: false, lit }, t) },
    { name: "sniff", w: S.SNIFF_W, h: S.SNIFF_H, b: (t: number) => S.sniff({ level: "danger", wolves: 3, lit }, t) },
    { name: "harbor", w: S.HARBOR_W, h: S.HARBOR_H, b: (t: number) => S.harbor({ stops: 3, settled: 1, ferry: true, lit }, t) },
    { name: "arcadia", w: S.ARCADIA_W, h: S.ARCADIA_H, b: (t: number) => S.arcadia(t) },
    { name: "strip", w: S.STRIP_W, h: S.STRIP_H, b: (t: number) => S.strip({ lit, running: true }, t) },
  ];
  return (
    <div>
      <PageHead kicker="MOSAIC KIT" title={<>Every <em>stone.</em></>} sub="Components, sprites, moods and scenes of the Lykia design system." />
      <section className="m-wrap" style={{ marginTop: 28, display: "grid", gap: 24 }}>
        <Card title="Buttons, tags, seals">
          <div className="flex gap-2 flex-wrap justify-center">
            <Button>Terra</Button><Button tone="sea">Sea</Button><Button tone="navy">Navy</Button><Button tone="ochre">Ochre</Button><Button tone="ghost">Ghost</Button><Button size="sm">Small</Button><Button size="lg">Large</Button>
          </div>
          <div className="flex gap-2 flex-wrap justify-center" style={{ marginTop: 12 }}>
            <Tag>navy</Tag><Tag tone="ochre">ochre</Tag><Tag tone="ok">ok</Tag><Tag tone="bad">bad</Tag><Tag tone="sea">sea</Tag><Tag tone="ghost">ghost</Tag><Tag tone="wolf">wolf</Tag>
            <Seal decision="allow" /><Seal decision="confirm" /><Seal decision="deny" />
          </div>
        </Card>
        <div className="m-grid-3">
          <Card title="Fields"><div style={{ display: "grid", gap: 10 }}><Field label="Input" hint="hint"><Input placeholder="0x…" /></Field><Field label="Select"><Select><option>one</option></Select></Field><Toggle label="t" value={mode} onChange={setMode} options={[{ value: "x", label: "X" }, { value: "y", label: "Y" }]} /><Tabs label="tabs" value={tab} onChange={setTab} tabs={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} /></div></Card>
          <Card title="Stats & skeleton"><Stat label="BLOCK" value="#28,977,633" /><Skeleton h={18} /><div style={{ height: 8 }} /><Skeleton h={60} /></Card>
          <Card title="Feedback" footer={<><Button size="sm" onClick={() => toast.success("Saved", { description: "A mosaic tile.", from: "LYKO" })}>Toast</Button><Button size="sm" tone="sea" onClick={() => setOpen(true)}>Modal</Button></>}><EmptyState title="Empty state" example="come bye" /></Card>
        </div>
        <Card title="Lyko's moods & the medallion">
          <div className="flex gap-4 flex-wrap justify-center items-end">
            <Medallion size={140} spin />
            {MOODS.map((m) => <div key={m} className="m-center"><LykoFace mood={m} scale={2.4} /><p className="m-kick">{m}</p></div>)}
          </div>
        </Card>
        <Card title="Sprites & pups">
          <div className="flex gap-4 flex-wrap justify-center items-end">
            {Object.entries(ALL_SPRITES).map(([n, rows]) => <div key={n} className="m-center"><Sprite rows={rows} scale={3} /><p className="m-kick">{n}</p></div>)}
            {Object.keys(COLLARS).map((r) => <div key={r} className="m-center"><PupIcon role={r} /><p className="m-kick">{r}</p></div>)}
          </div>
        </Card>
        <MeanderBand /><MeanderBand wave flow />
        {scenes.map((s) => <div key={s.name}><p className="m-kick m-center" style={{ marginBottom: 8 }}>{s.name}</p><SceneFrame build={s.b} width={s.w} height={s.h} label={s.name} dataKey={lit} night={s.name.includes("night") || s.name === "arcadia"} /></div>)}
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title="A mosaic modal"><p>Escape or click outside to close.</p></Modal>
    </div>
  );
}
