/**
 * The adapter registry: submitted manifests and their review state, kept in
 * the store (`adapters` collection), so an approved adapter reaches every
 * serverless instance without a redeploy.
 *
 * Status flow: submitted -> validated (on-chain checks passed) -> approved
 * (a Lykia admin) -> routable (the route search and the aggregator may pick
 * it). rejected and suspended take it out. Re-submitting a manifest resets
 * it to submitted, so a changed manifest is always validated again.
 *
 * Routable manifests are cached per context for ROUTABLE_CACHE_MS; a status
 * change clears the cache on the instance that made it, and other instances
 * pick it up within the TTL.
 */
import { ADAPTER_SPEC_VERSION, adapterTransition, PROTOCOLS, validateAdapterManifest, type AdapterManifest, type AdapterRecord, type AdapterStatus, type AdapterValidation, type Address, type ArcEnvironment } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { typedCollection } from "../platform/typed.js";
import { abiFunction, adapterKnowledge, contractsOf, manifestAbi } from "./runtime.js";

export const ROUTABLE_CACHE_MS = 30_000;
const COLLECTION = "adapters";

const CACHE = new WeakMap<AppContext, { at: number; list: AdapterRecord[] }>();

function col(ctx: AppContext) {
  return typedCollection<AdapterRecord>(ctx, COLLECTION);
}

/** Structural issues plus ABI parsing; [] when the manifest is well formed. */
export function manifestIssues(input: unknown): { path: string; message: string }[] {
  const issues = validateAdapterManifest(input, { reservedIds: PROTOCOLS.map((p) => p.id) });
  if (issues.length > 0) return issues;
  const manifest = input as AdapterManifest;
  const parsed = manifestAbi(manifest);
  if (!parsed.abi) return [{ path: "abi", message: `The ABI does not parse: ${parsed.error}` }];
  for (const [i, c] of manifest.capabilities.entries()) {
    const fn = abiFunction(parsed.abi, c.function);
    if (!fn) issues.push({ path: `capabilities.${i}.function`, message: `${c.function} is not a function of the ABI.` });
    else if (fn.stateMutability === "view" || fn.stateMutability === "pure") issues.push({ path: `capabilities.${i}.function`, message: `${fn.name} is ${fn.stateMutability}: a capability must change state.` });
    else if (fn.inputs.length !== c.args.length) issues.push({ path: `capabilities.${i}.args`, message: `${fn.name} takes ${fn.inputs.length} arguments; ${c.args.length} are given.` });
  }
  for (const [i, r] of manifest.reads.entries()) {
    const fn = abiFunction(parsed.abi, r.function);
    if (!fn) issues.push({ path: `reads.${i}.function`, message: `${r.function} is not a function of the ABI.` });
    else if (fn.stateMutability !== "view" && fn.stateMutability !== "pure") issues.push({ path: `reads.${i}.function`, message: `${fn.name} must be view or pure.` });
    else if (fn.inputs.length !== r.args.length) issues.push({ path: `reads.${i}.args`, message: `${fn.name} takes ${fn.inputs.length} arguments; ${r.args.length} are given.` });
    else if (fn.outputs.length === 0 || !/^u?int/u.test(fn.outputs[0]!.type)) issues.push({ path: `reads.${i}.function`, message: `${fn.name} must return an integer first.` });
  }
  return issues;
}

export function forgetRoutable(ctx: AppContext): void {
  CACHE.delete(ctx);
}

export async function getAdapter(ctx: AppContext, id: string): Promise<AdapterRecord | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/u.test(id)) return null;
  return (await col(ctx).get(id))?.value ?? null;
}

export async function listAdapters(ctx: AppContext, filter: { readonly status?: AdapterStatus; readonly submittedBy?: string } = {}): Promise<AdapterRecord[]> {
  const docs = await col(ctx).list({ limit: 1000 });
  return docs.map((d) => d.value).filter((r) => (!filter.status || r.status === filter.status) && (!filter.submittedBy || r.submittedBy.toLowerCase() === filter.submittedBy.toLowerCase()));
}

/** Submit or re-submit a manifest. The submitter of the first version owns the id. */
export async function submitAdapter(ctx: AppContext, manifest: unknown, by: string): Promise<AdapterRecord> {
  const issues = manifestIssues(manifest);
  if (issues.length > 0) throw new LykiaHttpError("INVALID_MANIFEST", 400, `The ${ADAPTER_SPEC_VERSION} manifest is invalid.`, { issues: issues.slice(0, 30) });
  const m = manifest as AdapterManifest;
  const existing = await getAdapter(ctx, m.protocol.id);
  if (existing && existing.submittedBy.toLowerCase() !== by.toLowerCase()) throw new LykiaHttpError("CONFLICT", 409, `${m.protocol.id} was submitted by someone else.`);
  const now = new Date(ctx.clock.now()).toISOString();
  const record: AdapterRecord = {
    id: m.protocol.id,
    status: "submitted",
    manifest: m,
    submittedBy: by,
    submittedAt: existing?.submittedAt ?? now,
    updatedAt: now,
    history: [...(existing?.history ?? []), { at: now, status: "submitted" as const, by }].slice(-50),
  };
  await col(ctx).put(record.id, record);
  forgetRoutable(ctx);
  return record;
}

/** Moves an adapter along the status flow; `role` is who asks. */
export async function setAdapterStatus(ctx: AppContext, id: string, to: AdapterStatus, input: { readonly by: string; readonly role: "owner" | "admin"; readonly note?: string; readonly validation?: AdapterValidation }): Promise<AdapterRecord> {
  const record = await getAdapter(ctx, id);
  if (!record) throw new LykiaHttpError("NOT_FOUND", 404, `No adapter called ${id}.`);
  const needs = adapterTransition(record.status, to);
  if (!needs) throw new LykiaHttpError("CONFLICT", 409, `An adapter that is ${record.status} cannot become ${to}.`);
  if (needs === "admin" && input.role !== "admin") throw new LykiaHttpError("FORBIDDEN", 403, `Only a Lykia admin can make an adapter ${to}.`);
  if (to === "routable" && !record.validation?.ok) throw new LykiaHttpError("CONFLICT", 409, "Validate the adapter on chain before routing it.");
  const now = new Date(ctx.clock.now()).toISOString();
  const next: AdapterRecord = {
    ...record,
    status: to,
    updatedAt: now,
    ...(input.validation ? { validation: input.validation } : {}),
    ...(needs === "admin" ? { review: { by: input.by, at: now, decision: to as "approved" | "rejected" | "routable" | "suspended", ...(input.note ? { note: input.note } : {}) } } : {}),
    history: [...record.history, { at: now, status: to, by: input.by, ...(input.note ? { note: input.note } : {}) }].slice(-50),
  };
  await col(ctx).put(id, next);
  forgetRoutable(ctx);
  return next;
}

/** Stores a validation report without changing the status (a failed validation). */
export async function recordValidation(ctx: AppContext, id: string, validation: AdapterValidation): Promise<AdapterRecord> {
  const record = await getAdapter(ctx, id);
  if (!record) throw new LykiaHttpError("NOT_FOUND", 404, `No adapter called ${id}.`);
  const next = { ...record, validation, updatedAt: new Date(ctx.clock.now()).toISOString() };
  await col(ctx).put(id, next);
  return next;
}

/** Approved and routable adapters (approved ones show in the knowledge model; only routable ones route). */
export async function liveAdapters(ctx: AppContext): Promise<AdapterRecord[]> {
  const now = ctx.clock.now();
  const hit = CACHE.get(ctx);
  if (hit && now - hit.at < ROUTABLE_CACHE_MS) return hit.list;
  let list: AdapterRecord[];
  try {
    list = (await listAdapters(ctx)).filter((r) => r.status === "routable" || r.status === "approved");
  } catch {
    list = hit?.list ?? [];
  }
  CACHE.set(ctx, { at: now, list });
  return list;
}

/** Manifests the engine may route through on `environment`. */
export async function routableManifests(ctx: AppContext, environment: ArcEnvironment): Promise<AdapterManifest[]> {
  return (await liveAdapters(ctx)).filter((r) => r.status === "routable" && contractsOf(r.manifest, environment) !== null).map((r) => r.manifest);
}

/** Knowledge rows for approved and routable adapters. */
export async function adapterRows(ctx: AppContext) {
  return (await liveAdapters(ctx)).map((r) => adapterKnowledge(r.manifest, r.status === "routable"));
}

/** Every contract of a routable adapter on `environment` (the security layer's known contracts). */
export async function adapterContracts(ctx: AppContext, environment: ArcEnvironment): Promise<Address[]> {
  return (await routableManifests(ctx, environment)).flatMap((m) => Object.values(contractsOf(m, environment) ?? {}));
}
