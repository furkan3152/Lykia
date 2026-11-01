/**
 * Alerts: rules an owner arms; a checker evaluates them and delivers each
 * firing to the in-app inbox, the owner's developer webhooks (`alert.fired`)
 * and Telegram when a chat is linked. Alerts never move value.
 */
import type { Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";

export const ALERT_KINDS = ["price-above", "price-below", "health-below", "transfer-in", "transfer-out", "scent-warning", "order-filled"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_CHANNELS = ["inbox", "webhook", "telegram"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export interface AlertRule {
  readonly id: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly kind: AlertKind;
  /** price alerts: "EURC" or "cirBTC" (priced by Chainlink); transfer alerts: "USDC" or "EURC". */
  readonly token?: string;
  /** Decimal string: USD price, health factor, or whole tokens for transfers. */
  readonly threshold?: string;
  readonly channels: readonly AlertChannel[];
  readonly cooldownSeconds: number;
  readonly createdAt: string;
  readonly lastFiredAt: string | null;
  /** Transfer alerts: last block already scanned. */
  readonly cursorBlock?: string;
  readonly paused: boolean;
}

export interface AlertFiring {
  readonly id: string;
  readonly ruleId: string;
  readonly owner: Address;
  readonly kind: AlertKind;
  readonly title: string;
  readonly body: string;
  readonly at: string;
  readonly read: boolean;
  readonly link?: string;
}

export const ALERT_LIMITS = Object.freeze({ perOwner: 50, minCooldownSeconds: 60, defaultCooldownSeconds: 900 });

/** One-line description for lists. */
export function describeAlert(rule: Pick<AlertRule, "kind" | "token" | "threshold">): string {
  switch (rule.kind) {
    case "price-above":
      return `${rule.token} above $${rule.threshold}`;
    case "price-below":
      return `${rule.token} below $${rule.threshold}`;
    case "health-below":
      return `Any health factor below ${rule.threshold}`;
    case "transfer-in":
      return `Incoming ${rule.token} transfers of ${rule.threshold} or more`;
    case "transfer-out":
      return `Outgoing ${rule.token} transfers of ${rule.threshold} or more`;
    case "scent-warning":
      return "A token in the flock smells off (look-alike or unverified)";
    case "order-filled":
      return "A conditional order executed";
  }
}
