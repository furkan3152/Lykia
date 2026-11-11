/**
 * Common money requests in Spanish, Brazilian Portuguese, French and
 * Simplified Chinese, rewritten into the English the deterministic reader
 * parses (Turkish has its own module, language/turkish.ts). Conservative:
 * each table runs only when the text looks like that language, maps a short
 * list of verbs, connectors and quantities, and leaves tokens, amounts and
 * addresses exactly as written. Lyko answers in the interface language
 * whatever the input language.
 *
 * The repository is English only outside its translation catalogues, so
 * every non-English letter below is written as a Unicode escape.
 */
import { looksTurkish, turkishIntent, turkishToEnglish } from "./turkish.js";

const L = "[\\p{L}\\p{N}_]";
function w(body: string): RegExp {
  return new RegExp(`(?<!${L})(?:${body})(?!${L})`, "giu");
}

interface Table {
  readonly detect: RegExp;
  readonly rules: readonly (readonly [RegExp, string])[];
}

const TABLES: Readonly<Record<"es" | "pt-BR" | "fr" | "zh-CN", Table>> = {
  "es": {
    detect: new RegExp("(?<![\\p{L}])(?:convierte|convertir|cambia|intercambia|env\\u00eda|envia|manda|paga|deposita|retira|pasa|puente|pide prestado|devuelve|compra|vende|pon a trabajar|mis|mi|todo|todos|la mitad|y luego|luego|cu\\u00e1nto|cuanto|d\\u00f3nde|donde|qu\\u00e9|que puedes|saldo|comisiones|det\\u00e9n|deten|pausa|reanuda|cancela|av\\u00edsame|avisame|pr\\u00e9stamo|prestamo|inactivos?)(?![\\p{L}])|[\\u00bf\\u00a1\\u00f1]", "iu"),
    rules: [
      [w("\\u00bfqu\\u00e9 puedes hacer\\??|que puedes hacer\\??"), "what can you do?"],
      [w("\\u00bfd\\u00f3nde est\\u00e1 mi dinero\\??|donde esta mi dinero\\??"), "where is my money?"],
      [w("\\u00bfcu\\u00e1l es mi saldo\\??|cual es mi saldo\\??|mi saldo"), "what is my balance?"],
      [w("\\u00bfqu\\u00e9 pagu\\u00e9 en comisiones\\??|que pague en comisiones\\??"), "what did i pay in fees?"],
      [w("\\u00bfc\\u00f3mo est\\u00e1 mi gas\\??|como esta mi gas\\??"), "how is my gas?"],
      [w("arregla la salud de mi pr\\u00e9stamo|arregla la salud de mi prestamo"), "fix my loan health"],
      [w("av\\u00edsame si|avisame si"), "tell me if"],
      [w("factor de salud"), "health factor"],
      [w("baja de|cae por debajo de|cae bajo"), "drops below"],
      [w("pon a trabajar|poner a trabajar"), "put to work"],
      [w("con bajo riesgo"), "at low risk"],
      [w("inactivos?|ociosos?|parados?"), "idle"],
      [w("pide prestados?|pedir prestado"), "borrow"],
      [w("devuelve|devolver|paga el pr\\u00e9stamo|paga el prestamo"), "repay"],
      [w("convierte|convertir|cambia"), "convert"],
      [w("intercambia|intercambiar"), "swap"],
      [w("env\\u00eda|envia|manda|transfiere"), "send"],
      [w("paga|pagar"), "pay"],
      [w("deposita|depositar"), "deposit"],
      [w("retira|retirar|saca"), "withdraw"],
      [w("pasa por puente|haz puente de|p\\u00e1salo a|pasalo a|pasa"), "bridge"],
      [w("compra|comprar"), "buy"],
      [w("vende|vender"), "sell"],
      [w("det\\u00e9n todo|deten todo|para todo|detenlo todo"), "stop everything"],
      [w("pausa|pausar"), "pause"],
      [w("reanuda|reanudar"), "resume"],
      [w("cancela|cancelar"), "cancel"],
      [w("y luego|luego|despu\\u00e9s|despues"), "then"],
      [w("la mitad"), "half"],
      [w("todos? mis|todo mi|todas mis|toda mi"), "all my"],
      [w("mis|mi"), "my"],
      [w("en|a|hacia"), "to"],
      [w("de"), "from"],
      [w("con"), "with"],
      [w("por la factura"), "for invoice"],
      [w("y"), "and"],
    ],
  },
  "pt-BR": {
    detect: new RegExp("(?<![\\p{L}])(?:converta|converter|troque|trocar|envie|mande|pague|deposite|saque|fa\\u00e7a bridge|faca bridge|pegue emprestado|compre|venda|coloque|meu|minha|meus|tudo|metade|depois|quanto|onde|o que voc\\u00ea|o que voce|saldo|taxas|pare|pause|retome|cancele|me avise|empr\\u00e9stimo|emprestimo|parado)(?![\\p{L}])|[\\u00e3\\u00f5\\u00e7\\u00ea]", "iu"),
    rules: [
      [w("o que voc\\u00ea pode fazer\\??|o que voce pode fazer\\??"), "what can you do?"],
      [w("onde est\\u00e1 o meu dinheiro\\??|onde esta o meu dinheiro\\??|onde est\\u00e1 meu dinheiro\\??"), "where is my money?"],
      [w("qual \\u00e9 o meu saldo\\??|qual e o meu saldo\\??|meu saldo"), "what is my balance?"],
      [w("quanto paguei de taxas\\??"), "what did i pay in fees?"],
      [w("como est\\u00e1 meu gas\\??|como esta meu gas\\??"), "how is my gas?"],
      [w("corrija a sa\\u00fade do meu empr\\u00e9stimo|corrija a saude do meu emprestimo"), "fix my loan health"],
      [w("me avise se"), "tell me if"],
      [w("fator de sa\\u00fade|fator de saude"), "health factor"],
      [w("cair abaixo de|ficar abaixo de"), "drops below"],
      [w("coloque (.+?) para render"), "put $1 to work"],
      [w("com baixo risco"), "at low risk"],
      [w("parados?|parado"), "idle"],
      [w("pegue emprestados?|pegar emprestado"), "borrow"],
      [w("pague o empr\\u00e9stimo|pague o emprestimo"), "repay"],
      [w("converta|converter"), "convert"],
      [w("troque|trocar"), "swap"],
      [w("envie|mande|transfira"), "send"],
      [w("pague"), "pay"],
      [w("deposite|depositar"), "deposit"],
      [w("saque|sacar|retire"), "withdraw"],
      [w("fa\\u00e7a bridge de|faca bridge de|fa\\u00e7a bridge|faca bridge"), "bridge"],
      [w("compre|comprar"), "buy"],
      [w("venda|vender"), "sell"],
      [w("pare tudo"), "stop everything"],
      [w("pause|pausar"), "pause"],
      [w("retome|retomar"), "resume"],
      [w("cancele|cancelar"), "cancel"],
      [w("e depois|depois"), "then"],
      [w("metade"), "half"],
      [w("todo o meu|todos os meus|tudo"), "all my"],
      [w("meus|meu|minhas|minha"), "my"],
      [w("para a|para o|para|na|no"), "to"],
      [w("da|do|de"), "from"],
      [w("com"), "with"],
      [w("pela fatura"), "for invoice"],
      [w("e"), "and"],
    ],
  },
  "fr": {
    detect: new RegExp("(?<![\\p{L}])(?:convertis|convertir|\\u00e9change|echange|envoie|paie|d\\u00e9pose|depose|retire|emprunte|rembourse|ach\\u00e8te|achete|vends|mets|mes|mon|ma|tout|la moiti\\u00e9|la moitie|puis|combien|o\\u00f9|ou est|que peux-tu|solde|frais|arr\\u00eate|arrete|reprends|annule|pr\\u00e9viens-moi|previens-moi|pr\\u00eat|pret|inactifs?)(?![\\p{L}])|[\\u00e9\\u00e8\\u00e0\\u00f9\\u00e2\\u00ea\\u00ee\\u00f4\\u00fb\\u00e7]", "iu"),
    rules: [
      [w("que peux-tu faire\\s*\\??|que peux tu faire\\s*\\??"), "what can you do?"],
      [w("o\\u00f9 est mon argent\\s*\\??|ou est mon argent\\s*\\??"), "where is my money?"],
      [w("quel est mon solde\\s*\\??|mon solde"), "what is my balance?"],
      [w("combien ai-je pay\\u00e9 en frais\\s*\\??|combien ai-je paye en frais\\s*\\??"), "what did i pay in fees?"],
      [w("o\\u00f9 en est mon gas\\s*\\??|ou en est mon gas\\s*\\??"), "how is my gas?"],
      [w("corrige la sant\\u00e9 de mon pr\\u00eat|corrige la sante de mon pret"), "fix my loan health"],
      [w("pr\\u00e9viens-moi si|previens-moi si|pr\\u00e9viens moi si"), "tell me if"],
      [w("facteur de sant\\u00e9|facteur de sante"), "health factor"],
      [w("passe sous|tombe sous|descend sous"), "drops below"],
      [w("mets (.+?) au travail"), "put $1 to work"],
      [w("avec un faible risque|\\u00e0 faible risque|a faible risque"), "at low risk"],
      [w("inactifs?|inactives?|qui dorment"), "idle"],
      [w("emprunte|emprunter"), "borrow"],
      [w("rembourse|rembourser"), "repay"],
      [w("convertis|convertir|convertit"), "convert"],
      [w("\\u00e9change|echange|\\u00e9changer"), "swap"],
      [w("envoie|envoyer|transf\\u00e8re|transfere"), "send"],
      [w("paie|payer|paye"), "pay"],
      [w("d\\u00e9pose|depose|d\\u00e9poser"), "deposit"],
      [w("retire|retirer"), "withdraw"],
      [w("par bridge|via bridge"), ""],
      [w("ach\\u00e8te|achete|acheter"), "buy"],
      [w("vends|vendre"), "sell"],
      [w("arr\\u00eate tout|arrete tout"), "stop everything"],
      [w("mets en pause|mettre en pause|pause"), "pause"],
      [w("reprends|reprendre"), "resume"],
      [w("annule|annuler"), "cancel"],
      [w("puis|ensuite"), "then"],
      [w("la moiti\\u00e9 de|la moitie de|la moiti\\u00e9|la moitie"), "half"],
      [w("tous mes|tout mon|toutes mes|toute ma"), "all my"],
      [w("mes|mon|ma"), "my"],
      [w("en|vers|sur"), "to"],
      [w("de|du|des"), "from"],
      [w("avec|contre"), "with"],
      [w("pour la facture"), "for invoice"],
      [w("et"), "and"],
    ],
  },
  "zh-CN": {
    detect: new RegExp("[\\u3400-\\u9fff]", "iu"),
    rules: [
      [new RegExp("\\u628a\\s*(.+?)\\s*(?:\\u5151\\u6362\\u6210|\\u6362\\u6210)\\s*", "giu"), " convert $1 to "],
      [new RegExp("\\u628a\\s*(.+?)\\s*\\u8de8\\u94fe\\u5230\\s*", "giu"), " bridge $1 to "],
      [new RegExp("\\u4f60\\u80fd\\u505a\\u4ec0\\u4e48[\\uff1f?]?|\\u4f60\\u53ef\\u4ee5\\u505a\\u4ec0\\u4e48[\\uff1f?]?", "giu"), " what can you do? "],
      [new RegExp("\\u6211\\u7684\\u94b1\\u5728\\u54ea\\u91cc[\\uff1f?]?|\\u6211\\u7684\\u94b1\\u5728\\u54ea[\\uff1f?]?", "giu"), " where is my money? "],
      [new RegExp("\\u6211\\u7684\\u4f59\\u989d\\u662f\\u591a\\u5c11[\\uff1f?]?|\\u6211\\u7684\\u4f59\\u989d", "giu"), " what is my balance? "],
      [new RegExp("\\u6211\\u4ed8\\u4e86\\u591a\\u5c11\\u8d39\\u7528[\\uff1f?]?", "giu"), " what did i pay in fees? "],
      [new RegExp("\\u6211\\u7684\\s*Gas\\s*\\u600e\\u4e48\\u6837[\\uff1f?]?|\\u6211\\u7684gas\\u600e\\u4e48\\u6837[\\uff1f?]?", "giu"), " how is my gas? "],
      [new RegExp("\\u4fee\\u590d\\u6211\\u7684\\u8d37\\u6b3e\\u5065\\u5eb7", "giu"), " fix my loan health "],
      [new RegExp("\\u5982\\u679c\\u6211\\u7684\\u5065\\u5eb7\\u56e0\\u5b50\\u4f4e\\u4e8e", "giu"), " tell me if my health factor drops below "],
      [new RegExp("\\u5065\\u5eb7\\u56e0\\u5b50", "giu"), " health factor "],
      [new RegExp("\\u4f4e\\u4e8e", "giu"), " below "],
      [new RegExp("\\u4ee5\\u4f4e\\u98ce\\u9669", "giu"), " at low risk "],
      [new RegExp("\\u95f2\\u7f6e\\u7684?", "giu"), " idle "],
      [new RegExp("\\u6295\\u5165\\u4f7f\\u7528|\\u8d5a\\u6536\\u76ca|\\u53bb\\u8d5a\\u6536\\u76ca", "giu"), " to work "],
      [new RegExp("\\u5151\\u6362\\u6210|\\u6362\\u6210", "giu"), " to "],
      [new RegExp("\\u8de8\\u94fe\\u5230", "giu"), " bridge to "],
      [new RegExp("\\u53d1\\u9001\\u5230|\\u8f6c\\u5230|\\u53d1\\u9001\\u7ed9|\\u8f6c\\u7ed9|\\u53d1\\u7ed9", "giu"), " to "],
      [new RegExp("\\u5151\\u6362|\\u6362", "giu"), " convert "],
      [new RegExp("\\u53d1\\u9001|\\u8f6c\\u8d26|\\u8f6c", "giu"), " send "],
      [new RegExp("\\u5b58\\u5165", "giu"), " deposit "],
      [new RegExp("\\u53d6\\u51fa|\\u63d0\\u53d6", "giu"), " withdraw "],
      [new RegExp("\\u501f\\u5165|\\u501f", "giu"), " borrow "],
      [new RegExp("\\u507f\\u8fd8|\\u8fd8\\u6b3e|\\u8fd8", "giu"), " repay "],
      [new RegExp("\\u4e70\\u5165|\\u8d2d\\u4e70|\\u4e70", "giu"), " buy "],
      [new RegExp("\\u5356\\u51fa|\\u5356", "giu"), " sell "],
      [new RegExp("\\u505c\\u6b62\\u4e00\\u5207|\\u5168\\u90e8\\u505c\\u6b62", "giu"), " stop everything "],
      [new RegExp("\\u6682\\u505c", "giu"), " pause "],
      [new RegExp("\\u6062\\u590d", "giu"), " resume "],
      [new RegExp("\\u53d6\\u6d88", "giu"), " cancel "],
      [new RegExp("\\u7136\\u540e", "giu"), " then "],
      [new RegExp("\\u4e00\\u534a", "giu"), " half "],
      [new RegExp("\\u6211\\u6240\\u6709\\u7684|\\u5168\\u90e8\\u7684|\\u6240\\u6709", "giu"), " all my "],
      [new RegExp("\\u6211\\u7684", "giu"), " my "],
      [new RegExp("\\u628a", "giu"), " "],
      [new RegExp("\\u8ba9", "giu"), " put "],
      [new RegExp("\\u7528", "giu"), " with "],
      [new RegExp("\\u548c", "giu"), " and "],
      [new RegExp("\\uff0c|\\u3002", "giu"), " "],
    ],
  },
};

/** Which supported language a request looks like, beyond English and Turkish (the first table that matches). */
export function inputLanguage(text: string): keyof typeof TABLES | null {
  // The language with the most telltale words wins (Spanish and Portuguese share some).
  let best: keyof typeof TABLES | null = null;
  let most = 0;
  for (const [lang, table] of Object.entries(TABLES) as [keyof typeof TABLES, Table][]) {
    const hits = text.match(new RegExp(table.detect.source, "giu"))?.length ?? 0;
    if (hits > most) [best, most] = [lang, hits];
  }
  return best;
}

function rewrite(text: string): string {
  // Turkish has its own reader; its words never go through these tables.
  if (looksTurkish(text)) return text;
  const lang = inputLanguage(text);
  if (!lang) return text;
  let out = text;
  for (const [re, to] of TABLES[lang].rules) out = out.replace(re, to);
  return out.replace(/\s+/gu, " ").replace(/\s+([?.!,])/gu, "$1").trim();
}

/** A request in reader English: Spanish, Portuguese, French and Chinese rewritten, then Turkish. */
export function readerEnglish(text: string): string {
  return turkishToEnglish(rewrite(text));
}

/** Intent keywords in English for the desk and the follow-up reader, whatever supported language the owner wrote in. */
export function intentEnglish(text: string): string {
  return turkishIntent(rewrite(text));
}
