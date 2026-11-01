/**
 * @lykia/embed: Lykia as web components, one script tag, no framework.
 *
 *   <script type="module" src="https://unpkg.com/@lykia/embed"></script>
 *   <lykia-assistant project="prj_…" key="lk_pk_…"></lykia-assistant>
 *   <lykia-swap project="prj_…" key="lk_pk_…" primary="#0f766e"></lykia-swap>
 *
 * Each element is a sandboxed iframe of Lykia's /embed page for that
 * module. It follows the project's brand and modules, resizes to its
 * content and re-dispatches what happens inside as DOM events:
 * `lykia:ready`, `lykia:plan-created`, `lykia:step-signed`,
 * `lykia:settled`, `lykia:error`, `lykia:resize`.
 *
 * Set `wallet="host"` (and `element.provider = window.ethereum` or any
 * EIP-1193 provider) to sign with the host page's wallet; otherwise the
 * frame uses an injected wallet itself.
 */
import {
  CONNECT_MESSAGE,
  EMBED_PROTOCOL_VERSION,
  EMBED_ROUTES,
  FRAME_ALLOW,
  FRAME_SANDBOX,
  MIN_FRAME_HEIGHT,
  PROJECT_ID,
  PUBLISHABLE_KEY,
  WALLET_METHODS,
  appearanceParams,
  clampHeight,
  frameUrl,
  type ConnectMessage,
  type EmbedRoute,
  type EmbedTag,
  type FrameMessage,
  type HostMessage,
} from "./protocol.js";

export const DEFAULT_HOST = "https://lykia-akdogan1.vercel.app";
const CONNECT_RETRY_DELAYS = [0, 150, 400, 900, 1800];

interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

const OBSERVED = ["project", "key", "host", "owner", "prefill", "primary", "accent", "background", "foreground", "scheme", "radius", "environment", "mosaic", "wallet", "height"] as const;

/** Built lazily so the module can load where HTMLElement does not exist (SSR). */
function defineElements(): void {
  if (typeof window === "undefined" || typeof customElements === "undefined") return;

  class LykiaEmbedElement extends HTMLElement {
    static get observedAttributes(): readonly string[] {
      return OBSERVED;
    }

    /** An EIP-1193 provider lent to the frame when `wallet="host"`. */
    provider: Eip1193 | null = null;
    private frame: HTMLIFrameElement | null = null;
    private port: MessagePort | null = null;
    private ready = false;
    private timers: ReturnType<typeof setTimeout>[] = [];

    private get route(): EmbedRoute {
      return EMBED_ROUTES[this.localName as EmbedTag] ?? "chat";
    }

    private get host(): string {
      const raw = this.getAttribute("host") ?? DEFAULT_HOST;
      try {
        const url = new URL(raw);
        return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : DEFAULT_HOST;
      } catch {
        return DEFAULT_HOST;
      }
    }

    connectedCallback(): void {
      this.render();
    }

    disconnectedCallback(): void {
      this.teardown();
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
      if (previous === next || !this.isConnected) return;
      if ((name === "owner" || name === "prefill") && this.port && this.ready) {
        const update: HostMessage = { type: "update", ...(this.getAttribute("owner") ? { owner: this.getAttribute("owner") as string } : {}), ...(this.getAttribute("prefill") ? { prefill: this.getAttribute("prefill") as string } : {}) };
        this.port.postMessage(update);
        return;
      }
      if (name === "height" && this.frame) {
        this.frame.style.height = `${clampHeight(next) ?? MIN_FRAME_HEIGHT}px`;
        return;
      }
      this.render();
    }

    private teardown(): void {
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      this.port?.close();
      this.port = null;
      this.ready = false;
      this.frame?.remove();
      this.frame = null;
    }

    private fail(message: string): void {
      this.dispatch("error", { message });
      this.textContent = "";
      const note = document.createElement("p");
      note.setAttribute("role", "alert");
      note.style.cssText = "font:14px system-ui,sans-serif;color:#b9472e;margin:0;padding:8px";
      note.textContent = message;
      this.appendChild(note);
    }

    private render(): void {
      this.teardown();
      const project = this.getAttribute("project") ?? "";
      if (!PROJECT_ID.test(project)) return this.fail("Lykia: set project=\"prj_…\" on this element.");
      const key = this.getAttribute("key");
      if (key !== null && !PUBLISHABLE_KEY.test(key)) return this.fail("Lykia: key must be a publishable key (lk_pk_…). Never put a secret key in a page.");
      this.textContent = "";
      if (!this.style.display) this.style.display = "block";
      const frame = document.createElement("iframe");
      frame.src = frameUrl(this.host, this.route, project, appearanceParams((n) => this.getAttribute(n)));
      frame.title = this.getAttribute("title") ?? `Lykia ${this.route}`;
      frame.setAttribute("sandbox", FRAME_SANDBOX);
      frame.setAttribute("allow", FRAME_ALLOW);
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      frame.setAttribute("loading", "lazy");
      frame.style.cssText = `display:block;width:100%;border:0;background:transparent;color-scheme:normal;height:${clampHeight(this.getAttribute("height")) ?? MIN_FRAME_HEIGHT * 2}px`;
      frame.addEventListener("load", () => this.connect());
      this.frame = frame;
      this.appendChild(frame);
    }

    /** Hands the frame a private MessagePort; retried a few times while the page boots. */
    private connect(): void {
      for (const t of this.timers) clearTimeout(t);
      this.timers = CONNECT_RETRY_DELAYS.map((delay) =>
        setTimeout(() => {
          if (this.ready || !this.frame?.contentWindow) return;
          this.port?.close();
          const channel = new MessageChannel();
          this.port = channel.port1;
          this.port.onmessage = (event: MessageEvent<FrameMessage>) => this.onFrame(event.data);
          const message: ConnectMessage = {
            type: CONNECT_MESSAGE,
            v: EMBED_PROTOCOL_VERSION,
            project: this.getAttribute("project") as string,
            ...(this.getAttribute("key") ? { key: this.getAttribute("key") as string } : {}),
            ...(this.getAttribute("owner") ? { owner: this.getAttribute("owner") as string } : {}),
            ...(this.getAttribute("prefill") ? { prefill: this.getAttribute("prefill") as string } : {}),
            hostWallet: this.getAttribute("wallet") === "host",
          };
          // Only Lykia's origin can read this: the key never reaches another frame.
          this.frame.contentWindow.postMessage(message, this.host, [channel.port2]);
        }, delay),
      );
    }

    private onFrame(message: FrameMessage): void {
      if (!message || typeof message !== "object") return;
      if (message.type === "ready") {
        this.ready = true;
        for (const t of this.timers) clearTimeout(t);
        this.dispatch("ready", { route: this.route });
      } else if (message.type === "resize") {
        const height = clampHeight(message.height);
        if (height !== null && this.frame && !this.hasAttribute("height")) {
          this.frame.style.height = `${height}px`;
          this.dispatch("resize", { height });
        }
      } else if (message.type === "event") {
        if (["plan-created", "step-signed", "settled", "error"].includes(message.name)) this.dispatch(message.name, message.detail);
      } else if (message.type === "wallet:request") {
        void this.walletRequest(message.id, message.method, message.params);
      }
    }

    private async walletRequest(id: number, method: string, params: unknown): Promise<void> {
      const reply = (body: Omit<Extract<HostMessage, { type: "wallet:response" }>, "type" | "id">) => this.port?.postMessage({ type: "wallet:response", id, ...body } satisfies HostMessage);
      const provider = this.provider ?? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null);
      if (this.getAttribute("wallet") !== "host" || !provider) return reply({ error: "The host page does not lend a wallet." });
      if (!WALLET_METHODS.includes(method)) return reply({ error: `${method} is not allowed.` });
      try {
        reply({ result: await provider.request({ method, ...(params === undefined ? {} : { params }) }) });
      } catch (error) {
        reply({ error: error instanceof Error ? error.message : String(error) });
      }
    }

    private dispatch(name: string, detail: unknown): void {
      this.dispatchEvent(new CustomEvent(`lykia:${name}`, { detail, bubbles: true, composed: true }));
    }
  }

  for (const tag of Object.keys(EMBED_ROUTES) as EmbedTag[]) {
    if (!customElements.get(tag)) customElements.define(tag, class extends LykiaEmbedElement {});
  }
}

defineElements();

export { defineElements };
export * from "./protocol.js";
