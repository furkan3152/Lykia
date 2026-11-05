/**
 * Projects: white-label Lykia for third-party apps (spec in
 * @lykia/core/project). A developer owns up to MAX_PROJECTS projects; each
 * has origins proven by DNS TXT or a /.well-known file, publishable keys
 * bound to those origins, a default Fence with hard caps, an integrator fee
 * paid on chain beside Lykia's fee, a webhook and per-project usage.
 */
import { resolveTxt } from "node:dns/promises";
import type { Request } from "express";
import {
  DOMAIN_PROOF_PREFIX,
  WELL_KNOWN_PROOF_PATH,
  buildProject,
  dnsProofName,
  leagueSlug,
  publicProject,
  validateProjectInput,
  type IntegratorFeePolicy,
  type OriginProofMethod,
  type Project,
  type ProjectInput,
  type ProjectPublicView,
} from "@lykia/core";
import type { CreatedApiKey } from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { assertPublicUrl, type HostResolver } from "../http/netguard.js";
import { hmacHex, purposeKey, randomHex } from "./crypto.js";
import { dayKey } from "./gate.js";
import { createKey } from "./keys.js";
import { typedCollection } from "./typed.js";

const MAX_PROJECTS_PER_DEVELOPER = 10;
const PROJECT_ID_PATTERN = /^prj_[a-z0-9]{12}$/u;

const projects = (ctx: AppContext) => typedCollection<Project>(ctx, "projects");

/** Seams for tests: TXT lookups and the host resolver used before fetching a /.well-known file. */
interface ProofDeps {
  readonly txt: (name: string) => Promise<string[][]>;
  readonly resolve?: HostResolver;
}
const PROOF_DEPS = new WeakMap<AppContext, ProofDeps>();

export function setProjectProofDeps(ctx: AppContext, deps: ProofDeps): void {
  PROOF_DEPS.set(ctx, deps);
}

function proofDeps(ctx: AppContext): ProofDeps {
  return PROOF_DEPS.get(ctx) ?? { txt: (name) => resolveTxt(name) };
}

function issuesError(issues: readonly { path: string; message: string }[]): LykiaHttpError {
  return new LykiaHttpError("INVALID_REQUEST", 400, `Invalid project: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, { issues });
}

/** Every slug in use (a project's own, or its League listing's), except the given project's. */
export async function takenSlugs(ctx: AppContext, except?: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const d of await projects(ctx).list({ limit: 10_000 })) {
    if (d.value.id === except) continue;
    if (d.value.slug) out.add(d.value.slug);
    if (d.value.league?.slug) out.add(d.value.league.slug);
  }
  return out;
}

/** A free slug from a name: "acme-pay", then "acme-pay-2", "acme-pay-3"... */
function freeSlug(name: string, taken: ReadonlySet<string>): string {
  const base = leagueSlug(name);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const next = `${base.slice(0, 24 - String(i).length - 1).replace(/-+$/u, "")}-${i}`;
    if (!taken.has(next)) return next;
  }
  return `city-${randomHex(4)}`;
}

export async function createProject(ctx: AppContext, owner: string, input: ProjectInput): Promise<Project> {
  const issues = validateProjectInput(input);
  if (issues.length > 0) throw issuesError(issues);
  const who = owner.toLowerCase();
  const mine = (await projects(ctx).list({ limit: 1000 })).filter((d) => d.value.owner === who);
  if (mine.length >= MAX_PROJECTS_PER_DEVELOPER) throw new LykiaHttpError("PROJECT_LIMIT", 409, `At most ${MAX_PROJECTS_PER_DEVELOPER} projects per developer.`);
  const taken = await takenSlugs(ctx);
  if (input.slug && taken.has(input.slug)) throw new LykiaHttpError("SLUG_TAKEN", 409, `Another city already uses "${input.slug}".`);
  const slug = input.slug ?? freeSlug(input.name, taken);
  const project = autoVerifyLocal(buildProject(`prj_${randomHex(6)}`, who, { ...input, slug }, new Date(ctx.clock.now()).toISOString()), ctx);
  await projects(ctx).put(project.id, project);
  forgetProjectOrigins(ctx);
  return project;
}

/** Local development origins need no proof. */
function autoVerifyLocal(project: Project, ctx: AppContext): Project {
  const now = new Date(ctx.clock.now()).toISOString();
  return { ...project, origins: project.origins.map((o) => (!o.verified && isLocal(o.origin) ? { ...o, verified: true, method: "localhost" as OriginProofMethod, verifiedAt: now } : o)) };
}

function isLocal(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export async function listProjects(ctx: AppContext, owner: string): Promise<Project[]> {
  const who = owner.toLowerCase();
  return (await projects(ctx).list({ limit: 1000 })).map((d) => d.value).filter((p) => p.owner === who);
}

export async function getProject(ctx: AppContext, id: string): Promise<Project | null> {
  if (!PROJECT_ID_PATTERN.test(id)) return null;
  return (await projects(ctx).get(id))?.value ?? null;
}

export async function ownProject(ctx: AppContext, owner: string, id: string): Promise<Project> {
  const project = await getProject(ctx, id);
  if (!project || project.owner !== owner.toLowerCase()) throw new LykiaHttpError("NOT_FOUND", 404, "No such project.");
  return project;
}

/** A partial update: fields left out keep their value. The name is required by the schema, so it defaults to the current one. */
export async function updateProject(ctx: AppContext, owner: string, id: string, patch: Partial<ProjectInput>): Promise<Project> {
  const previous = await ownProject(ctx, owner, id);
  const input: ProjectInput = { ...patch, name: patch.name ?? previous.name };
  const issues = validateProjectInput(input);
  if (issues.length > 0) throw issuesError(issues);
  if (input.slug && input.slug !== previous.slug) {
    if ((await takenSlugs(ctx, previous.id)).has(input.slug)) throw new LykiaHttpError("SLUG_TAKEN", 409, `Another city already uses "${input.slug}".`);
    if (previous.league?.status === "official") throw new LykiaHttpError("ALREADY_OFFICIAL", 409, "An official city keeps its address.");
  }
  const built = autoVerifyLocal(buildProject(previous.id, previous.owner, input, new Date(ctx.clock.now()).toISOString(), previous), ctx);
  // The League listing follows the project's address.
  const next: Project = built.league && built.slug && built.league.slug !== built.slug ? { ...built, league: { ...built.league, slug: built.slug } } : built;
  await projects(ctx).put(next.id, next);
  forgetProjectOrigins(ctx);
  return next;
}

export async function deleteProject(ctx: AppContext, owner: string, id: string): Promise<{ deleted: true }> {
  await ownProject(ctx, owner, id);
  await projects(ctx).delete(id);
  forgetProjectOrigins(ctx);
  return { deleted: true };
}

/** The token a developer publishes to prove they control an origin. Deterministic per project and origin. */
export function originToken(ctx: AppContext, projectId: string, origin: string): string {
  return hmacHex(purposeKey(ctx, "project"), `${projectId}:${origin}`).slice(0, 40);
}

export interface OriginChallenge {
  readonly origin: string;
  readonly token: string;
  readonly dns: { readonly name: string; readonly type: "TXT"; readonly value: string };
  readonly wellKnown: { readonly url: string; readonly body: string };
}

export function originChallenge(ctx: AppContext, project: Project, origin: string): OriginChallenge {
  if (!project.origins.some((o) => o.origin === origin)) throw new LykiaHttpError("NOT_FOUND", 404, "Add this origin to the project first.");
  const token = originToken(ctx, project.id, origin);
  const value = `${DOMAIN_PROOF_PREFIX}${token}`;
  return { origin, token, dns: { name: dnsProofName(origin), type: "TXT", value }, wellKnown: { url: `${origin}${WELL_KNOWN_PROOF_PATH}`, body: value } };
}

/** Checks the DNS TXT record or the /.well-known file and marks the origin verified. */
export async function verifyOrigin(ctx: AppContext, owner: string, id: string, origin: string, method: "dns" | "well-known"): Promise<Project> {
  const project = await ownProject(ctx, owner, id);
  const challenge = originChallenge(ctx, project, origin);
  const deps = proofDeps(ctx);
  let found: boolean;
  if (method === "dns") {
    const records = await deps.txt(challenge.dns.name).catch(() => [] as string[][]);
    found = records.some((parts) => parts.join("").trim() === challenge.dns.value);
  } else {
    const url = await assertPublicUrl(challenge.wellKnown.url, "origin", deps.resolve);
    if (url.protocol !== "https:") throw new LykiaHttpError("INVALID_REQUEST", 400, "A /.well-known proof needs an https origin.");
    const res = await ctx.fetch(url.toString(), { method: "GET", redirect: "error", signal: AbortSignal.timeout(5_000) } as RequestInit).catch(() => null);
    const body = res && res.ok ? (await res.text()).slice(0, 4_096) : "";
    found = body.split(/\r?\n/u).some((line) => line.trim() === challenge.wellKnown.body);
  }
  if (!found) {
    const where = method === "dns" ? `a TXT record at ${challenge.dns.name}` : challenge.wellKnown.url;
    throw new LykiaHttpError("ORIGIN_NOT_PROVEN", 422, `The proof was not found at ${where}. Publish "${challenge.dns.value}" and try again.`, { challenge });
  }
  const now = new Date(ctx.clock.now()).toISOString();
  const next: Project = { ...project, origins: project.origins.map((o) => (o.origin === origin ? { origin, verified: true, method, verifiedAt: now } : o)), updatedAt: now };
  await projects(ctx).put(next.id, next);
  forgetProjectOrigins(ctx);
  return next;
}

export function verifiedOrigins(project: Project): string[] {
  return project.origins.filter((o) => o.verified).map((o) => o.origin);
}

/** A browser key for the project. Its origins are the project's verified origins, read at every request. */
export async function createProjectKey(ctx: AppContext, owner: string, id: string, label: string): Promise<CreatedApiKey> {
  const project = await ownProject(ctx, owner, id);
  if (verifiedOrigins(project).length === 0) throw new LykiaHttpError("ORIGIN_NOT_PROVEN", 409, "Verify at least one origin before issuing a browser key.");
  return createKey(ctx, { owner, label, kind: "publishable", scopes: ["read", "plan"], projectId: project.id });
}

/* ------------------------------------------------------------ requests */

const PROJECTS = new WeakMap<Request, Project>();

export function attachProject(req: Request, project: Project): void {
  PROJECTS.set(req, project);
}

/** The project of the request's publishable key, if any. */
export function projectOf(req: Request): Project | null {
  return PROJECTS.get(req) ?? null;
}

/** The integrator fee a project's plans pay, or undefined. */
export function integratorFeeOf(project: Project | null): IntegratorFeePolicy | undefined {
  if (!project || project.fee.bps <= 0 || !project.fee.recipient) return undefined;
  return { bps: project.fee.bps, recipient: project.fee.recipient, projectId: project.id };
}

export function publicView(project: Project): ProjectPublicView {
  return publicProject(project);
}

/* ------------------------------------------------------------ usage */

export type ProjectMetric = "requests" | "plans";

export async function countProject(ctx: AppContext, projectId: string, metric: ProjectMetric): Promise<void> {
  await ctx.store.counters(`project_${metric}`).increment(`${projectId}:${dayKey(ctx.clock.now())}`, 1, { ttlMs: 32 * 86_400_000 });
}

export interface ProjectUsage {
  readonly projectId: string;
  readonly today: { readonly requests: number; readonly plans: number };
  readonly last7Days: readonly { readonly day: string; readonly requests: number; readonly plans: number }[];
}

export async function projectUsage(ctx: AppContext, owner: string, id: string): Promise<ProjectUsage> {
  await ownProject(ctx, owner, id);
  const now = ctx.clock.now();
  const requests = ctx.store.counters("project_requests");
  const plans = ctx.store.counters("project_plans");
  const days: { day: string; requests: number; plans: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = dayKey(now - i * 86_400_000);
    days.push({ day, requests: await requests.get(`${id}:${day}`), plans: await plans.get(`${id}:${day}`) });
  }
  const last = days[days.length - 1] ?? { requests: 0, plans: 0 };
  return { projectId: id, today: { requests: last.requests, plans: last.plans }, last7Days: days };
}

/* ------------------------------------------------------------ webhook */

export async function saveProject(ctx: AppContext, project: Project): Promise<Project> {
  await projects(ctx).put(project.id, project);
  return project;
}

/* ------------------------------------------------------------ CORS + embeds */

const ORIGIN_CACHE = new WeakMap<AppContext, { readonly at: number; readonly origins: ReadonlySet<string> }>();
const ORIGIN_CACHE_MS = 30_000;

/** Every verified origin of every project, cached briefly: CORS admits these. */
export async function isProjectOrigin(ctx: AppContext, origin: string): Promise<boolean> {
  const now = ctx.clock.now();
  let cached = ORIGIN_CACHE.get(ctx);
  if (!cached || now - cached.at > ORIGIN_CACHE_MS) {
    const all = (await projects(ctx).list({ limit: 10_000 })).flatMap((d) => verifiedOrigins(d.value));
    cached = { at: now, origins: new Set(all) };
    ORIGIN_CACHE.set(ctx, cached);
  }
  return cached.origins.has(origin);
}

/** Drops the CORS cache (after an origin is verified or a project deleted). */
export function forgetProjectOrigins(ctx: AppContext): void {
  ORIGIN_CACHE.delete(ctx);
}
