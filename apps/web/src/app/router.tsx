import React from "react";
import { flushSync } from "react-dom";

import { prefersReducedMotion } from "../motion/useReducedMotion";
import { runViewTransition, supportsViewTransitions } from "../motion/viewTransition";
import { useOracleStore } from "../oracle/oracleStore";
import { GlobalKeys } from "./keyboard/GlobalKeys";
import { KonamiWink } from "./keyboard/KonamiWink";
import { LazyBoundary } from "./LazyBoundary";
import { getLocation, installHistoryListener, subscribeLocation, type RouteLocation } from "./routes/history";
import { documentTitle, matchRoute, robotsFor, ROUTES, type RouteDefinition, type RouteId } from "./routes/routeTable";
import { RouterContext, type RouterState } from "./routes/routerContext";
import { BootFallback, FramedRouteNotice, RouteLoadFailed } from "./shell/RouteFallbacks";

installHistoryListener();

const DEV = import.meta.env.DEV;
const match = (pathname: string) => matchRoute(pathname, { dev: DEV });

const loadSiteLayout = () => import("./shell/SiteLayout");
const loadAppLayout = () => import("./shell/AppLayout");
const SiteLayout = React.lazy(loadSiteLayout);
const AppLayout = React.lazy(loadAppLayout);
const Toaster = React.lazy(() => import("../ui/Toaster").then((module) => ({ default: module.Toaster })));
const WhistleBox = React.lazy(() => import("./shell/WhistleBox").then((module) => ({ default: module.WhistleBox })));

/*
 * Route pages. Unlike React.lazy (which suspends on its first render even when
 * the chunk is already loaded), `RoutePage` renders a loaded page at once, so
 * a View Transition can commit the next page synchronously. Until the chunk
 * arrives it suspends; a failed chunk throws to LazyBoundary.
 */
const resolved = new Map<RouteId, React.ComponentType>();
const failed = new Map<RouteId, unknown>();
const inflight = new Map<RouteId, Promise<void>>();

function loadRoute(id: RouteId): Promise<void> {
  if (resolved.has(id)) return Promise.resolve();
  const existing = inflight.get(id);
  if (existing) return existing;
  const promise = ROUTES[id].load().then(
    (module) => {
      inflight.delete(id);
      if (typeof module.default !== "function" && typeof module.default !== "object") {
        const error = new Error(`The ${id} page module has no default export.`);
        failed.set(id, error);
        throw error;
      }
      resolved.set(id, module.default);
    },
    (error: unknown) => {
      failed.set(id, error ?? new Error(`The ${id} page failed to load.`));
      inflight.delete(id);
      throw error;
    },
  );
  inflight.set(id, promise);
  return promise;
}

function RoutePage({ id }: { readonly id: RouteId }) {
  const Page = resolved.get(id);
  if (Page) {
    // Module-level component, stable for the route: never recreated per render.
    // eslint-disable-next-line react-hooks/static-components
    return <Page />;
  }
  if (failed.has(id)) throw failed.get(id);
  throw loadRoute(id);
}

// Start the initial route's chunks in parallel with the layout instead of in sequence.
{
  const initial = match(getLocation().pathname).route;
  loadRoute(initial.id).catch(() => undefined);
  if (initial.kind === "site") loadSiteLayout().catch(() => undefined);
  if (initial.kind === "app") loadAppLayout().catch(() => undefined);
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function applyDocumentMeta(route: RouteDefinition) {
  const title = documentTitle(route);
  document.title = title;
  setMeta("name", "description", route.description);
  setMeta("name", "robots", robotsFor(route));
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", route.description);
}

/** Scrolls to `#hash`, retrying while lazy content mounts; the visitor scrolling or typing cancels it. */
function scrollToHash(hash: string, smooth: boolean): () => void {
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return () => undefined;
  }
  const started = performance.now();
  let handle = 0;
  let done = false;
  const userEvents = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const stop = () => {
    done = true;
    window.cancelAnimationFrame(handle);
    for (const type of userEvents) window.removeEventListener(type, stop, true);
  };
  const attempt = () => {
    if (done) return;
    const target = id ? document.getElementById(id) : null;
    if (target) {
      target.scrollIntoView({ behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto", block: "start" });
      if (!target.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/u.test(target.tagName)) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      stop();
      return;
    }
    if (performance.now() - started < 4_000) handle = window.requestAnimationFrame(attempt);
    else stop();
  };
  for (const type of userEvents) window.addEventListener(type, stop, { capture: true, passive: true });
  attempt();
  return stop;
}

/** True when another origin frames this document (Lykia is never framed). */
function isCrossOriginFramed(): boolean {
  try {
    if (window.self === window.top) return false;
  } catch {
    return true;
  }
  try {
    return window.top?.location.origin !== window.location.origin;
  } catch {
    return true;
  }
}

const CROSS_ORIGIN_FRAMED = typeof window !== "undefined" && isCrossOriginFramed();

function PendingBar({ pending }: { readonly pending: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] origin-left bg-accent-line transition-opacity duration-base ${
        pending ? "animate-pending-bar opacity-100" : "scale-x-0 opacity-0"
      }`}
    />
  );
}

/** Mounts the whistle box chunk the first time ⌘K opens it, then keeps it. */
function OracleMount() {
  const everOpened = useOracleStore((state) => state.everOpened);
  if (!everOpened) return null;
  return (
    <React.Suspense fallback={null}>
      <WhistleBox />
    </React.Suspense>
  );
}

/** Top-level router: every route is code-split; navigation renders in a transition. */
export function AppRouter() {
  const [location, setLocation] = React.useState<RouteLocation>(getLocation);
  const [pending, startTransition] = React.useTransition();
  const [preloading, setPreloading] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const previousPathRef = React.useRef(location.pathname);
  const renderedLocationRef = React.useRef(location);

  React.useLayoutEffect(() => {
    renderedLocationRef.current = location;
  }, [location]);

  React.useEffect(
    () =>
      subscribeLocation((next) => {
        const previous = renderedLocationRef.current;
        const previousRoute = match(previous.pathname).route;
        const nextRoute = match(next.pathname).route;
        // Only a change between two marketing pages cross-fades; the deck keeps its shell still.
        const animate =
          !CROSS_ORIGIN_FRAMED &&
          next.pathname !== previous.pathname &&
          previousRoute.id !== nextRoute.id &&
          previousRoute.kind === "site" &&
          nextRoute.kind === "site" &&
          supportsViewTransitions() &&
          !prefersReducedMotion();
        if (!animate) {
          setPreloading(false);
          startTransition(() => setLocation(next));
          return;
        }
        const commit = () => {
          if (getLocation().key !== next.key) return;
          void runViewTransition("route", () => {
            if (getLocation().key !== next.key) return;
            flushSync(() => {
              setPreloading(false);
              setLocation(next);
            });
          });
        };
        if (resolved.has(nextRoute.id)) {
          commit();
          return;
        }
        setPreloading(true);
        loadRoute(nextRoute.id).then(commit, () => {
          if (getLocation().key !== next.key) return;
          setPreloading(false);
          startTransition(() => setLocation(next));
        });
      }),
    [],
  );

  const { route, params } = React.useMemo(() => match(location.pathname), [location.pathname]);

  React.useEffect(() => {
    applyDocumentMeta(route);
  }, [route]);

  React.useLayoutEffect(() => {
    const pathChanged = previousPathRef.current !== location.pathname;
    previousPathRef.current = location.pathname;
    let cancel: () => void = () => undefined;
    if (location.action === "pop" && location.restoreScrollY !== null) {
      window.scrollTo(0, location.restoreScrollY);
    } else if (location.hash) {
      cancel = scrollToHash(location.hash, location.action !== "initial" && !pathChanged);
    } else if (location.action !== "initial" && pathChanged) {
      window.scrollTo(0, 0);
    }
    if (pathChanged && location.action !== "initial" && !location.hash) {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
    return cancel;
  }, [location]);

  const pageTitle = documentTitle(route);
  React.useEffect(() => {
    if (location.action === "initial") return undefined;
    const timer = window.setTimeout(() => setAnnouncement(pageTitle), 60);
    return () => window.clearTimeout(timer);
  }, [location, pageTitle]);

  const busy = pending || preloading;
  const state = React.useMemo<RouterState>(() => ({ location, route, params, pending: busy }), [location, route, params, busy]);

  const page = (
    <LazyBoundary resetKey={location.pathname} fallback={(reload) => <RouteLoadFailed reload={reload} />}>
      <React.Suspense fallback={<BootFallback />}>
        <RoutePage key={route.id} id={route.id} />
      </React.Suspense>
    </LazyBoundary>
  );

  const content =
    CROSS_ORIGIN_FRAMED ? (
      <FramedRouteNotice href={`${window.location.origin}${location.pathname}${location.search}`} />
    ) : route.kind === "site" ? (
      <SiteLayout>{page}</SiteLayout>
    ) : (
      <AppLayout>{page}</AppLayout>
    );

  return (
    <RouterContext.Provider value={state}>
      <PendingBar pending={busy} />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {busy ? "Loading page" : announcement}
      </div>
      <LazyBoundary resetKey={route.kind} fallback={(reload) => <RouteLoadFailed reload={reload} />}>
        <React.Suspense fallback={<BootFallback />}>{content}</React.Suspense>
      </LazyBoundary>
      <GlobalKeys />
      <KonamiWink />
      <OracleMount />
      <React.Suspense fallback={null}>
        <Toaster />
      </React.Suspense>
    </RouterContext.Provider>
  );
}
