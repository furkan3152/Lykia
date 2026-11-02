/**
 * Alerts: rules per owner, a checker, and delivery to the inbox, webhooks and
 * Telegram.
 *
 * - Price alerts read Chainlink feeds on Arc (EURC/USD, BTC/USD) through the
 *   price service; a stale or missing price never fires.
 * - Health alerts read the Flock's health factors (Aave V4, Morpho Blue).
 * - Transfer alerts scan ERC-20 Transfer logs for the owner within Arc's
 *   10,000-block log window, from a per-rule cursor.
 * - Scent alerts fire when the Flock holds a look-alike or unverified token.
 * - Order alerts fire from LykiaOrders executions (bus event or log scan).
 *
 * Telegram: an owner asks for a link code, sends `/start <code>` to the bot,
 * and the webhook binds that chat to the owner. The bot token lives in
 * TELEGRAM_BOT_TOKEN and is never logged.
 */
import {
  ALERT_LIMITS,
  assessToken,
  compareDecimal,
  describeAlert,
  findToken,
  fromBaseUnits,
  tokenAddress,
  type Address,
  type AlertChannel,
  type AlertFiring,
  type AlertKind,
  type AlertRule,
  type ArcEnvironment,
} from "@lykia/core";
import { parseAbiItem } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { services } from "../services.js";
import { agentServices } from "../agents/index.js";
import { randomHex } from "../platform/crypto.js";
import type { JsonValue } from "../store/types.js";

export const ALERT_CHECK_MS = 60_000;
const FIRING_TTL_MS = 30 * 86_400_000;
const LINK_TTL_MS = 15 * 60_000;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export interface AlertInput {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly kind: AlertKind;
  readonly token?: string;
  readonly threshold?: string;
  readonly channels?: readonly AlertChannel[];
  readonly cooldownSeconds?: number;
}

/** Why an alert cannot be armed as given, or null. Shared by the route and Lyko's create_alert tool. */
export function alertInputIssue(input: Pick<AlertInput, "environment" | "kind" | "token" | "threshold">): string | null {
  const needsToken = input.kind.startsWith("price-") || input.kind.startsWith("transfer-");
  const needsThreshold = needsToken || input.kind === "health-below";
  if (needsToken && (!input.token || !findToken(input.environment, input.token))) return "This alert needs a registry token (USDC, EURC, cirBTC).";
  if (input.kind.startsWith("price-") && findToken(input.environment, input.token as string)?.symbol === "USDC") return "USDC is the unit of account; price alerts watch EURC or cirBTC.";
  if (needsThreshold && (!input.threshold || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(input.threshold))) return "This alert needs a positive decimal threshold.";
  return null;
}

export class AlertsService {
  constructor(private readonly ctx: AppContext) {}

  private rules() {
    return this.ctx.store.collection<JsonValue>("alert_rules");
  }
  private firings() {
    return this.ctx.store.collection<JsonValue>("alert_firings");
  }
  private links() {
    return this.ctx.store.collection<JsonValue>("telegram_links");
  }

  async create(input: AlertInput): Promise<AlertRule> {
    const existing = await this.list(input.owner);
    if (existing.length >= ALERT_LIMITS.perOwner) throw new LykiaHttpError("INVALID_REQUEST", 400, `At most ${ALERT_LIMITS.perOwner} alerts per owner.`);
    const issue = alertInputIssue(input);
    if (issue) throw new LykiaHttpError("INVALID_REQUEST", 400, issue);
    const now = new Date(this.ctx.clock.now()).toISOString();
    const rule: AlertRule = {
      id: `al_${randomHex(8)}`,
      owner: input.owner,
      environment: input.environment,
      kind: input.kind,
      ...(input.token ? { token: findToken(input.environment, input.token)?.symbol ?? input.token } : {}),
      ...(input.threshold ? { threshold: input.threshold } : {}),
      channels: input.channels && input.channels.length > 0 ? [...new Set(input.channels)] : ["inbox"],
      cooldownSeconds: Math.max(ALERT_LIMITS.minCooldownSeconds, input.cooldownSeconds ?? ALERT_LIMITS.defaultCooldownSeconds),
      createdAt: now,
      lastFiredAt: null,
      paused: false,
    };
    await this.rules().put(`${input.owner.toLowerCase()}:${rule.id}`, rule as unknown as JsonValue);
    return rule;
  }

  async list(owner: Address): Promise<AlertRule[]> {
    return (await this.rules().list({ prefix: `${owner.toLowerCase()}:`, limit: 200 })).map((d) => d.value as unknown as AlertRule);
  }

  async update(owner: Address, id: string, patch: { readonly paused?: boolean }): Promise<AlertRule> {
    const key = `${owner.toLowerCase()}:${id}`;
    const doc = await this.rules().get(key);
    if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such alert.");
    const next = { ...(doc.value as unknown as AlertRule), ...(patch.paused !== undefined ? { paused: patch.paused } : {}) };
    await this.rules().put(key, next as unknown as JsonValue);
    return next;
  }

  async remove(owner: Address, id: string): Promise<boolean> {
    return this.rules().delete(`${owner.toLowerCase()}:${id}`);
  }

  async inbox(owner: Address): Promise<AlertFiring[]> {
    return (await this.firings().list({ prefix: `${owner.toLowerCase()}:`, limit: 200 })).map((d) => d.value as unknown as AlertFiring).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  async markRead(owner: Address): Promise<number> {
    let n = 0;
    for (const d of await this.firings().list({ prefix: `${owner.toLowerCase()}:`, limit: 200 })) {
      const f = d.value as unknown as AlertFiring;
      if (!f.read) {
        await this.firings().put(d.id, { ...f, read: true } as unknown as JsonValue, { ttlMs: FIRING_TTL_MS });
        n += 1;
      }
    }
    return n;
  }

  /** Records and delivers a firing, honouring the rule's channels and cooldown. */
  async fire(rule: AlertRule, title: string, body: string, link?: string): Promise<boolean> {
    const now = this.ctx.clock.now();
    if (rule.lastFiredAt && now - Date.parse(rule.lastFiredAt) < rule.cooldownSeconds * 1000) return false;
    const firing: AlertFiring = { id: `af_${now.toString(36)}_${randomHex(4)}`, ruleId: rule.id, owner: rule.owner, kind: rule.kind, title, body, at: new Date(now).toISOString(), read: false, ...(link ? { link } : {}) };
    await this.rules().put(`${rule.owner.toLowerCase()}:${rule.id}`, { ...rule, lastFiredAt: firing.at } as unknown as JsonValue);
    if (rule.channels.includes("inbox")) await this.firings().put(`${rule.owner.toLowerCase()}:${firing.id}`, firing as unknown as JsonValue, { ttlMs: FIRING_TTL_MS });
    if (rule.channels.includes("webhook")) void agentServices(this.ctx).webhooks.emit("alert.fired", rule.owner, firing as unknown as JsonValue).catch(() => undefined);
    if (rule.channels.includes("telegram")) await this.telegramNotify(rule.owner, `🔔 ${title}\n${body}`).catch(() => undefined);
    return true;
  }

  /** One pass over every active rule in `environment`. */
  async tick(environment: ArcEnvironment): Promise<{ checked: number; fired: number }> {
    const all = (await this.rules().list({ limit: 2000 })).map((d) => d.value as unknown as AlertRule).filter((r) => !r.paused && r.environment === environment);
    let fired = 0;
    const s = services(this.ctx);
    const priceSymbols = [...new Set(all.filter((r) => r.kind.startsWith("price-")).map((r) => r.token as string))];
    const prices = priceSymbols.length > 0 ? await s.prices.prices(priceSymbols).catch(() => ({}) as Record<string, { usd: string | null }>) : {};
    const snaps = new Map<string, Awaited<ReturnType<typeof s.flock.snapshot>> | null>();
    const snapOf = async (owner: Address) => {
      const key = owner.toLowerCase();
      if (!snaps.has(key)) snaps.set(key, await s.flock.snapshot(environment, owner).catch(() => null));
      return snaps.get(key) ?? null;
    };
    const client = this.ctx.chains.client(environment);
    let head: bigint | null = null;
    for (const rule of all) {
      try {
        if (rule.kind === "price-above" || rule.kind === "price-below") {
          const usd = (prices as Record<string, { usd: string | null } | undefined>)[rule.token as string]?.usd ?? null;
          if (usd === null) continue;
          const crossed = rule.kind === "price-above" ? compareDecimal(usd, rule.threshold as string) >= 0 : compareDecimal(usd, rule.threshold as string) <= 0;
          if (crossed && (await this.fire(rule, `${rule.token} is $${Number(usd).toFixed(4)}`, describeAlert(rule)))) fired += 1;
        } else if (rule.kind === "health-below") {
          const snap = await snapOf(rule.owner);
          const low = snap?.health.find((h) => h.healthFactor !== null && compareDecimal(h.healthFactor, rule.threshold as string) < 0);
          if (low && (await this.fire(rule, `Health factor ${low.healthFactor} on ${low.venue}`, `Below your ${rule.threshold} alert. Repaying part of the debt raises it.`, "/app/flock"))) fired += 1;
        } else if (rule.kind === "scent-warning") {
          const snap = await snapOf(rule.owner);
          const bad = snap?.holdings.find((h) => h.kind === "token" && assessToken({ environment, address: h.token, symbol: h.symbol }).status !== "verified");
          if (bad && (await this.fire(rule, `${bad.symbol} in your flock is not a registry token`, "Lyko smells something off. Run Scent before you trade it.", `/app/scent/${bad.token}`))) fired += 1;
        } else if (rule.kind === "transfer-in" || rule.kind === "transfer-out") {
          head ??= await client.getBlockNumber();
          const token = findToken(environment, rule.token as string);
          if (!token) continue;
          const start = scanStart(rule.cursorBlock, head);
          const owner = rule.owner;
          const logs = await client.getLogs({ address: tokenAddress(token, environment) as Address, event: TRANSFER, args: rule.kind === "transfer-in" ? { to: owner } : { from: owner }, fromBlock: start, toBlock: head });
          await this.rules().put(`${owner.toLowerCase()}:${rule.id}`, { ...rule, cursorBlock: head.toString() } as unknown as JsonValue);
          const min = BigInt(Math.round(Number(rule.threshold) * 10 ** token.decimals));
          const big = logs.find((l) => (l.args.value ?? 0n) >= min);
          if (big) {
            const amount = fromBaseUnits(big.args.value ?? 0n, token.decimals);
            const other = rule.kind === "transfer-in" ? big.args.from : big.args.to;
            if (await this.fire({ ...rule, cursorBlock: head.toString() }, `${rule.kind === "transfer-in" ? "Received" : "Sent"} ${amount} ${token.symbol}`, `${rule.kind === "transfer-in" ? "From" : "To"} ${other} in block ${big.blockNumber}.`)) fired += 1;
          }
        }
      } catch (error) {
        this.ctx.log.debug("alert check failed", { rule: rule.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { checked: all.length, fired };
  }

  /** Fires every order-filled rule of `owner`. Called when the keeper executes an order. */
  async orderFilled(owner: Address, summary: string): Promise<void> {
    for (const rule of await this.list(owner)) if (rule.kind === "order-filled" && !rule.paused) await this.fire(rule, "Order executed", summary, "/app/orders");
  }

  // ------------------------------------------------------------------ Telegram

  private get botToken(): string | null {
    return this.ctx.config.telegramBotToken;
  }

  async linkCode(owner: Address): Promise<{ code: string; expiresAt: string; bot: string | null; configured: boolean }> {
    const code = `LYK-${randomHex(4).toUpperCase()}`;
    const expiresAt = new Date(this.ctx.clock.now() + LINK_TTL_MS).toISOString();
    await this.links().put(`code:${code}`, { owner, expiresAt } as unknown as JsonValue, { ttlMs: LINK_TTL_MS });
    return { code, expiresAt, bot: process.env.TELEGRAM_BOT_USERNAME ?? null, configured: this.botToken !== null };
  }

  async linkStatus(owner: Address): Promise<{ linked: boolean; configured: boolean }> {
    const doc = await this.links().get(`owner:${owner.toLowerCase()}`);
    return { linked: Boolean(doc), configured: this.botToken !== null };
  }

  async unlink(owner: Address): Promise<void> {
    await this.links().delete(`owner:${owner.toLowerCase()}`);
  }

  /** Handles a Telegram update (webhook body): `/start CODE` links the chat. */
  async telegramUpdate(update: { readonly message?: { readonly chat?: { readonly id?: number }; readonly text?: string } }): Promise<void> {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim() ?? "";
    if (typeof chatId !== "number") return;
    const match = /^\/start\s+(LYK-[0-9A-F]{8})$/u.exec(text);
    if (!match) {
      await this.telegramSend(chatId, "Hi, I'm Lyko. Open Lykia → Alerts → Link Telegram, then send me the /start code it shows.");
      return;
    }
    const doc = await this.links().get(`code:${match[1]}`);
    const data = doc?.value as { owner?: string; expiresAt?: string } | undefined;
    if (!data?.owner || !data.expiresAt || Date.parse(data.expiresAt) < this.ctx.clock.now()) {
      await this.telegramSend(chatId, "That code has expired. Ask Lykia for a new one.");
      return;
    }
    await this.links().put(`owner:${data.owner.toLowerCase()}`, { chatId } as unknown as JsonValue);
    await this.links().delete(`code:${match[1]}`);
    await this.telegramSend(chatId, `Linked to ${data.owner.slice(0, 6)}…${data.owner.slice(-4)}. I'll bark here when an alert fires.`);
  }

  private async telegramNotify(owner: Address, text: string): Promise<void> {
    const doc = await this.links().get(`owner:${owner.toLowerCase()}`);
    const chatId = (doc?.value as { chatId?: number } | undefined)?.chatId;
    if (typeof chatId === "number") await this.telegramSend(chatId, text);
  }

  private async telegramSend(chatId: number, text: string): Promise<void> {
    const token = this.botToken;
    if (!token) return;
    await this.ctx.fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(8000) });
  }

  /** Points the bot's webhook at this API (admin action). */
  async telegramSetup(publicApiUrl: string, secret: string): Promise<{ ok: boolean; description?: string }> {
    const token = this.botToken;
    if (!token) throw new LykiaHttpError("INVALID_REQUEST", 400, "Set TELEGRAM_BOT_TOKEN first.");
    const res = await this.ctx.fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `${publicApiUrl.replace(/\/$/u, "")}/v1/telegram/webhook`, secret_token: secret, allowed_updates: ["message"] }), signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return { ok: body.ok === true, ...(body.description ? { description: body.description } : {}) };
  }
}

const instances = new WeakMap<AppContext, AlertsService>();
export function alertsService(ctx: AppContext): AlertsService {
  let s = instances.get(ctx);
  if (!s) {
    s = new AlertsService(ctx);
    instances.set(ctx, s);
  }
  return s;
}

/**
 * First block of a transfer scan: just after the saved cursor, else the last
 * 500 blocks, never further back than 9,000 (the public RPC's log window).
 * Kept as a function so static file tracers do not try to fold the bigint
 * arithmetic at build time.
 */
function scanStart(cursorBlock: string | undefined, head: bigint): bigint {
  const floor = head - 9_000n;
  const from = cursorBlock ? BigInt(cursorBlock) + 1n : head - 500n;
  return from < floor ? floor : from;
}
