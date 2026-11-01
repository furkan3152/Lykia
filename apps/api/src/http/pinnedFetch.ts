/**
 * Fetch for URLs a user can influence (Tag cards, webhooks, x402
 * resources). The hostname is resolved exactly once, at connect time, by
 * the guarded lookup; the socket connects to that checked address and the
 * request keeps the original Host header and TLS server name. There is no
 * second resolution a rebinding DNS server could answer differently, and no
 * redirect is followed.
 */
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import type { FetchLike } from "../health/dependencies.js";
import { guardedLookup } from "./netguard.js";

export const PINNED_FETCH_MAX_BYTES = 2_000_000;

export interface PinnedFetchOptions {
  readonly lookup?: LookupFunction;
  readonly maxBytes?: number;
}

export function createPinnedFetch(options: PinnedFetchOptions = {}): FetchLike {
  const lookup = options.lookup ?? guardedLookup;
  const maxBytes = options.maxBytes ?? PINNED_FETCH_MAX_BYTES;
  return (input, init = {}) =>
    new Promise<Response>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(input);
      } catch (error) {
        reject(error);
        return;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        reject(new TypeError(`Unsupported protocol ${url.protocol}`));
        return;
      }
      if (url.username || url.password) {
        reject(new TypeError("Credentials in URLs are not allowed."));
        return;
      }
      if (init.body !== undefined && init.body !== null && typeof init.body !== "string") {
        reject(new TypeError("Only string bodies are supported."));
        return;
      }
      const body = typeof init.body === "string" ? init.body : undefined;
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value;
      });
      if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.request(
        url,
        { method: init.method ?? "GET", headers, lookup, agent: false, ...(url.protocol === "https:" ? { servername: url.hostname } : {}) },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && init.redirect === "error") {
            response.resume();
            reject(new TypeError(`Redirect to ${response.headers.location ?? "elsewhere"} refused.`));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          let tooLarge = false;
          response.on("data", (chunk: Buffer) => {
            if (tooLarge) return;
            size += chunk.length;
            if (size > maxBytes) {
              tooLarge = true;
              reject(new Error(`Response larger than ${maxBytes} bytes.`));
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (tooLarge) return;
            const out = new Headers();
            for (const [key, value] of Object.entries(response.headers)) {
              if (value !== undefined) out.set(key, Array.isArray(value) ? value.join(", ") : String(value));
            }
            const empty = status === 204 || status === 205 || status === 304;
            try {
              resolve(new Response(empty ? null : Buffer.concat(chunks), { status, headers: out }));
            } catch (error) {
              reject(error);
            }
          });
          response.on("error", reject);
        },
      );
      request.on("error", reject);
      const signal = init.signal;
      if (signal) {
        if (signal.aborted) {
          request.destroy();
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error("aborted")), { once: true });
      }
      if (body !== undefined) request.write(body);
      request.end();
    });
}

export const pinnedFetch: FetchLike = createPinnedFetch();
