/**
 * City mode: a League city running as its own app (pay.<root domain>,
 * /c/pay or ?city=pay). Loads the city's public view, wraps it in the wallet
 * providers and renders the city's own shell, not the full Lykia app.
 */
import type { LeagueCity } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect } from "react";

import { loadProviders } from "../app/routes/loader";
import { Coin } from "../features/league/Coin";
import { apiGet } from "../lib/api";
import { Toaster } from "../mosaic/Toaster";
import { lykiaHome, type CityTarget } from "./detect";
import { shellFor } from "./model";

const WalletProviders = React.lazy(() => loadProviders().then((m) => ({ default: m.WalletProviders })));
const PayShell = React.lazy(() => import("./PayShell").then((m) => ({ default: m.PayShell })));
const AgentsShell = React.lazy(() => import("./AgentsShell").then((m) => ({ default: m.AgentsShell })));
const ComingShell = React.lazy(() => import("./ComingShell").then((m) => ({ default: m.ComingShell })));
const GenericShell = React.lazy(() => import("./GenericShell").then((m) => ({ default: m.GenericShell })));

function Striking({ label }: { readonly label: string }) {
  return (
    <div className="ct-boot" role="status">
      <Coin state="coming" emblem="triskeles" codename={null} name="Lykia" size={120} interactive={false} />
      <p className="m-kick">{label}</p>
    </div>
  );
}

export default function CityApp({ target }: { readonly target: CityTarget }) {
  const root = (import.meta.env.VITE_LYKIA_ROOT_DOMAIN as string | undefined) ?? null;
  const home = lykiaHome(root, window.location.origin, target);
  const city = useQuery({
    queryKey: ["city-boot", target],
    retry: 1,
    queryFn: ({ signal }) => (target.kind === "slug" ? apiGet<LeagueCity>(`/v1/league/by-slug/${target.slug}`, { signal, timeoutMs: 15_000 }) : apiGet<LeagueCity>("/v1/league/by-host", { query: { host: target.host }, signal, timeoutMs: 15_000 })),
  });
  useEffect(() => {
    if (!city.data) return;
    document.title = `${city.data.project.name} · a Lykia city`;
    document.documentElement.dataset.city = city.data.slug;
    document.querySelector('meta[name="description"]')?.setAttribute("content", city.data.league.tagline);
  }, [city.data]);
  if (city.isLoading) return <Striking label="STRIKING THE CITY…" />;
  if (!city.data) {
    return (
      <div className="ct-boot" role="alert">
        <Coin state="paused" emblem="triskeles" codename={null} name="Lykia" size={120} interactive={false} />
        <h1 className="m-h2">{"No city lives here"}</h1>
        <p className="m-small m-muted">{"This address is not a listed city of the League, or the API did not answer."}</p>
        <a className="m-btn" href={`${home}/league`}>{"SEE THE LEAGUE"}</a>
      </div>
    );
  }
  const kind = shellFor(city.data);
  const Shell = kind === "pay" ? PayShell : kind === "agents" ? AgentsShell : kind === "coming" ? ComingShell : GenericShell;
  return (
    <React.Suspense fallback={<Striking label={city.data.project.name.toUpperCase()} />}>
      <WalletProviders>
        <Shell city={city.data} home={home} />
      </WalletProviders>
      <Toaster />
    </React.Suspense>
  );
}
