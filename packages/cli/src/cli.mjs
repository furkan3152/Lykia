// The Lykia CLI. Every command goes through `run(argv, io)`, so tests can pass
// a fake fetch, a temporary config file and captured output.
//
//   lykia login --key lk_test_… [--base-url https://…]
//   lykia logout | whoami
//   lykia keys list | create --label NAME [--mode test|live] [--scopes read,quote] [--ips 1.2.3.4/32]
//              rotate ID [--overlap SECONDS] | revoke ID
//   lykia quote --from USDC --to EURC --amount 100 [--env testnet]
//   lykia plan "<sentence>" --owner 0x… [--env testnet] [--save]
//   lykia webhooks listen --forward-to http://localhost:3000/hooks [--events a,b] [--secret whsec_…]
//   lykia webhooks test [--endpoint whe_…] [--type payout.sent] | deliveries | events
//   lykia logs tail [--status error] [--key ID] | logs list
//   lykia usage | plan-info | openapi
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_BASE_URL = "https://api.lykiaai.com";
const KEY_PATTERN = /^lk_(?:live|test|sk|pk(?:_live|_test)?)_[a-z0-9]{12}_[A-Za-z0-9_-]{32}$/u;

export function configPath(env = process.env) {
  return env.LYKIA_CONFIG ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "lykia", "config.json");
}

export function loadConfig(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows: permissions are managed by the user profile.
  }
}

/** Parses `--name value`, `--name=value` and `--flag` into { _: positional, name: value }. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) out[arg.slice(2, eq)] = arg.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[arg.slice(2)] = argv[++i];
      else out[arg.slice(2)] = true;
    } else out._.push(arg);
  }
  return out;
}

/** `t=…,v1=…` exactly as the Lykia API signs deliveries. */
export function signPayload(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

const HELP = `lykia: the Lykia API from your terminal (built on Arc Network)

  login --key lk_test_…        save a key (or set LYKIA_API_KEY); --base-url for another API
  logout | whoami
  keys list | create --label NAME [--mode test|live] [--scopes read,quote] | rotate ID [--overlap S] | revoke ID
  quote --from USDC --to EURC --amount 100 [--env testnet]
  plan "<sentence>" --owner 0x… [--env testnet] [--save]
  webhooks listen --forward-to http://localhost:3000/hooks [--events a,b]
  webhooks test [--endpoint ID] [--type EVENT] | deliveries | events
  logs tail [--status error] [--key ID] | logs list
  usage | plan-info | openapi

Add --json for raw JSON. Account commands need a key with the admin scope.`;

export class CliError extends Error {}

function client(io, config) {
  const baseUrl = (io.env.LYKIA_BASE_URL ?? config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const key = io.env.LYKIA_API_KEY ?? config.apiKey;
  const request = async (method, path, body, headers = {}) => {
    const response = await io.fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "user-agent": "lykia-cli/0.1",
        ...(key ? { "Lykia-Key": key } : {}),
        ...(config.apiVersion ? { "Lykia-Version": config.apiVersion } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method === "POST" ? { "Idempotency-Key": randomBytes(16).toString("hex") } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const error = data?.error ?? {};
      throw new CliError(`${error.code ?? `HTTP_${response.status}`}: ${error.message ?? response.statusText}${error.requestId ? ` (request ${error.requestId})` : ""}`);
    }
    return data;
  };
  return { baseUrl, key, request };
}

function table(rows, columns) {
  if (rows.length === 0) return "(none)";
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (values) => values.map((v, i) => String(v ?? "").padEnd(widths[i])).join("  ").trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(columns.map((c) => r[c])))].join("\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs one command. Returns the exit code. */
export async function run(argv, io) {
  const args = parseArgs(argv);
  const [command, sub, ...rest] = args._;
  const path = io.configPath ?? configPath(io.env);
  const config = loadConfig(path);
  const out = (value, text) => io.stdout(args.json ? JSON.stringify(value, null, 2) : (text ?? JSON.stringify(value, null, 2)));
  const api = () => {
    const c = client(io, config);
    if (!c.key) throw new CliError("No key: run `lykia login --key lk_test_…` or set LYKIA_API_KEY.");
    return c;
  };

  switch (command) {
    case undefined:
    case "help":
    case "--help":
      io.stdout(HELP);
      return 0;
    case "login": {
      const key = typeof args.key === "string" ? args.key : io.env.LYKIA_API_KEY;
      if (!key || !KEY_PATTERN.test(key)) throw new CliError("Pass a Lykia key: lykia login --key lk_test_… (create one in The Mint, /mint/keys).");
      if (key.startsWith("lk_pk_")) throw new CliError("That is a publishable (browser) key. Use a secret lk_test_ or lk_live_ key.");
      const next = { ...config, apiKey: key, ...(typeof args["base-url"] === "string" ? { baseUrl: args["base-url"] } : {}), ...(typeof args.version === "string" ? { apiVersion: args.version } : {}) };
      const c = client({ ...io, env: { ...io.env, LYKIA_API_KEY: key } }, next);
      const versions = await c.request("GET", "/v1/versions");
      saveConfig(path, next);
      const mode = key.startsWith("lk_test_") ? "test (testnet only)" : key.startsWith("lk_live_") ? "live" : "legacy";
      out({ saved: path, baseUrl: c.baseUrl, mode, latestVersion: versions?.latest ?? null }, `Logged in to ${c.baseUrl} with a ${mode} key. Saved to ${path}.`);
      return 0;
    }
    case "logout":
      if (existsSync(path)) rmSync(path);
      out({ removed: path }, "Logged out.");
      return 0;
    case "whoami": {
      const c = api();
      const me = await c.request("GET", "/v1/developers/me");
      out(me, `${me.profile?.name ?? "developer"} (${me.profile?.address ?? "?"}) on the ${me.plan ?? "free"} plan, via ${c.baseUrl}`);
      return 0;
    }
    case "keys": {
      const c = api();
      if (!sub || sub === "list") {
        const { keys } = await c.request("GET", "/v1/developers/keys");
        out(keys, table(keys.map((k) => ({ id: k.id, label: k.label, prefix: k.prefix, mode: k.mode ?? "legacy", scopes: k.scopes.join(","), revoked: k.revokedAt ? "yes" : "" })), ["id", "label", "prefix", "mode", "scopes", "revoked"]));
        return 0;
      }
      if (sub === "create") {
        if (typeof args.label !== "string") throw new CliError("keys create needs --label.");
        const body = { label: args.label, mode: args.mode === "live" ? "live" : "test", ...(typeof args.scopes === "string" ? { scopes: args.scopes.split(",") } : {}), ...(typeof args.ips === "string" ? { allowedIps: args.ips.split(",") } : {}) };
        const created = await c.request("POST", "/v1/developers/keys", body);
        out(created, `Created ${created.prefix} (${created.mode}). Shown once:\n${created.secret}`);
        return 0;
      }
      if (sub === "rotate" || sub === "revoke") {
        const id = rest[0];
        if (!id) throw new CliError(`keys ${sub} needs a key id.`);
        const result = await c.request("POST", `/v1/developers/keys/${encodeURIComponent(id)}/${sub}`, sub === "rotate" && args.overlap !== undefined ? { overlapSeconds: Number(args.overlap) } : {});
        out(result, sub === "rotate" ? `New secret (shown once):\n${result.secret}\nThe old secret works until ${result.previousSecretExpiresAt ?? "now"}.` : `Revoked ${result.prefix}.`);
        return 0;
      }
      throw new CliError(`Unknown keys command ${sub}.`);
    }
    case "quote": {
      const c = api();
      if (typeof args.from !== "string" || typeof args.to !== "string" || typeof args.amount !== "string") throw new CliError("quote needs --from, --to and --amount.");
      const quote = await c.request("POST", "/v1/quote", { kind: "swap", from: args.from, to: args.to, amount: args.amount, ...(typeof args.env === "string" ? { environment: args.env } : {}) });
      const chosen = quote?.choice?.chosen;
      const lines = chosen ? [`Best: ${chosen.label} (${chosen.venue}), out ${chosen.amountOut ?? "?"} base units of ${args.to}`, `Why: ${quote.choice.reason}`, ...(quote.options ?? []).map((o) => `  ${o.label}: ${o.amountOut ?? "n/a"}`)] : ["No executable route for that pair right now."];
      out(quote, lines.join("\n"));
      return 0;
    }
    case "plan": {
      const c = api();
      const text = sub;
      if (!text) throw new CliError('plan needs a sentence: lykia plan "send 5 USDC to 0x…" --owner 0x…');
      const owner = typeof args.owner === "string" ? args.owner : config.owner;
      if (!owner) throw new CliError("plan needs --owner 0x… (the wallet that would sign).");
      const result = await c.request("POST", "/v1/intents", { owner, text, ...(typeof args.env === "string" ? { environment: args.env } : {}), ...(args.save ? {} : { dryRun: true }) });
      const intent = result?.intent ?? {};
      const lines = [`Decision: ${intent.verdict?.decision ?? "?"}`, ...(intent.steps ?? []).map((s, i) => `  ${i + 1}. ${s.kind}${s.venue ? ` via ${s.venue}` : ""}${s.fee ? ` (fee ${s.fee.amount ?? JSON.stringify(s.fee)})` : ""}`), ...(intent.verdict?.reasons ?? []).filter((r) => r.outcome !== "pass").map((r) => `  ! ${r.message}`)];
      out(result, lines.join("\n"));
      return 0;
    }
    case "webhooks": {
      const c = api();
      if (sub === "listen") {
        const forward = typeof args["forward-to"] === "string" ? args["forward-to"] : null;
        if (!forward) throw new CliError("webhooks listen needs --forward-to http://localhost:PORT/path.");
        const host = new URL(forward).hostname;
        if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !args["allow-remote"]) throw new CliError("Forwarding only goes to localhost (add --allow-remote to override).");
        const secret = typeof args.secret === "string" ? args.secret : `whsec_cli_${randomBytes(18).toString("base64url")}`;
        const types = typeof args.events === "string" ? new Set(args.events.split(",")) : null;
        let since = typeof args.since === "string" ? args.since : new Date(io.now()).toISOString();
        io.stderr(`Forwarding Lykia events to ${forward}\nSigning secret for this session: ${secret}\nPress Ctrl+C to stop.`);
        const max = Number(args.iterations ?? Infinity);
        for (let i = 0; i < max && !io.signal?.aborted; i++) {
          const page = await c.request("GET", `/v1/events?since=${encodeURIComponent(since)}&limit=200`);
          const fresh = [...(page?.data ?? [])].reverse();
          for (const event of fresh) {
            since = event.createdAt > since ? event.createdAt : since;
            if (types && !types.has(event.type) && !types.has(event.event)) continue;
            const body = JSON.stringify(event);
            let status = "error";
            try {
              const res = await io.fetch(forward, { method: "POST", headers: { "content-type": "application/json", "Lykia-Signature": signPayload(secret, body, Math.floor(io.now() / 1000)), "Lykia-Event": event.event ?? event.type, "Lykia-Event-Id": event.id }, body });
              status = String(res.status);
            } catch (error) {
              status = error instanceof Error ? error.message : "error";
            }
            io.stdout(`${new Date(io.now()).toISOString()}  ${event.type}  ${event.id}  -> ${status}`);
          }
          if (i + 1 < max) await (io.sleep ?? sleep)(Number(args.interval ?? 2000));
        }
        return 0;
      }
      if (sub === "test") {
        const result = await c.request("POST", "/v1/developers/webhooks/test", { ...(typeof args.endpoint === "string" ? { endpointId: args.endpoint } : {}), ...(typeof args.type === "string" ? { type: args.type } : {}) });
        out(result, `Sent ${result.sent} test event(s): ${result.deliveries.map((d) => `${d.endpointId} ${d.status}`).join(", ")}`);
        return 0;
      }
      if (sub === "deliveries") {
        const { deliveries } = await c.request("GET", "/v1/developers/webhooks/deliveries?limit=50");
        out(deliveries, table(deliveries.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, code: d.lastStatusCode ?? "", created: d.createdAt })), ["id", "event", "status", "attempts", "code", "created"]));
        return 0;
      }
      if (sub === "events") {
        const page = await c.request("GET", "/v1/events?limit=50");
        out(page, table((page.data ?? []).map((e) => ({ id: e.id, type: e.type, created: e.createdAt, live: e.livemode ? "yes" : "no" })), ["id", "type", "created", "live"]));
        return 0;
      }
      if (!sub || sub === "list") {
        const data = await c.request("GET", "/v1/developers/webhooks");
        out(data, table(data.endpoints.map((e) => ({ id: e.id, url: e.url, events: e.events.length, disabled: e.disabled ? "yes" : "" })), ["id", "url", "events", "disabled"]));
        return 0;
      }
      throw new CliError(`Unknown webhooks command ${sub}.`);
    }
    case "logs": {
      const c = api();
      const filters = `${typeof args.status === "string" ? (/^\d{3}$/u.test(args.status) ? `&status=${args.status}` : `&statusClass=${args.status}`) : ""}${typeof args.key === "string" ? `&keyId=${encodeURIComponent(args.key)}` : ""}`;
      const fmt = (e) => `${e.at}  ${String(e.status).padEnd(3)}  ${e.method.padEnd(6)} ${e.path}  ${e.latencyMs}ms  ${e.errorCode ?? ""}  ${e.requestId}`.trimEnd();
      if (!sub || sub === "list") {
        const page = await c.request("GET", `/v1/logs?limit=50${filters}`);
        out(page, (page.data ?? []).map(fmt).join("\n") || "(no requests yet)");
        return 0;
      }
      if (sub === "tail") {
        let since = new Date(io.now() - 60_000).toISOString();
        const max = Number(args.iterations ?? Infinity);
        for (let i = 0; i < max && !io.signal?.aborted; i++) {
          const page = await c.request("GET", `/v1/logs?since=${encodeURIComponent(since)}&limit=200${filters}`);
          const fresh = [...(page?.data ?? [])].reverse();
          for (const entry of fresh) {
            io.stdout(args.json ? JSON.stringify(entry) : fmt(entry));
            if (entry.at > since) since = entry.at;
          }
          if (i + 1 < max) await (io.sleep ?? sleep)(Number(args.interval ?? 2000));
        }
        return 0;
      }
      throw new CliError(`Unknown logs command ${sub}.`);
    }
    case "usage": {
      const usage = await api().request("GET", "/v1/billing/usage?days=7");
      out(usage, `${usage.month}: ${usage.requests} of ${usage.includedRequests} included requests (${usage.plan}); credits ${usage.creditsUnits} units\n${table(usage.days, ["day", "requests", "errors"])}`);
      return 0;
    }
    case "plan-info": {
      const info = await api().request("GET", "/v1/billing/plan");
      out(info, `${info.plan.name}: ${info.plan.summary}`);
      return 0;
    }
    case "openapi": {
      const c = client(io, config);
      out({ openapi: `${c.baseUrl}/v1/openapi.json`, reference: `${c.baseUrl}/v1/reference` }, `${c.baseUrl}/v1/openapi.json\n${c.baseUrl}/v1/reference`);
      return 0;
    }
    default:
      throw new CliError(`Unknown command ${command}. Run lykia help.`);
  }
}

/** The process entry: real fetch, real output. */
export async function main(argv) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  try {
    return await run(argv, { fetch: (url, init) => fetch(url, init), env: process.env, stdout: (s) => process.stdout.write(`${s}\n`), stderr: (s) => process.stderr.write(`${s}\n`), now: () => Date.now(), signal: controller.signal });
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`lykia: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
