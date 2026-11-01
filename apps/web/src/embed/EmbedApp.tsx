/**
 * /embed/:module: what a `<lykia-*>` element frames. No site chrome.
 *
 *  1. Waits for the host element's connect message (protocol v1) and keeps
 *     its private MessagePort; the parent's origin comes from the message.
 *  2. Loads the project's public view and refuses to run unless the parent
 *     is one of the project's verified origins (its frame ancestors).
 *  3. Renders the module with @lykia/widget in the project's brand, sends
 *     its height on every resize and forwards plan-created, step-signed,
 *     settled and error. With `hostWallet`, signing goes through the host.
 */
import { CONNECT_MESSAGE, EMBED_PROTOCOL_VERSION, EMBED_ROUTE_NAMES, PROJECT_ID, type ConnectMessage, type EmbedRoute, type FrameMessage, type HostMessage } from "@lykia/embed/protocol";
import type { ProjectPublicView } from "@lykia/core";
import { LykiaTransport, projectsApi } from "@lykia/sdk";
import { Bridge, Earn, Fence, Flock, LykiaChat, LykiaProvider, Outrun, Pack, Scent, Send, Swap, type Eip1193Provider } from "@lykia/widget";
import { useEffect, useMemo, useRef, useState } from "react";

import { API_BASE } from "../lib/env";
import { brandFromQuery, parentAllowed } from "./helpers";

const COMPONENTS: Record<EmbedRoute, () => React.ReactElement> = {
  chat: () => <LykiaChat />,
  send: () => <Send />,
  swap: () => <Swap />,
  earn: () => <Earn />,
  bridge: () => <Bridge />,
  fence: () => <Fence />,
  scent: () => <Scent />,
  flock: () => <Flock />,
  pack: () => <Pack />,
  outrun: () => <Outrun />,
};

/** An EIP-1193 provider that asks the host page's wallet over the port. */
function hostProvider(port: MessagePort): Eip1193Provider {
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  port.addEventListener("message", (event: MessageEvent<HostMessage>) => {
    const m = event.data;
    if (m?.type !== "wallet:response") return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.result);
  });
  return {
    request: ({ method, params }) =>
      new Promise((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve, reject });
        port.postMessage({ type: "wallet:request", id, method, params } satisfies FrameMessage);
      }),
  };
}

interface Session {
  readonly port: MessagePort;
  readonly parent: string;
  readonly connect: ConnectMessage;
}

export default function EmbedApp() {
  const route = window.location.pathname.replace(/^\/embed\//u, "").split("/")[0] as EmbedRoute;
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const projectId = params.get("project") ?? "";
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<ProjectPublicView | null>(null);
  const invalid = window.parent === window ? "This page runs inside a <lykia-*> element on your site." : !EMBED_ROUTE_NAMES.includes(route) || !PROJECT_ID.test(projectId) ? "Unknown embed." : null;
  const [problem, setProblem] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (invalid) return;
    const onMessage = (event: MessageEvent) => {
      const m = event.data as ConnectMessage | undefined;
      if (event.source !== window.parent || m?.type !== CONNECT_MESSAGE || m.v !== EMBED_PROTOCOL_VERSION || !event.ports[0]) return;
      if (m.project !== projectId) return;
      const port = event.ports[0];
      port.start();
      setOwner(m.owner);
      setSession((prev) => {
        prev?.port.close();
        return { port, parent: event.origin, connect: m };
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [projectId, invalid]);

  useEffect(() => {
    if (!session || invalid) return;
    const lookup = new LykiaTransport({ baseUrl: new URL(API_BASE).origin });
    projectsApi(lookup)
      .public(projectId)
      .then((v) => {
        if (!parentAllowed(session.parent, v)) {
          setProblem(`${session.parent} is not a verified origin of this project.`);
          return;
        }
        setView(v);
        session.port.postMessage({ type: "ready", v: EMBED_PROTOCOL_VERSION } satisfies FrameMessage);
      })
      .catch(() => setProblem("This project could not be loaded."));
    const onHost = (event: MessageEvent<HostMessage>) => {
      if (event.data?.type === "update" && event.data.owner) setOwner(event.data.owner);
    };
    session.port.addEventListener("message", onHost);
    return () => session.port.removeEventListener("message", onHost);
  }, [session, projectId, invalid]);

  useEffect(() => {
    if (!session || !root.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(root.current?.getBoundingClientRect().height ?? 0) + 4;
      session.port.postMessage({ type: "resize", height } satisfies FrameMessage);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [session, view]);

  const transport = useMemo(
    () => (session ? new LykiaTransport({ baseUrl: new URL(API_BASE).origin, project: projectId, ...(session.connect.key ? { apiKey: session.connect.key } : {}), headers: { "Lykia-Embed-Parent": session.parent } }) : null),
    [session, projectId],
  );
  const provider = useMemo(() => (session?.connect.hostWallet ? hostProvider(session.port) : undefined), [session]);

  if (invalid ?? problem) return <p role="alert" style={{ font: "14px system-ui, sans-serif", padding: 12, margin: 0 }}>{invalid ?? problem}</p>;
  if (!session || !view || !transport) return <div ref={root} style={{ minHeight: 120 }} aria-busy="true" />;
  const forward = (name: string, detail: unknown) => {
    if (name === "plan-created" || name === "step-signed" || name === "settled" || name === "error") session.port.postMessage({ type: "event", name, detail: name === "error" ? { message: (detail as { error?: { message?: string } }).error?.message ?? "Error" } : detail } satisfies FrameMessage);
  };
  const Component = COMPONENTS[route];
  return (
    <div ref={root}>
      <LykiaProvider transport={transport} environment={(params.get("environment") as "mainnet" | "testnet" | null) ?? view.network} brand={{ ...view.brand, ...brandFromQuery(params) }} modules={view.modules} assistantName={view.assistantName} vocabulary={view.vocabulary} {...(owner && /^0x[0-9a-fA-F]{40}$/u.test(owner) ? { owner: owner as `0x${string}` } : {})} {...(provider ? { provider } : {})} onEvent={forward}>
        <Component />
      </LykiaProvider>
    </div>
  );
}
