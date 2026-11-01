/**
 * Personal: the owner's profile, intent memory and contacts. Every route
 * acts for the signed-in owner (SIWE session); nothing here moves value.
 *
 *   GET    /profile                 the profile (defaults when never saved) + effects
 *   PUT    /profile                 partial update (validated, versioned)
 *   DELETE /profile                 back to defaults
 *   GET    /memory                  preferences, patterns, contacts, recent intents, model summary
 *   GET    /memory/intents          remembered intents (newest first)
 *   GET    /memory/export           everything remembered, as JSON
 *   DELETE /memory/:id              forget one intent (mem_…/out_…) or contact (ct_…)
 *   POST   /memory/forget           forget intents, contacts or everything
 *   GET    /contacts                the address book
 *   POST   /contacts                add (or update by address)
 *   PUT    /contacts/:id            rename / re-alias / change address (resets trust)
 *   DELETE /contacts/:id            remove
 */
import { toWebProfile, type Address } from "@lykia/core";
import type { ProfileResponse } from "@lykia/core/api/profile";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { contactView, intentView, memoryService } from "../personal/memory.js";
import { getProfile, profileEffects, resetProfile, updateProfile } from "../personal/profile.js";
import { mustSession } from "../platform/session.js";

const ContactBody = z.object({ name: z.string().min(1).max(40), address: evmAddress, aliases: z.array(z.string().min(1).max(40)).max(8).optional(), note: z.string().max(200).optional() });
const IdParams = z.object({ id: z.string().regex(/^(?:mem|ct|out|pref)_[A-Za-z0-9_-]{4,60}$/u) });

async function ownerOf(ctx: AppContext, req: Parameters<typeof mustSession>[1]): Promise<Address> {
  return (await mustSession(ctx, req)).address as Address;
}

export const personalModule: ApiModule = {
  name: "personal",
  register(router, ctx) {
    memoryService(ctx);

    router.get("/profile", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      const profile = await getProfile(ctx, owner);
      res.json({ ...toWebProfile(profile), owner: owner.toLowerCase(), profile, effects: profileEffects(profile) } satisfies ProfileResponse);
    });
    router.put("/profile", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      const profile = await updateProfile(ctx, owner, req.body);
      res.json({ ...toWebProfile(profile), owner: owner.toLowerCase(), profile, effects: profileEffects(profile) } satisfies ProfileResponse);
    });
    router.delete("/profile", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      await resetProfile(ctx, owner);
      const profile = await getProfile(ctx, owner);
      res.json({ ...toWebProfile(profile), owner: owner.toLowerCase(), profile, effects: profileEffects(profile) } satisfies ProfileResponse);
    });

    router.get("/memory", async (req, res) => {
      res.json(await memoryService(ctx).view(await ownerOf(ctx, req)));
    });
    router.get("/memory/intents", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      const { limit } = parseQuery(req, z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }));
      res.json({ intents: (await memoryService(ctx).intents(owner, limit ?? 100)).map(intentView) });
    });
    router.get("/memory/export", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      res.setHeader("content-disposition", `attachment; filename="lykia-memory-${owner.toLowerCase()}.json"`);
      res.json(await memoryService(ctx).export(owner));
    });
    router.post("/memory/forget", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      const body = parseBody(req, z.object({ what: z.enum(["intents", "contacts", "all"]).optional(), all: z.boolean().optional() }));
      res.json({ forgotten: await memoryService(ctx).forgetAll(owner, body.all ? "all" : (body.what ?? "all")) });
    });
    router.delete("/memory/:id", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      const { id } = parseParams(req, IdParams);
      if (!(await memoryService(ctx).forgetItem(owner, id))) throw new LykiaHttpError("NOT_FOUND", 404, "Nothing remembered under that id.");
      res.json({ forgotten: id });
    });

    router.get("/contacts", async (req, res) => {
      res.json({ contacts: (await memoryService(ctx).contacts(await ownerOf(ctx, req))).map(contactView) });
    });
    router.post("/contacts", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      const body = parseBody(req, ContactBody);
      res.status(201).json({ contact: contactView(await memoryService(ctx).upsertContact(owner, { name: body.name, address: body.address, ...(body.aliases ? { aliases: body.aliases } : {}), ...(body.note ? { note: body.note } : {}) })) });
    });
    router.put("/contacts/:id", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      const { id } = parseParams(req, IdParams);
      const body = parseBody(req, ContactBody);
      res.json({ contact: contactView(await memoryService(ctx).upsertContact(owner, { id, name: body.name, address: body.address, ...(body.aliases ? { aliases: body.aliases } : {}), ...(body.note ? { note: body.note } : {}) })) });
    });
    router.delete("/contacts/:id", async (req, res) => {
      const owner = await ownerOf(ctx, req);
      const { id } = parseParams(req, IdParams);
      if (!(await memoryService(ctx).forgetItem(owner, id))) throw new LykiaHttpError("NOT_FOUND", 404, "No such contact.");
      res.json({ deleted: id });
    });
  },
};
