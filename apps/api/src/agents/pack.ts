/**
 * The Pack service: the agent tree in the store.
 *
 * Root agents belong to an owner. Spawning checks, in order: the parent is
 * active and may spawn, the depth and fan-out limits, the child's Fence is
 * inside the parent's (core `subFenceViolations`), and the child's budget
 * fits in what the parent has free (core `carveBudget`, where "allocated"
 * is the sum of the parent's active children). Spend is recorded against
 * the agent and every ancestor. Revoking cascades to the whole subtree and
 * frees the allocation at once.
 */
import {
  MAX_CHILDREN,
  MAX_PACK_DEPTH,
  PACK_SCHEMA,
  addBudget,
  ancestorIds,
  budgetOf,
  carveBudget,
  fenceHash,
  formatUsdMicros,
  freeBudget,
  intersectFence,
  roleTemplate,
  subFenceViolations,
  subtreeIds,
  usdMicros,
  validateFence,
  type Address,
  type ArcEnvironment,
  type Fence,
  type PackAgent,
  type PackBudget,
  type PackCapability,
  type PackRole,
} from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";
import { randomHex } from "../platform/crypto.js";

export interface CreateAgentInput {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly name: string;
  readonly role: PackRole;
  readonly fence?: Fence;
  readonly mission?: string;
  readonly signer?: Address;
  readonly agentId?: string;
}

export type SpawnInput = Omit<CreateAgentInput, "owner" | "environment">;

export interface PackEvents {
  spawned?(agent: PackAgent): void;
  revoked?(agents: readonly PackAgent[]): void;
}

function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function weekOf(now: number): string {
  return String(Math.floor(now / (7 * 86_400_000)));
}

export class PackService {
  constructor(private readonly ctx: AppContext, private readonly events: PackEvents = {}) {}

  private agents() {
    return typedCollection<PackAgent>(this.ctx, "pack_agents");
  }

  private spend() {
    return this.ctx.store.counters("pack_spend");
  }

  async get(id: string): Promise<PackAgent> {
    const doc = await this.agents().get(id);
    if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, `No Pack agent ${id}.`);
    return doc.value;
  }

  async ownedBy(owner: string, environment?: ArcEnvironment): Promise<PackAgent[]> {
    const who = owner.toLowerCase();
    return (await this.agents().list({ prefix: `${who}:`, limit: 1000 })).map((d) => d.value).filter((a) => !environment || a.environment === environment);
  }

  private fenceFor(role: PackRole, fence: Fence | undefined, parent: Fence | null): Fence {
    const template = roleTemplate(role);
    let chosen: Fence;
    if (fence) {
      const checked = validateFence(fence);
      if (!checked.ok) throw new LykiaHttpError("INVALID_FENCE", 400, "The Fence document is invalid.", { issues: checked.issues.slice(0, 20) });
      chosen = checked.fence;
    } else if (template) chosen = parent ? intersectFence(parent, template.fence, template.title.en) : template.fence;
    else if (parent) chosen = parent;
    else throw new LykiaHttpError("INVALID_REQUEST", 400, "A custom agent needs a Fence.");
    return chosen;
  }

  private capabilitiesFor(role: PackRole, parent: PackAgent | null, depth: number): PackCapability[] {
    const base: readonly PackCapability[] = roleTemplate(role)?.capabilities ?? ["read", "propose", "spawn"];
    return base.filter((c) => c !== "spawn" || ((parent === null || parent.capabilities.includes("spawn")) && depth + 1 < MAX_PACK_DEPTH));
  }

  private async put(agent: PackAgent): Promise<void> {
    await this.agents().put(agent.id, agent);
  }

  private newId(owner: string): string {
    return `${owner.toLowerCase()}:agt_${randomHex(6)}`;
  }

  async create(input: CreateAgentInput): Promise<PackAgent> {
    const fence = this.fenceFor(input.role, input.fence, null);
    const agent: PackAgent = {
      schema: PACK_SCHEMA,
      id: this.newId(input.owner),
      owner: input.owner.toLowerCase() as Address,
      environment: input.environment,
      parentId: null,
      depth: 0,
      name: input.name,
      role: input.role,
      capabilities: this.capabilitiesFor(input.role, null, 0),
      fence,
      fenceHash: fenceHash(fence),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.signer ? { signer: input.signer } : {}),
      ...(input.mission ? { mission: input.mission } : {}),
      status: "active",
      createdAt: new Date(this.ctx.clock.now()).toISOString(),
    };
    await this.put(agent);
    this.events.spawned?.(agent);
    return agent;
  }

  /** What the agent's active children hold. */
  async allocated(agent: PackAgent): Promise<PackBudget> {
    const children = (await this.ownedBy(agent.owner)).filter((a) => a.parentId === agent.id && a.status !== "revoked");
    return children.reduce<PackBudget>((sum, child) => addBudget(sum, budgetOf(child.fence)), {});
  }

  async spawn(parentId: string, input: SpawnInput): Promise<PackAgent> {
    const parent = await this.get(parentId);
    if (parent.status !== "active") throw new LykiaHttpError("CONFLICT", 409, `${parent.name} is ${parent.status}; it cannot spawn.`);
    if (!parent.capabilities.includes("spawn")) throw new LykiaHttpError("FORBIDDEN", 403, `${parent.name} (${parent.role}) may not spawn sub-agents.`);
    if (parent.depth + 1 >= MAX_PACK_DEPTH) throw new LykiaHttpError("CONFLICT", 409, `The Pack is at most ${MAX_PACK_DEPTH} levels deep.`);
    const siblings = (await this.ownedBy(parent.owner)).filter((a) => a.parentId === parent.id && a.status !== "revoked");
    if (siblings.length >= MAX_CHILDREN) throw new LykiaHttpError("CONFLICT", 409, `${parent.name} already has ${MAX_CHILDREN} sub-agents.`);
    const fence = this.fenceFor(input.role, input.fence, parent.fence);
    const violations = subFenceViolations(parent.fence, fence);
    if (violations.length > 0) throw new LykiaHttpError("SUB_FENCE_VIOLATION", 422, "A sub-agent's Fence must sit inside its parent's.", { violations });
    const carve = carveBudget({ caps: budgetOf(parent.fence), allocated: await this.allocated(parent) }, budgetOf(fence));
    if (!carve.ok) throw new LykiaHttpError("BUDGET_EXCEEDED", 422, `${parent.name} does not have that much budget free.`, { violations: carve.violations, free: carve.remaining });
    const depth = parent.depth + 1;
    const child: PackAgent = {
      schema: PACK_SCHEMA,
      id: this.newId(parent.owner),
      owner: parent.owner,
      environment: parent.environment,
      parentId: parent.id,
      depth,
      name: input.name,
      role: input.role,
      capabilities: this.capabilitiesFor(input.role, parent, depth),
      fence,
      fenceHash: fenceHash(fence),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.signer ? { signer: input.signer } : {}),
      ...(input.mission ? { mission: input.mission } : {}),
      status: "active",
      createdAt: new Date(this.ctx.clock.now()).toISOString(),
    };
    await this.put(child);
    this.events.spawned?.(child);
    return child;
  }

  /** Revokes the agent and its whole subtree. Returns every agent that changed. */
  async revoke(id: string, owner: string): Promise<PackAgent[]> {
    const agent = await this.get(id);
    if (agent.owner !== owner.toLowerCase()) throw new LykiaHttpError("FORBIDDEN", 403, "Only the owner revokes Pack agents.");
    const all = await this.ownedBy(agent.owner);
    const ids = new Set(subtreeIds(all, id));
    const at = new Date(this.ctx.clock.now()).toISOString();
    const changed: PackAgent[] = [];
    for (const a of all) {
      if (!ids.has(a.id) || a.status === "revoked") continue;
      const next: PackAgent = { ...a, status: "revoked", revokedAt: at };
      await this.put(next);
      changed.push(next);
    }
    if (changed.length > 0) this.events.revoked?.(changed);
    return changed;
  }

  async setStatus(id: string, owner: string, status: "active" | "paused"): Promise<PackAgent> {
    const agent = await this.get(id);
    if (agent.owner !== owner.toLowerCase()) throw new LykiaHttpError("FORBIDDEN", 403, "Only the owner changes Pack agents.");
    if (agent.status === "revoked") throw new LykiaHttpError("CONFLICT", 409, "A revoked agent stays revoked.");
    const next = { ...agent, status };
    await this.put(next);
    return next;
  }

  async bindSession(id: string, session: NonNullable<PackAgent["session"]>): Promise<PackAgent> {
    const agent = await this.get(id);
    const next = { ...agent, session };
    await this.put(next);
    return next;
  }

  /** Counts spend against the agent and every ancestor (for daily and weekly caps). */
  async recordSpend(id: string, usd: string): Promise<void> {
    const agent = await this.get(id);
    const all = await this.ownedBy(agent.owner);
    const now = this.ctx.clock.now();
    const micros = Number(usdMicros(usd));
    for (const target of [id, ...ancestorIds(all, id)]) {
      await this.spend().increment(`${target}:d:${dayOf(now)}`, micros, { ttlMs: 2 * 86_400_000 });
      await this.spend().increment(`${target}:w:${weekOf(now)}`, micros, { ttlMs: 15 * 86_400_000 });
    }
  }

  async spent(id: string): Promise<{ readonly dayUsd: string; readonly weekUsd: string }> {
    const now = this.ctx.clock.now();
    const day = await this.spend().get(`${id}:d:${dayOf(now)}`);
    const week = await this.spend().get(`${id}:w:${weekOf(now)}`);
    return { dayUsd: formatUsdMicros(BigInt(day)), weekUsd: formatUsdMicros(BigInt(week)) };
  }

  async view(id: string): Promise<PackAgentView> {
    const agent = await this.get(id);
    const all = await this.ownedBy(agent.owner);
    const allocated = await this.allocated(agent);
    const caps = budgetOf(agent.fence);
    return {
      ...agent,
      budget: { caps, allocated, free: freeBudget({ caps, allocated }), spent: await this.spent(id) },
      children: all.filter((a) => a.parentId === agent.id).map((a) => a.id),
    };
  }

  async tree(owner: string, environment?: ArcEnvironment): Promise<PackAgentView[]> {
    const agents = await this.ownedBy(owner, environment);
    return Promise.all(agents.map((a) => this.view(a.id)));
  }
}

/**
 * What anyone may see of an agent without proving control of its owner:
 * the facts a chain explorer also shows (ids, role and capabilities, the
 * Fence hash a session or Tag pins, the signer and session, status, tree
 * shape). Names, missions, Fences and budgets stay private.
 */
export function publicPackView(agent: PackAgentView) {
  return {
    id: agent.id,
    owner: agent.owner,
    environment: agent.environment,
    parentId: agent.parentId,
    depth: agent.depth,
    role: agent.role,
    capabilities: agent.capabilities,
    fenceHash: agent.fenceHash,
    ...(agent.agentId ? { agentId: agent.agentId } : {}),
    ...(agent.signer ? { signer: agent.signer } : {}),
    ...(agent.session ? { session: agent.session } : {}),
    status: agent.status,
    createdAt: agent.createdAt,
    ...(agent.revokedAt ? { revokedAt: agent.revokedAt } : {}),
    children: agent.children,
    redacted: true as const,
  };
}
