/**
 * Headless hooks: the widget's logic without its markup. Each hook keeps a
 * controller for the component's lifetime and subscribes to it through
 * useSyncExternalStore, so server rendering returns the initial state.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Address, FenceTemplateKey } from "@lykia/core";
import { createChatController, createFenceController, createPackController, createPlanController, flockQuery, outrunQuery, scentQuery, type Store } from "./controllers.js";
import { useLykia } from "./provider.js";

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Plan a sentence or actions, then sign and submit every step with the connected wallet. */
export function useLykiaPlan() {
  const { transport, environment, signer } = useLykia();
  const controller = useMemo(() => createPlanController({ transport, signer, ...(environment ? { environment } : {}) }), [transport, environment, signer]);
  const state = useStore(controller);
  return { ...state, plan: controller.plan, run: controller.run, reset: controller.reset };
}

/** The assistant's conversation (Lyko, or the project's own assistant name). */
export function useLykiaChat() {
  const { transport, environment, signer, owner, assistantName } = useLykia();
  const resolveOwner = useCallback(async () => owner ?? (await (await signer())?.address(false)) ?? null, [owner, signer]);
  const controller = useMemo(() => createChatController({ transport, owner: resolveOwner, ...(environment ? { environment } : {}) }), [transport, environment, resolveOwner]);
  const state = useStore(controller);
  return { ...state, assistantName, send: controller.send, reset: controller.reset };
}

/** A Fence being edited: templates, caps, server validation with loosened-rule lines. */
export function useFence(initial: { template?: FenceTemplateKey } = {}) {
  const { transport } = useLykia();
  const controller = useMemo(() => createFenceController(transport, initial), [transport]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useStore(controller);
  return { ...state, pickTemplate: controller.pickTemplate, setCap: controller.setCap, edit: controller.edit, validate: controller.validate };
}

/** What can be proven about a token before anyone touches it. */
export function useScent() {
  const { transport, environment } = useLykia();
  const query = useMemo(() => scentQuery(transport, environment), [transport, environment]);
  const state = useStore(query);
  return { ...state, check: (token: Address) => query.load(token) };
}

/** Everything an owner holds on Arc, in one balance sheet. */
export function useFlock() {
  const { transport, environment } = useLykia();
  const query = useMemo(() => flockQuery(transport, environment), [transport, environment]);
  const state = useStore(query);
  return { ...state, load: (owner: Address) => query.load(owner) };
}

/** The owner's agents: list, spawn sub-agents inside a parent's Fence, revoke. */
export function usePack() {
  const { transport, environment } = useLykia();
  const controller = useMemo(() => createPackController(transport, environment), [transport, environment]);
  const state = useStore(controller);
  return { ...state, load: (owner: Address) => controller.load(owner), spawn: controller.spawn, revoke: controller.revoke };
}

/** The path of a plan, drawn as an arc. */
export function useOutrun() {
  const { transport } = useLykia();
  const query = useMemo(() => outrunQuery(transport), [transport]);
  const state = useStore(query);
  return { ...state, load: (intentId: string) => query.load(intentId) };
}
