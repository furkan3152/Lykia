/**
 * Reading a sentence with the owner's memory: "again", "same as last week",
 * "undo the last swap", "more than last time", named contacts and "my usual
 * vault" become ordinary plan actions. The Fence still judges the plan;
 * unconfirmed contacts are flagged so the owner confirms the first send.
 */
import { resolveReference, scaleActions, stripUsualPhrase, substituteContacts, untrustedContacts, usualVenue, type Address, type PlanAction } from "@lykia/core";
import type { ParseResponse } from "@lykia/core/api/language";
import type { AppContext } from "../context.js";
import { readSentence, type ReadOptions } from "../language/reader.js";
import { memoryService } from "./memory.js";
import { getProfile } from "./profile.js";

export interface MemoryRead extends ParseResponse {
  /** Contacts this plan pays that the owner never confirmed a send to: the plan must be confirmed. */
  readonly confirmContacts: readonly { readonly name: string; readonly address: string }[];
}

const MORE = /([+]?\d{1,3})\s*%/u;

export async function readWithMemory(ctx: AppContext, owner: Address | null | undefined, text: string, options: ReadOptions = {}): Promise<MemoryRead> {
  const plain = (): MemoryRead => ({ ...readSentence(text, options), confirmContacts: [] });
  if (!owner) return plain();
  const profile = await getProfile(ctx, owner);
  if (!profile.memory.enabled) return plain();
  const memory = memoryService(ctx);
  const snap = await memory.snapshot(owner);
  const ref = resolveReference(text, snap, ctx.clock.now());
  if (ref.kind === "repeat" || ref.kind === "undo") {
    const untrusted = untrustedContacts(ref.actions, snap.contacts);
    return { actions: ref.actions, command: null, easterEgg: null, clarify: [], reply: ref.explanation, memory: { kind: ref.kind, explanation: ref.explanation, from: ref.from.intentId }, confirmContacts: untrusted.map((c) => ({ name: c.name, address: c.address })) };
  }
  if (ref.kind === "cannot-undo") return { actions: [], command: null, easterEgg: null, clarify: [ref.explanation], reply: ref.explanation, confirmContacts: [] };
  if (ref.kind === "more-than-last") {
    const pct = MORE.exec(text);
    if (pct) {
      const actions = scaleActions(ref.base.actions, Number(pct[1]));
      const explanation = `${pct[1]}% more than last time: ${ref.base.source}`;
      return { actions, command: null, easterEgg: null, clarify: [], reply: explanation, memory: { kind: "more-than-last", explanation, from: ref.base.intentId }, confirmContacts: untrustedContacts(actions, snap.contacts).map((c) => ({ name: c.name, address: c.address })) };
    }
    return { actions: [], command: null, easterEgg: null, clarify: [ref.clarify], clarifyChoices: [{ question: ref.clarify, choices: [...ref.choices] }], reply: ref.clarify, confirmContacts: [] };
  }
  const usualHit = usualVenue(text, await memory.preferences(owner, snap.intents));
  const sub = substituteContacts(usualHit ? stripUsualPhrase(text) : text, snap.contacts);
  const parsed = readSentence(sub.text, options);
  let actions: readonly PlanAction[] = parsed.actions;
  let memoryNote: MemoryRead["memory"];
  const usual = usualHit;
  if (usual) {
    actions = actions.map((a) => (("venue" in a || a.verb === "earn" || a.verb === "withdraw" || a.verb === "supply") && !("venue" in a && a.venue) && (a.verb === usual.verb || (usual.verb === "earn" && (a.verb === "earn" || a.verb === "supply"))) ? ({ ...a, venue: usual.venue } as PlanAction) : a));
    memoryNote = { kind: "usual-venue", explanation: `Your usual venue: ${usual.venue}` };
  }
  const untrusted = untrustedContacts(actions, snap.contacts);
  if (sub.used.length > 0) {
    memoryNote = {
      kind: "contacts",
      explanation: sub.used.map((c) => `${c.name} = ${c.address}${c.origin === "learned" && c.confirmedSends === 0 ? " (not confirmed yet)" : ""}`).join("; "),
      contacts: sub.used.map((c) => ({ name: c.name, address: c.address, trusted: c.origin === "manual" || c.confirmedSends > 0 })),
    };
  }
  return { ...parsed, actions, ...(memoryNote ? { memory: memoryNote } : {}), confirmContacts: untrusted.map((c) => ({ name: c.name, address: c.address })) };
}
