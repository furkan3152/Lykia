/**
 * Owner console: Circle setup, built for a phone. Creates the entity secret
 * through the API (admin session), shows it once, downloads the recovery
 * file and walks through putting it into Vercel. The secret lives only in
 * this component's state (never storage): leaving the page unmounts it and
 * the secret is gone.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPost, describeError } from "../../lib/api";
import { Button, Card, Tag, toast } from "../../mosaic";
import { passkeyConfig } from "../wallet/passkeyConfig";
import { circleSetup, parseEntitySecret, recoveryBytes, type EntitySecretResult, type Readiness } from "./setup";

const TONE: Record<Readiness, "ok" | "ochre" | "ghost"> = { configured: "ok", missing: "ochre", unknown: "ghost" };
const WORD: Record<Readiness, string> = { configured: "CONFIGURED", missing: "MISSING", unknown: "UNKNOWN" };

function download(result: EntitySecretResult) {
  if (!result.recovery) return;
  const url = URL.createObjectURL(new Blob([recoveryBytes(result.recovery)], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function CircleSetupCard({ admin }: { readonly admin: boolean }) {
  const status = useQuery({ queryKey: ["circle-status"], retry: false, queryFn: ({ signal }) => apiGet<unknown>("/v1/circle/status", { signal }) });
  const setup = circleSetup(status.data);
  const clientKey: Readiness = passkeyConfig() ? "configured" : "missing";
  const [result, setResult] = useState<EntitySecretResult | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const parsed = parseEntitySecret(await apiPost<unknown>("/v1/admin/circle/entity-secret", result || setup.entitySecret === "configured" ? { replace: true } : {}));
      if (!parsed) throw new Error("The API answered without an entity secret.");
      setResult(parsed);
      setShown(false);
      download(parsed);
      toast.success("Entity secret created", { description: "Save the recovery file, then add the secret to Vercel.", from: "LYKO" });
    } catch (e) {
      toast.error("Could not create the entity secret", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.secret);
      toast.success("Copied", { description: "Paste it into Vercel as CIRCLE_ENTITY_SECRET.", from: "LYKO" });
    } catch {
      setShown(true);
      toast.warning("Copy blocked", { description: "Select the secret and copy it by hand.", from: "LYKO" });
    }
  };

  const rows: [string, Readiness, string][] = [
    ["Circle API key", setup.apiKey, "CIRCLE_API_KEY · console.circle.com → API Keys"],
    ["Entity secret", setup.entitySecret, "CIRCLE_ENTITY_SECRET · created here"],
    ["Client key for passkeys", clientKey, "VITE_CIRCLE_CLIENT_KEY + VITE_CIRCLE_CLIENT_URL · on the web project"],
    ["StableFX access", setup.stablefx, "STABLEFX_API_KEY · request access from Circle"],
  ];

  return (
    <Card title="Circle setup" kicker="KEYS · ENTITY SECRET · PASSKEYS" tone="sea">
      <ul className="m-setup">
        {rows.map(([name, state, hint]) => (
          <li key={name}>
            <div><b>{name}</b><p className="m-small m-muted">{hint}</p></div>
            <Tag tone={TONE[state]}>{WORD[state]}</Tag>
          </li>
        ))}
      </ul>
      <p className="m-small"><a href="https://console.circle.com" target="_blank" rel="noreferrer">Open console.circle.com ↗</a> · <a href="https://developers.circle.com/wallets/dev-controlled/entity-secret-management" target="_blank" rel="noreferrer">Entity secret guide ↗</a></p>

      <div className="m-setup__secret">
        {setup.entitySecret === "configured" && !result ? (
          <p className="m-note">Already configured: the API has an entity secret. Rotating it (below) means updating Vercel again.</p>
        ) : !admin ? (
          <p className="m-note">Sign in on Arc with an admin wallet to create the entity secret.</p>
        ) : setup.apiKey === "missing" ? (
          <p className="m-note">Add CIRCLE_API_KEY to the API first; the entity secret is registered with it.</p>
        ) : null}
        {admin && setup.apiKey !== "missing" ? (
          <Button tone={setup.entitySecret === "configured" && !result ? "ghost" : "sea"} onClick={() => void create()} disabled={busy}>
            {busy ? "CREATING…" : result || setup.entitySecret === "configured" ? "ROTATE ENTITY SECRET" : "CREATE ENTITY SECRET"}
          </Button>
        ) : null}
        {result ? (
          <div className="m-setup__result">
            <label className="m-small m-muted" htmlFor="es-value">Entity secret (shown once)</label>
            <div className="m-setup__field">
              <input id="es-value" className="m-input num" readOnly type={shown ? "text" : "password"} value={result.secret} onFocus={(e) => shown && e.currentTarget.select()} autoComplete="off" spellCheck={false} />
              <button type="button" className="m-btn m-btn--ghost m-btn--sm" onClick={() => setShown((s) => !s)}>{shown ? "HIDE" : "SHOW"}</button>
              <button type="button" className="m-btn m-btn--sm" onClick={() => void copy()}>COPY</button>
            </div>
            {result.recovery ? (
              <button type="button" className="m-btn m-btn--ghost m-btn--sm" onClick={() => download(result)}>DOWNLOAD RECOVERY FILE AGAIN</button>
            ) : (
              <p className="m-note m-note--bad">The API returned no recovery file. Register the secret again from Circle's console to get one.</p>
            )}
            <ol className="m-setup__steps">
              <li>Save the recovery file somewhere safe (a password manager or your cloud drive). Without it a lost secret cannot be recovered.</li>
              <li>In Vercel → lykia-api → Settings → Environment Variables, add <b>CIRCLE_ENTITY_SECRET</b> as Sensitive with the copied value.</li>
              <li>Redeploy lykia-api so the new variable takes effect.</li>
            </ol>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
