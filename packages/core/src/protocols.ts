/**
 * The venue registry: every protocol Lykia knows on Arc, where it lives,
 * what Lykia can do with it, and how its addresses were established. Rows
 * are plain data (protocolData.ts) validated at load. A venue is
 * `executable` only when the engine has an adapter for its verbs.
 */
import { isAddress, type Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";
import type { StepKind } from "./intent.js";
import { PROTOCOL_ROWS } from "./protocolData.js";
import { LISTED_PROTOCOL_ROWS } from "./protocolListed.js";

export type ProtocolCategory = "circle" | "lending" | "dex" | "vault" | "fx" | "bridge" | "agent" | "oracle" | "infra" | "launchpad" | "perps";

export type DeploymentStatus = "live" | "testnet-live" | "announced" | "unverified";

export interface ProtocolDeployment {
  readonly status: DeploymentStatus;
  readonly contracts: Readonly<Record<string, Address>>;
  /** How the addresses were established (eth_getCode date, docs page). */
  readonly evidence: string;
}

export interface ProtocolDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: ProtocolCategory;
  readonly summary: string;
  readonly website?: string;
  readonly docs?: string;
  readonly deployments: Readonly<Partial<Record<ArcEnvironment, ProtocolDeployment>>>;
  /** Step kinds Lykia's engine can execute through this venue. */
  readonly verbs: readonly StepKind[];
  readonly tags?: readonly string[];
}

export interface ProtocolIssue {
  readonly id: string;
  readonly message: string;
}

export function validateProtocols(rows: readonly ProtocolDescriptor[]): ProtocolIssue[] {
  const issues: ProtocolIssue[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!/^[a-z0-9-]{2,48}$/u.test(row.id)) issues.push({ id: row.id, message: "id must be kebab-case." });
    if (ids.has(row.id)) issues.push({ id: row.id, message: "Duplicate id." });
    ids.add(row.id);
    for (const [env, deployment] of Object.entries(row.deployments)) {
      if (!deployment) continue;
      if (env === "testnet" && deployment.status === "live") issues.push({ id: row.id, message: "Testnet deployments use testnet-live." });
      if (env === "mainnet" && deployment.status === "testnet-live") issues.push({ id: row.id, message: "Mainnet deployments use live." });
      for (const [name, address] of Object.entries(deployment.contracts)) if (!isAddress(address)) issues.push({ id: row.id, message: `${env}.${name} is not an address.` });
      if ((deployment.status === "live" || deployment.status === "testnet-live") && deployment.evidence.trim().length === 0) issues.push({ id: row.id, message: `${env} needs evidence.` });
    }
  }
  return issues;
}

const ALL_ROWS = [...PROTOCOL_ROWS, ...LISTED_PROTOCOL_ROWS];
const ISSUES = validateProtocols(ALL_ROWS);
if (ISSUES.length > 0) throw new Error(`Invalid protocol registry: ${ISSUES.map((i) => `${i.id}: ${i.message}`).join("; ")}`);

export const PROTOCOLS: readonly ProtocolDescriptor[] = Object.freeze(ALL_ROWS);

export function getProtocol(id: string): ProtocolDescriptor | null {
  return PROTOCOLS.find((p) => p.id === id) ?? null;
}

export function protocolsFor(environment: ArcEnvironment): ProtocolDescriptor[] {
  return PROTOCOLS.filter((p) => p.deployments[environment] !== undefined);
}

export function isLive(protocol: ProtocolDescriptor, environment: ArcEnvironment): boolean {
  const status = protocol.deployments[environment]?.status;
  return status === "live" || status === "testnet-live";
}

/** Venues that can execute `kind` on `environment` given the engine's adapters. */
export function capableProtocols(kind: StepKind, environment: ArcEnvironment, executable?: ReadonlySet<string>): ProtocolDescriptor[] {
  return PROTOCOLS.filter((p) => p.verbs.includes(kind) && isLive(p, environment) && (executable === undefined || executable.has(p.id)));
}

export function countByCategory(environment?: ArcEnvironment): Record<ProtocolCategory, number> {
  const counts = { circle: 0, lending: 0, dex: 0, vault: 0, fx: 0, bridge: 0, agent: 0, oracle: 0, infra: 0, launchpad: 0, perps: 0 } as Record<ProtocolCategory, number>;
  for (const p of environment ? protocolsFor(environment) : PROTOCOLS) counts[p.category] += 1;
  return counts;
}

/** Which registry contract lives at an address. */
export function protocolsAt(address: string, environment: ArcEnvironment): { readonly protocol: ProtocolDescriptor; readonly name: string }[] {
  const lower = address.toLowerCase();
  const out: { protocol: ProtocolDescriptor; name: string }[] = [];
  for (const protocol of PROTOCOLS) {
    for (const [name, a] of Object.entries(protocol.deployments[environment]?.contracts ?? {})) if (a.toLowerCase() === lower) out.push({ protocol, name });
  }
  return out;
}
