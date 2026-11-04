/** A community city without a dedicated shell: its modules as tabs, in its own brand and frame. */
import type { LeagueCity, ProjectModule } from "@lykia/core";
import { LykiaTransport } from "@lykia/sdk";
import { Bridge, Earn, Fence, Flock, LykiaChat, LykiaProvider, Pack, Scent, Send, Swap } from "@lykia/widget";
import { useMemo, useState } from "react";

import { MODULE_LABEL } from "../features/league/model";
import { API_BASE } from "../lib/env";
import { CityFrame, type CityTab } from "./CityFrame";
import type { PixelIconName } from "./PixelIcon";

const PREVIEW: Partial<Record<ProjectModule, () => React.ReactElement>> = { chat: () => <LykiaChat />, send: () => <Send />, swap: () => <Swap />, earn: () => <Earn />, bridge: () => <Bridge />, fence: () => <Fence />, scent: () => <Scent />, flock: () => <Flock />, pack: () => <Pack /> };
const ICON: Partial<Record<ProjectModule, PixelIconName>> = { chat: "ask", send: "out", swap: "swap", earn: "spark", bridge: "swap", fence: "shield", scent: "spark", flock: "home", pack: "agents" };

export function GenericShell({ city, home }: { readonly city: LeagueCity; readonly home: string }) {
  const modules = city.project.modules.filter((m) => PREVIEW[m]).slice(0, 5);
  const [tab, setTab] = useState<ProjectModule>(modules[0] ?? "chat");
  const transport = useMemo(() => new LykiaTransport({ baseUrl: new URL(API_BASE).origin, environment: city.project.network }), [city.project.network]);
  const tabs: CityTab<ProjectModule>[] = modules.map((m) => ({ id: m, label: MODULE_LABEL[m].split(" · ")[0]!, icon: ICON[m] ?? "spark" }));
  return (
    <CityFrame city={city} home={home} tab={tab} {...(tabs.length > 1 ? { tabs, onTab: setTab } : {})}>
      <section className="ct-generic">
        <p className="m-sub">{city.league.tagline}</p>
        <div className="m-frame m-card">
          <LykiaProvider transport={transport} brand={city.project.brand} modules={city.project.modules} assistantName={city.project.assistantName} vocabulary={city.project.vocabulary} environment={city.project.network}>
            {PREVIEW[tab]?.()}
          </LykiaProvider>
        </div>
      </section>
    </CityFrame>
  );
}
