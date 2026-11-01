/**
 * <LykiaProvider>: one transport, the project's brand and modules, the
 * theme and the wallet for every Lykia component and hook below it.
 *
 * SSR-safe: nothing touches window or document during render. The
 * project's public view and the colour-scheme preference load in effects.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { PROJECT_MODULES, type Address, type ArcEnvironment, type ProjectBrand, type ProjectModule, type ProjectPublicView } from "@lykia/core";
import { LykiaTransport, projectsApi, type LykiaEventMap, type LykiaEventName } from "@lykia/sdk";
import { WIDGET_CSS, themeFromBrand, themeVars, type LykiaTheme, type ThemeInput } from "./theme.js";
import { resolveSigner, type LykiaSigner, type WalletOptions } from "./wallet.js";

export interface LykiaProviderProps extends WalletOptions {
  /** A publishable key (`lk_pk_…`) bound to your project's origins. */
  readonly apiKey?: string;
  readonly baseUrl?: string;
  /** Your project id (`prj_…`): brand, modules, network and Fence caps come from it. */
  readonly project?: string;
  readonly environment?: ArcEnvironment;
  /** Overrides on top of the project's brand. */
  readonly theme?: ThemeInput;
  /** A brand to use without a project (or before it loads). */
  readonly brand?: ProjectBrand;
  /** Modules to show without a project. Default: all. */
  readonly modules?: readonly ProjectModule[];
  /** The assistant's name without a project. Default "Lyko". */
  readonly assistantName?: string;
  /** Custom strings without a project (keys like "assistant.greeting"). */
  readonly vocabulary?: Readonly<Record<string, string>>;
  /** The user's address, if the host already knows it. */
  readonly owner?: Address;
  /** Bring your own transport (tests, custom fetch). */
  readonly transport?: LykiaTransport;
  /** Every client event (plan-created, step-signed, settled, error...). */
  readonly onEvent?: <K extends LykiaEventName>(name: K, event: LykiaEventMap[K]) => void;
  readonly children?: ReactNode;
}

export interface LykiaContextValue {
  readonly transport: LykiaTransport;
  readonly environment: ArcEnvironment | undefined;
  readonly project: ProjectPublicView | null;
  readonly theme: LykiaTheme;
  readonly modules: ReadonlySet<ProjectModule>;
  readonly assistantName: string;
  readonly avatarUrl: string | undefined;
  readonly showMascot: boolean;
  readonly owner: Address | undefined;
  /** Text from the project's vocabulary, or the fallback. */
  t(key: string, fallback: string): string;
  /** The wallet, resolved on first use. */
  signer(): Promise<LykiaSigner | null>;
}

const LykiaContext = createContext<LykiaContextValue | null>(null);

function darkQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
}

function subscribeDark(onChange: () => void): () => void {
  const media = darkQuery();
  media?.addEventListener?.("change", onChange);
  return () => media?.removeEventListener?.("change", onChange);
}

function readDark(): boolean {
  return darkQuery()?.matches ?? false;
}

const EVENTS: readonly LykiaEventName[] = ["request", "response", "retry", "error", "plan-created", "step-signed", "settled"];

export function LykiaProvider(props: LykiaProviderProps) {
  const { apiKey, baseUrl, project: projectId, environment, transport: given, onEvent } = props;
  const transport = useMemo(() => given ?? new LykiaTransport({ ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}), ...(projectId ? { project: projectId } : {}), ...(environment ? { environment } : {}) }), [given, apiKey, baseUrl, projectId, environment]);
  const [project, setProject] = useState<ProjectPublicView | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    projectsApi(transport)
      .public(projectId)
      .then((view) => live && setProject(view))
      .catch(() => live && setProject(null));
    return () => {
      live = false;
    };
  }, [transport, projectId]);

  const prefersDark = useSyncExternalStore(subscribeDark, readDark, () => false);

  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    const offs = EVENTS.map((name) => transport.on(name, (event) => handler.current?.(name, event as never)));
    return () => offs.forEach((off) => off());
  }, [transport]);

  // Wallet options can change identity every render; keep the latest and resolve lazily.
  const wallet = useRef<WalletOptions>({});
  const { walletClient, provider, wagmiConfig } = props;
  useEffect(() => {
    wallet.current = { ...(walletClient ? { walletClient } : {}), ...(provider ? { provider } : {}), ...(wagmiConfig ? { wagmiConfig } : {}) };
  }, [walletClient, provider, wagmiConfig]);

  const signer = useCallback(() => resolveSigner(wallet.current), []);

  const value = useMemo<LykiaContextValue>(() => {
    const brand = project?.brand ?? props.brand;
    const theme = themeFromBrand(brand, prefersDark, props.theme ?? {});
    const modules = new Set<ProjectModule>(project?.modules ?? props.modules ?? PROJECT_MODULES);
    const vocabulary = project?.vocabulary ?? props.vocabulary ?? {};
    const mascot = brand?.mascot ?? "lyko";
    return {
      transport,
      environment: environment ?? project?.network,
      project,
      theme,
      modules,
      assistantName: project?.assistantName ?? props.assistantName ?? (mascot === "custom" && brand?.assistant?.name ? brand.assistant.name : "Lyko"),
      avatarUrl: brand?.assistant?.avatarUrl,
      showMascot: mascot !== "none",
      owner: props.owner,
      t: (key, fallback) => vocabulary[key] ?? fallback,
      signer,
    };
  }, [signer, transport, environment, project, prefersDark, props.theme, props.brand, props.modules, props.assistantName, props.vocabulary, props.owner]);

  return (
    <LykiaContext.Provider value={value}>
      <style data-lykia-styles="">{WIDGET_CSS}</style>
      {props.children}
    </LykiaContext.Provider>
  );
}

export function useLykia(): LykiaContextValue {
  const value = useContext(LykiaContext);
  if (!value) throw new Error("Wrap Lykia components in <LykiaProvider>.");
  return value;
}

/** The scoped root every component renders: theme variables, Mosaic background, its own data attribute. */
export function LykiaRoot(props: { readonly name: string; readonly className?: string; readonly children?: ReactNode }) {
  const { theme } = useLykia();
  return (
    <div data-lykia={props.name} data-mosaic={theme.mosaic ? "true" : "false"} data-scheme={theme.scheme} className={props.className} style={{ ...themeVars(theme), padding: 8 } as Record<string, string | number>}>
      {props.children}
    </div>
  );
}

/** Shown in place of a component whose module the project turned off. */
export function ModuleOff(props: { readonly module: ProjectModule }) {
  return (
    <LykiaRoot name={`${props.module}-off`}>
      <div className="lk-card">
        <p className="lk-muted">This feature is not enabled for this app.</p>
      </div>
    </LykiaRoot>
  );
}
