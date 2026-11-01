// Checks what the embed reads: GET /v1/ecosystem, open to every origin.
const API = (process.env.LYKIA_API ?? "https://lykia-api-akdogan1.vercel.app").replace(/\/$/u, "");
const response = await fetch(`${API}/v1/ecosystem?environment=mainnet`, { headers: { origin: "https://example.org" } });
if (!response.ok) {
  console.log(`GET /v1/ecosystem answered ${response.status}. Is this API version deployed yet?`);
  process.exit(1);
}
console.log(`CORS: access-control-allow-origin = ${response.headers.get("access-control-allow-origin")}`);
const data = await response.json();
console.log(data.positioning);
console.log(`${data.totals.protocols} protocols, ${data.totals.verified} verified, ${data.totals.routable} routed by Lykia`);
for (const p of data.protocols.filter((p) => p.category !== "circle").slice(0, 6)) console.log(`  ${p.name.padEnd(24)} ${p.lykia.padEnd(7)} TVL ${p.tvlUsd === null ? "n/a" : `$${Math.round(p.tvlUsd / 1e6)}M`}`);
