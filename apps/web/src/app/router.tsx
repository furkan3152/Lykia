/**
 * The router. Locations come from history.ts; each route is a lazy page.
 * Every navigation waits for the next page's chunk, then commits inside a
 * View Transition, so shared elements (the Ask Lyko composer, the bay
 * scene, the first message) morph between pages instead of jumping.
 */
import React, { Suspense, useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { Toaster } from "../mosaic/Toaster";
import { runViewTransition } from "../motion/viewTransition";
import { CommandPalette } from "../shell/CommandPalette";
import { Shell } from "../shell/Shell";
import { LazyBoundary } from "./LazyBoundary";
import { getLocation, installHistoryListener, subscribeLocation, type RouteLocation } from "./routes/history";
import { documentTitle, matchRoute, robotsFor, type RouteId } from "./routes/routeTable";
import { RouterContext, type RouterState } from "./routes/routerContext";
import { loadProviders, loadRoute, resolved, warmRoute } from "./routes/loader";

installHistoryListener();

const DEV = import.meta.env.DEV;
const match = (pathname: string) => matchRoute(pathname, { dev: DEV });

const WalletProviders = React.lazy(() => loadProviders().then((m) => ({ default: m.WalletProviders })));

function RoutePage({ id }: { readonly id: RouteId }) {
  const Page = resolved.get(id);
  if (Page) {
    // eslint-disable-next-line react-hooks/static-components
    return <Page />;
  }
  throw loadRoute(id);
}

function setMeta(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function Loading() {
  return (
    <div className="m-wrap" style={{ padding: "64px 0", textAlign: "center" }}>
      <div className="m-skel" style={{ height: 320 }} />
    </div>
  );
}

function stateFor(location: RouteLocation, pending = false): RouterState {
  const { route, params } = match(location.pathname);
  return { location, route, params, pending };
}

{
  const initial = match(getLocation().pathname).route;
  loadRoute(initial.id).catch(() => undefined);
  if (initial.kind === "app") loadProviders().catch(() => undefined);
}

/** Scrolls to the element a hash names (#usdc-circle); false when there is none. */
function scrollToHash(hash: string): boolean {
  if (!hash || hash.length < 2) return false;
  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    return false;
  }
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ block: "start" });
  return true;
}

export function AppRouter() {
  const [state, setState] = useState<RouterState>(() => stateFor(getLocation()));

  useEffect(
    () =>
      subscribeLocation((next) => {
        const target = stateFor(next);
        const commit = () => {
          flushSync(() => setState(target));
          if (next.action === "pop" && next.restoreScrollY !== null) window.scrollTo({ top: next.restoreScrollY });
          else if (!scrollToHash(next.hash)) window.scrollTo({ top: 0 });
        };
        setState((s) => ({ ...s, pending: true }));
        warmRoute(next.pathname).then(() => void runViewTransition("route", commit));
      }),
    [],
  );

  useEffect(() => {
    document.title = documentTitle(state.route);
    setMeta("description", state.route.description);
    setMeta("robots", robotsFor(state.route));
  }, [state.route]);

  useEffect(() => {
    // A first visit to /#section: the page renders after the browser looked for the anchor, so look again.
    const { hash } = getLocation();
    if (!hash) return undefined;
    const timers = [120, 600, 1500].map((ms) => window.setTimeout(() => void scrollToHash(hash), ms));
    const stop = () => timers.forEach((t) => window.clearTimeout(t));
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchstart", stop, { once: true, passive: true });
    return stop;
  }, []);

  useEffect(() => {
    // Warm the wallet stack and Ask Lyko once the first page is idle.
    const id = window.setTimeout(() => void warmRoute("/app/ask"), 1800);
    return () => window.clearTimeout(id);
  }, []);

  const page = (
    <LazyBoundary resetKey={state.location.pathname} fallback={(reload) => <RouteFailed onReload={reload} />}>
      <Suspense fallback={<Loading />}>
        <RoutePage id={state.route.id} />
      </Suspense>
    </LazyBoundary>
  );

  const shell = (
    <Shell kind={state.route.kind} routeId={state.route.id}>
      {page}
    </Shell>
  );

  return (
    <RouterContext.Provider value={state}>
      {state.route.kind === "app" ? (
        <Suspense fallback={<Shell kind="site" routeId={state.route.id}><Loading /></Shell>}>
          <WalletProviders>{shell}</WalletProviders>
        </Suspense>
      ) : (
        shell
      )}
      <Toaster />
      <CommandPalette />
    </RouterContext.Provider>
  );
}

function RouteFailed({ onReload }: { readonly onReload: () => void }) {
  return (
    <div className="m-wrap m-center" style={{ padding: "64px 0" }}>
      <h2 className="m-h2">This page did not load.</h2>
      <p className="m-sub">The connection dropped while fetching it.</p>
      <button type="button" className="m-btn mt-4" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}
