/**
 * The Security center backend. See docs/security/layer.md.
 *
 *   GET  /security/status                      layers, halt, venue breakers, platform hardening (public, no secrets)
 *   GET  /security/audit[?owner&chain&after&limit&format=ndjson]   hash-chained log (the owner, or an admin)
 *   POST /security/halt        { halt, reason }                      admin: global kill switch (`routing.halt`)
 *   PUT  /security/venues/:id  { disabled, reason }                  admin: per-venue breaker
 *   GET  /security/approvals?owner&environment                        stale allowances with one-tap revokes
 *   POST /security/check-address { owner, address, environment }     address protection report
 *   GET  /security/alerts                       the session owner's security alerts
 *   GET  /security/policy  PUT /security/policy  monitor limits and the Auto-Whistle mode
 *   GET  /security/pauses  POST /security/pause  POST /security/resume
 */
import { getProtocol, tokenAddress, TOKENS, type Address, type PackAgent } from "@lykia/core";
import { SECURITY_LAYERS, SECURITY_SPEC_VERSION, type AuditEntry } from "@lykia/core/security/index";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { staleApprovals } from "../agents/insights.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { setFlags } from "../platform/admin.js";
import { mustSession } from "../platform/session.js";
import { typedCollection } from "../platform/typed.js";
import { alertsOf, listPauses, pause, pauseOf, policyOf, resume, setPolicy } from "../security/activity.js";
import { auditRead, auditSafe, ownerChain, PLATFORM_CHAIN } from "../security/audit.js";
import { clearBreakerCache, isHalted, setVenueSwitch, venueBreakers } from "../security/breakers.js";
import { checkRecipient } from "../security/recipients.js";
import { environmentOf, environmentSchema } from "./common.js";

const reason = z.string().trim().min(3).max(200);
const LAYER_NAMES: Record<(typeof SECURITY_LAYERS)[number], string> = {
  simulation: "Pre-sign simulation and balance diff",
  address: "Address protection",
  approvals: "Approval hygiene",
  monitor: "Agent safety monitor",
  breakers: "Protocol circuit breakers",
  platform: "Platform hardening",
};

async function ownsSubject(ctx: AppContext, owner: string, subject: string): Promise<boolean> {
  if (owner.toLowerCase() === subject.toLowerCase()) return true;
  const agents = await typedCollection<PackAgent>(ctx, "pack_agents").list({ limit: 1000 });
  return agents.some((d) => d.value.owner.toLowerCase() === owner.toLowerCase() && (d.value.signer?.toLowerCase() === subject.toLowerCase() || d.value.session?.account.toLowerCase() === subject.toLowerCase()));
}

function platformChecks(ctx: AppContext) {
  return [
    { id: "helmet-csp", ok: true, detail: "Helmet on every response; CSP default-src 'none', frame-ancestors 'none'." },
    { id: "cors", ok: ctx.config.webOrigins.length > 0, detail: `${ctx.config.webOrigins.length} exact web origin(s) plus verified project origins; no wildcard, no credentials.` },
    { id: "siwe", ok: true, detail: "Single-use nonces (10 min), expiry and issuedAt checks, domain bound to the web origins." },
    { id: "rate-limits", ok: true, detail: "Per-IP default, heavy and auth buckets; prepare, submit, halt and sign-in use the stricter ones." },
    { id: "ssrf-guard", ok: true, detail: "Outbound fetches to user-supplied URLs go through the DNS-pinned public-address guard." },
    { id: "admins", ok: ctx.config.platform.adminAddresses.length > 0, detail: `${ctx.config.platform.adminAddresses.length} admin address(es) configured.` },
    { id: "circle-screening", ok: ctx.config.circle.apiKey !== null, detail: ctx.config.circle.apiKey ? "Circle Compliance screening is on." : "Circle Compliance screening is off (no API key)." },
  ];
}

export const securityModule: ApiModule = {
  name: "security",
  register(router, ctx) {
    router.get("/security/status", async (req, res) => {
      const { environment } = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      const env = environmentOf(ctx, environment);
      const [halted, venues] = await Promise.all([isHalted(ctx), venueBreakers(ctx, env)]);
      const blocked = venues.filter((v) => v.state === "blocked").length;
      const degraded = venues.filter((v) => v.state === "degraded").length;
      const checks = platformChecks(ctx);
      const layers = SECURITY_LAYERS.map((id) => ({
        id,
        name: LAYER_NAMES[id],
        status: id === "breakers" ? (halted || blocked > 0 ? "alert" : degraded > 0 ? "degraded" : "active") : id === "platform" ? (checks.every((c) => c.ok) ? "active" : "degraded") : "active",
        detail:
          id === "breakers"
            ? halted
              ? "Routing is halted: only moves that bring value home pass."
              : `${venues.length - blocked - degraded} healthy, ${degraded} degraded, ${blocked} blocked.`
            : id === "simulation"
              ? "Every prepared step is decoded, simulated and diffed against its plan before it is returned."
              : id === "address"
                ? "Look-alikes, poisoning, first-time recipients, the USDC/EURC blocklist, Circle screening and Contract Scent."
                : id === "approvals"
                  ? "Exact approvals only, resets offered for any headroom, stale allowances listed with one-tap revokes."
                  : id === "monitor"
                    ? "Velocity limits, anomaly rules and the Auto-Whistle for every agent and owner."
                    : `${checks.filter((c) => c.ok).length}/${checks.length} checks pass.`,
      }));
      res.json({ schema: SECURITY_SPEC_VERSION, environment: env, halted, layers, venues, platform: checks, at: new Date(ctx.clock.now()).toISOString() });
    });

    router.get("/security/audit", async (req, res) => {
      const q = parseQuery(req, z.object({ owner: evmAddress.optional(), chain: z.enum(["owner", "platform"]).optional(), after: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(1000).optional(), format: z.enum(["json", "ndjson"]).optional() }));
      const session = await mustSession(ctx, req);
      const admin = session.roles.includes("admin");
      let chain: string;
      if (q.chain === "platform") {
        if (!admin) throw new LykiaHttpError("FORBIDDEN", 403, "The platform audit chain is for admins.");
        chain = PLATFORM_CHAIN;
      } else {
        const owner = (q.owner ?? session.address).toLowerCase();
        if (owner !== session.address.toLowerCase() && !admin) throw new LykiaHttpError("FORBIDDEN", 403, "You can read your own audit log only.");
        chain = ownerChain(owner);
      }
      const page = await auditRead(ctx, chain, { ...(q.after !== undefined ? { after: q.after } : {}), ...(q.limit ? { limit: q.limit } : {}) });
      if (q.format === "ndjson") {
        res.setHeader("Content-Type", "application/x-ndjson");
        res.setHeader("Content-Disposition", `attachment; filename="lykia-audit-${chain.replace(/[^a-z0-9]+/giu, "-")}.ndjson"`);
        res.send(page.entries.map((e: AuditEntry) => JSON.stringify(e)).join("\n") + (page.entries.length > 0 ? "\n" : ""));
        return;
      }
      res.json({ chain, ...page });
    });

    router.post("/security/halt", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req, "admin");
      const body = parseBody(req, z.object({ halt: z.boolean(), reason }).strict());
      await setFlags(ctx, { "routing.halt": body.halt });
      clearBreakerCache(ctx);
      const entry = await auditSafe(ctx, PLATFORM_CHAIN, { kind: "halt", actor: session.address, subject: "platform", data: { halt: body.halt, reason: body.reason } });
      res.json({ halted: body.halt, reason: body.reason, audit: entry?.hash ?? null });
    });

    router.put("/security/venues/:id", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req, "admin");
      const { id } = parseParams(req, z.object({ id: z.string().regex(/^[a-z0-9-]{2,48}$/u) }));
      if (!getProtocol(id)) throw new LykiaHttpError("NOT_FOUND", 404, "No such venue in the registry.");
      const body = parseBody(req, z.object({ disabled: z.boolean(), reason }).strict());
      await setVenueSwitch(ctx, id, { disabled: body.disabled, reason: body.reason, by: session.address, at: new Date(ctx.clock.now()).toISOString() });
      await auditSafe(ctx, PLATFORM_CHAIN, { kind: "venue", actor: session.address, subject: id, data: { disabled: body.disabled, reason: body.reason } });
      res.json({ venue: id, disabled: body.disabled, reason: body.reason });
    });

    router.get("/security/approvals", async (req, res) => {
      const q = parseQuery(req, z.object({ owner: evmAddress, environment: environmentSchema.optional() }));
      const env = environmentOf(ctx, q.environment);
      const approvals = await staleApprovals(ctx, env, q.owner as Address);
      res.json({ owner: q.owner, environment: env, approvals });
    });

    router.post("/security/check-address", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, z.object({ owner: evmAddress, address: evmAddress, environment: environmentSchema.optional(), tokens: z.array(evmAddress).max(4).optional() }).strict());
      const env = environmentOf(ctx, body.environment);
      const defaults = TOKENS.filter((t) => t.symbol === "USDC" || t.symbol === "EURC").map((t) => tokenAddress(t, env)).filter((a): a is Address => a !== null);
      res.json(await checkRecipient(ctx, { environment: env, owner: body.owner as Address, recipient: body.address as Address, tokens: (body.tokens as Address[] | undefined) ?? defaults }));
    });

    router.get("/security/alerts", async (req, res) => {
      const session = await mustSession(ctx, req);
      res.json({ alerts: await alertsOf(ctx, session.address) });
    });

    router.get("/security/policy", async (req, res) => {
      const session = await mustSession(ctx, req);
      res.json(await policyOf(ctx, session.address));
    });

    router.put("/security/policy", async (req, res) => {
      const session = await mustSession(ctx, req);
      const body = parseBody(
        req,
        z
          .object({
            txPerMinute: z.number().int().min(1).max(60).optional(),
            usdPerHour: z.number().min(1).max(10_000_000).optional(),
            spikeMultiple: z.number().min(2).max(100).optional(),
            newRecipientBurst: z.number().int().min(2).max(50).optional(),
            failureBurst: z.number().int().min(2).max(50).optional(),
            onAnomaly: z.enum(["flag", "pause"]).optional(),
            activeHoursUtc: z.array(z.number().int().min(0).max(23)).max(24).optional(),
          })
          .strict(),
      );
      res.json(await setPolicy(ctx, session.address, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))));
    });

    router.get("/security/pauses", async (req, res) => {
      const session = await mustSession(ctx, req);
      res.json({ pauses: await listPauses(ctx, session.address) });
    });

    router.post("/security/pause", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req);
      const body = parseBody(req, z.object({ subject: evmAddress, reason }).strict());
      if (!(await ownsSubject(ctx, session.address, body.subject))) throw new LykiaHttpError("FORBIDDEN", 403, "You can pause your own wallet and your own agents only.");
      await pause(ctx, { subject: body.subject.toLowerCase(), owner: session.address.toLowerCase(), reason: body.reason, at: new Date(ctx.clock.now()).toISOString(), by: "owner" });
      await auditSafe(ctx, ownerChain(session.address), { kind: "pause", actor: session.address, subject: body.subject, data: { reason: body.reason } });
      res.json({ paused: true, subject: body.subject });
    });

    router.post("/security/resume", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req);
      const body = parseBody(req, z.object({ subject: evmAddress }).strict());
      const current = await pauseOf(ctx, body.subject);
      if (!current) throw new LykiaHttpError("NOT_FOUND", 404, "That subject is not paused.");
      if (current.owner !== session.address.toLowerCase() && !session.roles.includes("admin")) throw new LykiaHttpError("FORBIDDEN", 403, "Only the owner who holds this pause can resume it.");
      await resume(ctx, body.subject);
      await auditSafe(ctx, ownerChain(current.owner), { kind: "resume", actor: session.address, subject: body.subject, data: {} });
      res.json({ paused: false, subject: body.subject });
    });

  },
};
