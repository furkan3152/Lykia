/**
 * Common Turkish money requests, rewritten into the English the reader
 * parses. Deterministic and conservative: it only runs when the text looks
 * Turkish, maps a short list of verbs, conjunctions and quantities, and
 * leaves tokens, amounts and addresses exactly as written. Replies stay in
 * English whatever the input language (language/english.ts).
 *
 * The repository is English only, so every Turkish letter below is written
 * as a Unicode escape. Examples (escaped the same way) live in the tests:
 * "100 USDC'yi EURC'ye \u00e7evir" reads as "100 USDC'yi EURC'ye convert";
 * "1 USDC ile EURC al ve en iyi getiriyle bor\u00e7 ver" reads as
 * "buy EURC with 1 USDC and at the best yield lend it".
 */
import { findToken } from "@lykia/core";

const L = "[\\p{L}\\p{N}_]";
function w(body: string): RegExp {
  return new RegExp(`(?<!${L})(?:${body})(?!${L})`, "giu");
}

const TURKISH_LETTERS = /[\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/u;
const TURKISH_WORDS = w("ve|ile|al|al\u0131n|sat|g\u00f6nder|yolla|\u00f6de|yat\u0131r|\u00e7evir|d\u00f6n\u00fc\u015ft\u00fcr|takas|getiri\\p{L}*|faiz\\p{L}*|heps\u0069ni|t\u00fcm\u00fcn\u00fc|tamam\u0131n\u0131|yar\u0131s\u0131n\u0131|sonra|ard\u0131ndan|bor\u00e7|k\u00f6pr\u00fcle|\u00e7ek|onu|bunu");

export function looksTurkish(text: string): boolean {
  return TURKISH_LETTERS.test(text) || (text.match(TURKISH_WORDS)?.length ?? 0) >= 1;
}

/** Ordered rewrites; multi-word phrases first. */
const REWRITES: readonly (readonly [RegExp, string])[] = [
  // "1 USDC ile EURC al" -> "buy EURC with 1 USDC"
  [new RegExp(`((?:\\d+(?:\\.\\d+)?\\s*)?[$\u20ac]?${L}+(?:['\u2019]\\p{L}+)?)\\s+ile\\s+(${L}+(?:['\u2019]\\p{L}+)?)\\s+al(?:\u0131n|\u0131r m\u0131s\u0131n)?(?!${L})`, "giu"), "buy $2 with $1"],
  [w("en iyi getiri(?:yle|ye|li|de)?|en y\u00fcksek getiri(?:yle|ye|li|de)?"), "at the best yield"],
  [w("bor\u00e7 ver(?:in|ir misin)?"), "lend"],
  [w("bor\u00e7 al(?:\u0131n|\u0131r m\u0131s\u0131n)?"), "borrow"],
  [w("geri \u00f6de(?:yin)?|borcu(?:mu)? \u00f6de"), "repay"],
  [w("takas et(?:in)?|takasla"), "swap"],
  [w("getiri(?:ye|yle)?|faiz(?:e|le)?"), "for yield"],
  [w("\u00e7evir(?:in|ir misin)?|d\u00f6n\u00fc\u015ft\u00fcr(?:\u00fcn)?|de\u011fi\u015ftir(?:in)?"), "convert"],
  [w("sat(?:\u0131n)?"), "sell"],
  [w("al(?:\u0131n)?"), "buy"],
  [w("g\u00f6nder(?:in)?|yolla(?:y\u0131n)?|transfer et"), "send"],
  [w("\u00f6de(?:yin)?"), "pay"],
  [w("yat\u0131r(?:\u0131n)?|biriktir"), "deposit"],
  [w("\u00e7ek(?:in)?"), "withdraw"],
  [w("k\u00f6pr\u00fcle(?:yin)?"), "bridge"],
  [w("ve"), "and"],
  [w("sonra|ard\u0131ndan"), "then"],
  [w("heps\u0069ni|t\u00fcm\u00fcn\u00fc|tamam\u0131n\u0131|heps\u0069"), "all"],
  [w("yar\u0131s\u0131n\u0131|yar\u0131s\u0131"), "50%"],
  [w("onu|bunu"), "it"],
];

function hasObject(clause: string): boolean {
  if (/\d|%|\ball\b|\bit\b|0x[0-9a-f]{40}/iu.test(clause)) return true;
  return clause.split(/[\s,]+/u).some((word) => findToken("mainnet", word.replace(/['\u2019].*$/u, "")) !== null);
}

/** The text in reader English when it looks Turkish; otherwise unchanged. */
export function turkishToEnglish(text: string): string {
  if (!looksTurkish(text)) return text;
  let out = text;
  for (const [re, to] of REWRITES) out = out.replace(re, to);
  // A Turkish verb with no object after "and"/"then" acts on what came before: "\u2026 al ve bor\u00e7 ver" = "\u2026 and lend it".
  const parts = out.split(/(\s+(?:and|then)\s+)/u);
  for (let i = 2; i < parts.length; i += 2) {
    const clause = parts[i] as string;
    if (!hasObject(clause)) parts[i] = `${clause.trimEnd()} it`;
  }
  return parts.join("").replace(/\s+/gu, " ").trim();
}

/* ------------------------------------------------------------- intents */

/**
 * Turkish questions and requests about Lykia itself and about things already
 * running, rewritten into the English the desk and the self-knowledge reader
 * match on (agents/desk.ts, core selfKnowledge). It is a vocabulary, not a
 * translator: the output is keywords in English order where order matters
 * ("will EURC go up?", "what is ...?"), good enough to pick the intent.
 * The planner's reader keeps using turkishToEnglish above, unchanged.
 */
const INTENT_REWRITES: readonly (readonly [RegExp, string])[] = [
  // Whole questions first.
  [w("neler yapabil(?:ir|iyor)s[iu]n|ne(?:ler)? yapabil(?:ir|iyor)s[iu]n|ne i\u015fe yar(?:ar|\u0131yor)s[\u0131i]n"), "what can you do"],
  [w("neleri? yapam(?:az|\u0131yor)s[\u0131i]n|ne yapam(?:az|\u0131yor)s[\u0131i]n"), "what can't you do"],
  [new RegExp(`(${L}+)\\s+(?:y\u00fckselecek|y\u00fckselir|artacak|artar|\u00e7\u0131kacak) m[\u0131i]`, "giu"), "will $1 go up"],
  [new RegExp(`(${L}+)\\s+(?:d\u00fc\u015fecek|d\u00fc\u015fer|azalacak) m[\u0131i]`, "giu"), "will $1 go down"],
  [w("likide olursam|tasfiye olursam|likidasyon olursa|likide olursa"), "i get liquidated what happens if"],
  [w("ad\u0131m ba\u015far\u0131s\u0131z olursa|i\u015flem ba\u015far\u0131s\u0131z olursa"), "a step fails what happens if"],
  [w("ne olur|ne olacak"), "what happens"],
  [w("ne kadar \u00f6dedim|ka\u00e7 para \u00f6dedim|ne \u00f6dedim"), "what did i pay"],
  [w("neden ba\u015far\u0131s\u0131z oldu|neden olmad\u0131|niye olmad\u0131|neden reddedildi"), "why did it fail"],
  [w("paray\u0131 sen mi tutuyorsun|param\u0131 sen mi tutuyorsun|param sende mi"), "do you hold my money"],
  [w("benim yerime imzala(?:yabilir misin|r m\u0131s\u0131n)?|imzalayabilir misin"), "can you sign for me"],
  [w("c\u00fczdan(?:\u0131m\u0131)? ba\u011flamam gerek(?:iyor mu|li mi|ir mi)|c\u00fczdan ba\u011flamak (?:\u015fart|gerekli|zorunlu) m\u0131"), "do i need to connect a wallet"],
  [w("imza gerek(?:iyor mu|ir mi|li mi)|neyi imzal(?:\u0131yorum|amam gerek)"), "what needs a signature"],
  [w("neler? \u00e7al\u0131\u015f\u0131yor|\u00e7al\u0131\u015fanlar\u0131 g\u00f6ster"), "what is running"],
  [w("param nerede|param ne durumda|param ne yap\u0131yor"), "where is my money"],
  [w("neden yapam(?:\u0131yor|az)s[\u0131i]n|niye yapam(?:\u0131yor|az)s[\u0131i]n|neden olmuyor"), "why can't you"],
  [w("g\u00f6nderebilir misin|yollayabilir misin"), "can you send"],
  [w("yapabilir misin|yapabiliyor musun|edebilir misin|yapar m\u0131s\u0131n|m\u00fcmk\u00fcn m\u00fc|destekliyor musun|var m\u0131|olur mu"), "can you"],
  [w("\\p{L}+[ea]bil(?:ir|iyor) m[\u0131iu\u00fc]s[\u0131iu\u00fc]n"), "can you"],
  [w("nedir|ne demek|ne anlama gel(?:iyor|ir)|ne i\u015fe yarar|a\u00e7\u0131kla"), "what is"],
  [w("nas\u0131l \u00e7al\u0131\u015f\u0131r|nas\u0131l \u00e7al\u0131\u015f\u0131yor|nas\u0131l i\u015fler"), "how does it work what is"],
  [w("ne kadar|ka\u00e7 para|ka\u00e7"), "how much"],
  [w("g\u00fcvenli mi|g\u00fcvenilir mi|emniyetli mi|riskli mi|g\u00fcvende mi"), "is safe"],
  // Nouns of Lykia's world.
  [w("\u00fccret(?:ler(?:i|in)?|i|leri)?|komisyon(?:u|lar)?|masraf(?:\u0131|lar)?|kesinti"), "fees"],
  [w("\u00fccretsiz(?: mi)?|bedava(?: m\u0131)?"), "free"],
  [w("limit(?:i|ler|leri|im)?|s\u0131n\u0131r(?:\u0131|lar\u0131|\u0131m)?|\u00fcst s\u0131n\u0131r|tavan(?:\u0131)?"), "limit"],
  [w("en fazla|en \u00e7ok|maksimum|azami"), "most"],
  [w("sa\u011fl\u0131k fakt\u00f6r\u00fc(?:m|n\u00fc|m\u00fc)?"), "health factor"],
  [w("sa\u011fl\u0131\u011f\u0131(?:n\u0131)?|sa\u011fl\u0131k(?:lar\u0131n\u0131)?"), "health"],
  [w("riskte olan|risk alt\u0131ndaki|riskli"), "at risk"],
  [w("risk(?:i|ini|imi|leri)"), "risk"],
  [w("pozisyon(?:lar)?(?:\u0131m|\u0131m\u0131z)?(?:\u0131|\u0131n|\u0131n\u0131|daki)?"), "positions"],
  [w("kredi(?:ler)?(?:im)?(?:i|in|ini)?|bor\u00e7(?:lar)?(?:\u0131m)?(?:\u0131|\u0131n|\u0131n\u0131)?|borcu(?:mu|m)?"), "loans"],
  [w("teminat(?:\u0131m)?(?:\u0131)?"), "collateral"],
  [w("kayma|slipaj"), "slippage"],
  [w("kesinlik|nihailik"), "finality"],
  [w("k\u00f6pr\u00fc(?:s\u00fc|leme|lemek|y\u00fc)?"), "bridge"],
  [w("perp(?:ler)?|vadeli(?: i\u015flem(?:ler)?)?|kald\u0131ra\u00e7(?:l\u0131)?"), "perps"],
  [w("banka(?:ma|ya| hesab\u0131ma| hesab\u0131na)?"), "bank"],
  [w("vergi(?:si|ler)?"), "tax"],
  [w("\u00f6deme(?:si|yi|sini|ler)?"), "payment"],
  [w("emr(?:i|imi|ini)|emir(?:ler)?(?:imi)?"), "order"],
  [w("otomasyon(?:u|lar)?"), "automation"],
  [w("ajan(?:\u0131|\u0131m\u0131)?|bot(?:u|umu)?"), "bot"],
  [w("cuma"), "friday"],
  [w("kira(?:y\u0131|s\u0131)?"), "rent"],
  [w("bo\u015fta(?:ki)?|at\u0131l|bo\u015f duran"), "idle"],
  [w("param(?:\u0131)?|paray\u0131|para"), "my money"],
  [w("bakiyem?|bakiye"), "my balance"],
  [w("i\u015flem(?:i|ler)?"), "trade"],
  // Verbs.
  [w("d\u00fczelt(?:ir misin)?|iyile\u015ftir|onar|toparla|kurtar"), "fix"],
  [w("koru"), "protect"],
  [w("azalt|d\u00fc\u015f\u00fcr"), "reduce"],
  [w("her \u015feyden \u00e7\u0131k|hepsinden \u00e7\u0131k|t\u00fcm pozisyonlardan \u00e7\u0131k"), "exit everything"],
  [w("her \u015feyi|her\u015feyi|heps\u0069ni|t\u00fcm\u00fcn\u00fc|b\u00fct\u00fcn\u00fc"), "everything"],
  [w("kapat"), "close"],
  [w("duraklat|beklet"), "pause"],
  [w("durdur"), "stop"],
  [w("devam ettir|s\u00fcrd\u00fcr|yeniden ba\u015flat"), "resume"],
  [w("iptal et|vazge\u00e7"), "cancel"],
  [w("kald\u0131r|sil"), "remove"],
  [w("geri al"), "undo"],
  [w("\u00e7al\u0131\u015ft\u0131r|de\u011ferlendir|i\u015fe koy"), "put to work"],
  [w("son takas\u0131m\u0131|son takas\u0131|son i\u015flemimi"), "last swap"],
  [w("lending"), "lending"],
  [w("ve"), "and"],
];

/** "USDC'ye", "Base'e", "Arbitrum'a": a Turkish dative on a token or a chain is "to X". */
const DATIVE = /(?<![\p{L}\p{N}])(USDC|EURC|cirBTC|WETH|Base|Arbitrum|Ethereum|Optimism|Polygon|Avalanche|Solana)['’](?:y)?[ea](?![\p{L}\p{N}])/giu;

/** The text as English intent keywords when it looks Turkish; otherwise unchanged. */
export function turkishIntent(text: string): string {
  if (!TURKISH_LETTERS.test(text) && !looksTurkishQuestion(text)) return text;
  const question = /\?|(?<![\p{L}])m[\u0131iu\u00fc](?:s[\u0131iu\u00fc]n)?\s*[?.!]*$|nedir|ne kadar|neden|niye|nas\u0131l/iu.test(text);
  let out = text.replace(DATIVE, "to $1");
  for (const [re, to] of INTENT_REWRITES) out = out.replace(re, ` ${to} `);
  // What is left of the planner's vocabulary (verbs like convert, send, repay) still reads in English.
  out = turkishToEnglish(out).replace(/\s+/gu, " ").replace(/\s+\?/gu, "?").trim();
  // English question order where the readers need it: "Fence what is" -> "what is Fence".
  const lead = /\b(what is|what can you do|what can't you do|can you|why can't you|how much|what happens if|what happens|is safe|will \S+ go (?:up|down)|what did i pay|why did it fail|do you hold my money|can you sign for me|do i need to connect a wallet|what needs a signature|what is running|where is my money)\b/iu.exec(out);
  if (lead && lead.index > 0) {
    const rest = `${out.slice(0, lead.index)} ${out.slice(lead.index + lead[0].length)}`.replace(/[?.!]+/gu, " ").replace(/\s+/gu, " ").trim();
    out = lead[1]!.toLowerCase() === "is safe" ? `is ${rest} safe` : `${lead[1]} ${rest}`;
  }
  out = out.replace(/[?.!\s]+$/u, "");
  // Turkish puts the verb last ("cuma \u00f6demesini durdur"); the readers expect it first ("stop friday payment").
  const last = /^(.*\S)\s+(fix|protect|reduce|close|pause|stop|resume|cancel|remove|undo|exit everything)$/iu.exec(out);
  if (!lead && last) out = `${last[2]} ${last[1]}`;
  const work = /^(.*\S)\s+put to work$/iu.exec(out);
  if (!lead && work) out = `put ${work[1]} to work`;
  return question ? `${out}?` : out;
}

/** Turkish written without its special letters still shows in a few question words. */
function looksTurkishQuestion(text: string): boolean {
  return /(?<![\p{L}])(?:nedir|neden|niye|neler|yapabilirsin|yapabilir misin|ne kadar|ne olur|olursam|limiti|riskte olan|param|misin|musun|durdur|duraklat|iptal et|kapat)(?![\p{L}])/iu.test(text);
}
