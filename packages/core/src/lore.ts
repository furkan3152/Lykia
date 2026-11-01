/**
 * Lykia's lore, as data the UI and the agent share. Lyko is a Kangal-like
 * shepherd dog (Greek lykos, "wolf") who keeps the flock (agents and the
 * owner's assets) inside the Fence and the wolves (scam tokens, rug pulls,
 * exploits) outside. The valley is the Lycian coast; the hidden mountain is
 * Lykaion, in Arcadia.
 *
 * Every string here is product copy, so it lives in one place.
 */

/** Sheepdog whistle commands, used as real commands in the deck and the agent. */
export const COMMANDS = Object.freeze({
  "come bye": { meaning: "Circle clockwise: re-scan the flock (refresh balances and positions).", action: "rescan" },
  "away to me": { meaning: "Circle counter-clockwise: re-sniff every token held (run Scent on the flock).", action: "resniff" },
  "walk up": { meaning: "Move in: execute the next ready step.", action: "advance" },
  "lie down": { meaning: "Stop: blow the whistle (Fence mode whistle).", action: "whistle" },
  "that'll do": { meaning: "Work is done: release the whistle (needs the owner).", action: "release" },
  "look back": { meaning: "Turn around: show the last outrun and what changed.", action: "lookback" },
} as const);

export type CommandWord = keyof typeof COMMANDS;
export type CommandAction = (typeof COMMANDS)[CommandWord]["action"];

/** The command a sentence is, if it is one (case and punctuation ignored). */
export function commandOf(text: string): CommandWord | null {
  const clean = text.toLowerCase().replace(/[’']/gu, "'").replace(/[^a-z' ]/gu, " ").replace(/\s+/gu, " ").trim();
  return (Object.keys(COMMANDS) as CommandWord[]).find((word) => clean === word || clean === word.replace("'", "")) ?? null;
}

/**
 * Stops of the Lycian Way, Fethiye to Antalya. Outrun waypoints take their
 * names in order, so a three-step plan walks Ölüdeniz, Faralya, Kabak.
 */
export const LYCIAN_WAY = Object.freeze([
  { name: "Ölüdeniz", note: "The trail starts above the blue lagoon." },
  { name: "Faralya", note: "Butterfly Valley below the cliff." },
  { name: "Kabak", note: "Pines down to a hidden bay." },
  { name: "Alınca", note: "The highest village on the way." },
  { name: "Patara", note: "Eighteen kilometres of sand and an old lighthouse." },
  { name: "Kalkan", note: "White houses over the harbour." },
  { name: "Kaş", note: "The theatre faces the sea." },
  { name: "Üçağız", note: "Sunken Kekova close by." },
  { name: "Myra", note: "Rock tombs cut into the hill." },
  { name: "Olympos", note: "Ruins under the plane trees." },
  { name: "Yanartaş", note: "The flames of the Chimaera never go out." },
  { name: "Tahtalı", note: "The last summit before Antalya." },
] as const);

export function waypointName(index: number): string {
  return LYCIAN_WAY[((index % LYCIAN_WAY.length) + LYCIAN_WAY.length) % LYCIAN_WAY.length]?.name ?? "Ölüdeniz";
}

/** Kinds of wolves Scent can catch. */
export const WOLVES = Object.freeze({
  lookalike: { name: "The coat thief", line: "Wears USDC's name, isn't USDC." },
  honeypot: { name: "The one-way gate", line: "You can buy it; you cannot sell it." },
  "mint-authority": { name: "The bottomless pen", line: "Someone can print more whenever they like." },
  "upgradeable": { name: "The shapeshifter", line: "The code can be swapped under you." },
  blacklist: { name: "The gatekeeper", line: "Someone can freeze your share." },
  "fee-on-transfer": { name: "The toll wolf", line: "Takes a bite from every transfer." },
  "owner-active": { name: "The watching wolf", line: "An owner still holds the keys." },
  "no-code": { name: "The empty den", line: "There is no contract at this address." },
} as const);

export type WolfKind = keyof typeof WOLVES;

/** Lyko's moods, picked from the flock's state; the sprite engine draws one per mood. */
export type LykoMood = "resting" | "watching" | "herding" | "alert" | "growling" | "proud" | "sleeping";

export function lykoMood(input: { readonly whistle: boolean; readonly threats: number; readonly running: number; readonly settledJustNow: boolean; readonly idleMinutes: number }): LykoMood {
  if (input.whistle) return "resting";
  if (input.threats > 0) return input.threats > 2 ? "growling" : "alert";
  if (input.settledJustNow) return "proud";
  if (input.running > 0) return "herding";
  if (input.idleMinutes > 30) return "sleeping";
  return "watching";
}

/** What Lyko says, per mood (EN + TR). */
export const LYKO_LINES: Readonly<Record<LykoMood, { readonly en: string; readonly tr: string }>> = Object.freeze({
  resting: { en: "Whistle heard. I'm holding the flock. Homeward moves only.", tr: "Düdüğü duydum. Sürüyü tutuyorum, sadece eve dönüş." },
  watching: { en: "All quiet in the valley.", tr: "Vadide her şey sakin." },
  herding: { en: "On the outrun. Keep your eyes on the trail.", tr: "Yoldayız. Gözün patikada olsun." },
  alert: { en: "Something smells off near the fence.", tr: "Çitin yanında bir koku var." },
  growling: { en: "Wolves at the fence. Nothing passes.", tr: "Kurtlar çitte. Hiçbir şey geçmez." },
  proud: { en: "Flock's home. Every step is final on Arc.", tr: "Sürü evde. Arc'ta her adım kesin." },
  sleeping: { en: "Zzz. Wake me with “come bye”.", tr: "Zzz. “come bye” de, uyanırım." },
});

/**
 * Hidden words. Typing them in the deck's command box (or the agent)
 * reveals a scene; none of them moves value.
 */
export const EASTER_EGGS = Object.freeze({
  lykaion: { scene: "arcadia-night", line: "Mount Lykaion, Arcadia. Shepherds kept their flocks here long before any chain." },
  arcadia: { scene: "arcadia-night", line: "Et in Arcadia ego. The pasture remembers." },
  chimaera: { scene: "yanartas", line: "The fires of Yanartaş have burned for thousands of years. So does a good Fence." },
  kangal: { scene: "lyko-pose", line: "Kangal shepherd dogs wear spiked collars against wolves. Lyko wears a Künye." },
  patara: { scene: "lighthouse", line: "The Patara lighthouse is one of the oldest in the world. Memos are our lighthouse." },
  "et in arcadia ego": { scene: "arcadia-night", line: "Even in Arcadia, there is risk. That is why there is a dog." },
} as const);

export type EasterEggWord = keyof typeof EASTER_EGGS;

export function easterEggOf(text: string): EasterEggWord | null {
  const clean = text.toLowerCase().trim().replace(/[.!?]+$/u, "");
  return (Object.keys(EASTER_EGGS) as EasterEggWord[]).find((w) => w === clean) ?? null;
}

/** The product vocabulary, so every surface uses the same words. */
export const GLOSSARY = Object.freeze({
  fence: { en: "Fence", tr: "Çit", what: "The rules around an agent or an owner." },
  kunye: { en: "Künye", tr: "Künye", what: "An agent's on-chain identity tag: ERC-8004 identity + the Fence hash it obeys." },
  whistle: { en: "Whistle", tr: "Düdük", what: "Stops every new risk; homeward moves still pass." },
  flock: { en: "Flock", tr: "Sürü", what: "Everything the owner holds on Arc, in one balance sheet." },
  scent: { en: "Scent", tr: "Koku", what: "What can be proven about a token before anyone touches it." },
  outrun: { en: "Outrun", tr: "Outrun", what: "A plan's path, drawn as an arc from start to fold." },
  fold: { en: "Fold", tr: "Ağıl", what: "Where the money ends up when the outrun is done." },
} as const);
