/** Landing copy, English and Turkish. */
import type { LykoMood } from "@lykia/core";

export const HERO = {
  tag: { en: "Agents + stablecoins · built on Arc Network", tr: "Agent'lar + stablecoin'ler · Arc Network üzerinde" },
  title1: { en: "Arc gives agents money.", tr: "Agent'ın parası Arc'ta," },
  title2: { en: "Lyko keeps them in line.", tr: "aklı Lyko'da." },
  lede: {
    en: "Say an outcome. Lykia plans it across Arc's venues, checks it against your Fence, hands each step to your own wallet or agent wallet to sign, and it is final in under a second. Lyko, the shepherd dog, keeps the wolves out.",
    tr: "Bir sonuç söyle. Lykia bunu Arc'taki protokoller üzerinden planlar, Çit'ine göre denetler, her adımı kendi cüzdanına ya da agent cüzdanına imzalatır ve bir saniyenin altında kesinleşir. Çoban köpeği Lyko kurtları uzak tutar.",
  },
  cta: { en: "Open the deck", tr: "Masayı aç" },
  build: { en: "Build on it", tr: "Üstüne inşa et" },
} as const;

export interface StoryStep {
  readonly mood: LykoMood;
  readonly time: string;
  readonly title: { readonly en: string; readonly tr: string };
  readonly body: { readonly en: string; readonly tr: string };
}

export const STORY: readonly StoryStep[] = [
  {
    mood: "herding",
    time: "0:00",
    title: { en: "Say it", tr: "Söyle" },
    body: { en: "“Put half my USDC to work, convert 200 to EURC.” One sentence becomes an Outrun across Arc venues.", tr: "“USDC'min yarısını çalıştır, 200'ünü EURC'ye çevir.” Tek cümle, Arc protokolleri üzerinde bir Outrun olur." },
  },
  {
    mood: "watching",
    time: "0:10",
    title: { en: "The Fence decides", tr: "Çit karar verir" },
    body: { en: "Caps, venues, slippage, health factor, FX band, recipients, hours. Every rule gives a reason: allow, confirm or deny.", tr: "Limitler, protokoller, kayma, sağlık faktörü, kur bandı, alıcılar, saatler. Her kural bir gerekçe verir: izin, onay ya da ret." },
  },
  {
    mood: "proud",
    time: "0:20",
    title: { en: "Signed within limits", tr: "Limitler içinde imza" },
    body: { en: "Your wallet, or an agent wallet inside its Fence, signs. Lykia never holds keys and never signs.", tr: "Cüzdanın ya da Çit'inin içindeki bir agent cüzdanı imzalar. Lykia anahtar tutmaz, asla imzalamaz." },
  },
  {
    mood: "proud",
    time: "0:30",
    title: { en: "Final in under a second", tr: "Bir saniyenin altında kesin" },
    body: { en: "Arc finality is deterministic. Each step carries an Arc Memo with the outrun id and the verdict digest: anyone can follow the money.", tr: "Arc'ta kesinlik deterministik. Her adım, outrun kimliği ve karar özetiyle bir Arc Memo taşır: parayı herkes takip edebilir." },
  },
  {
    mood: "growling",
    time: "0:40",
    title: { en: "A wolf at the fence", tr: "Çitte bir kurt" },
    body: { en: "“Buy that new token with 10x.” Scent finds the wolves, the Fence denies, and says why.", tr: "“Şu yeni token'dan 10x al.” Koku kurtları bulur, Çit reddeder ve nedenini söyler." },
  },
  {
    mood: "resting",
    time: "0:50",
    title: { en: "Blow the whistle", tr: "Düdüğü çal" },
    body: { en: "“Lie down.” New risk stops at once. Bringing the flock home (repay, withdraw to you) always works.", tr: "“Lie down.” Yeni risk anında durur. Sürüyü eve getirmek (borç ödeme, sana çekme) her zaman çalışır." },
  },
];

export const PILLARS = [
  {
    key: "kunye",
    title: { en: "Künye", tr: "Künye" },
    body: {
      en: "An agent's tag: an ERC-8004 identity on Arc whose card pins the hash of the Fence it obeys. Verdicts are filed to the ValidationRegistry, so standing is earned on-chain.",
      tr: "Agent'ın künyesi: Arc'ta, uyduğu Çit'in hash'ini kartına sabitleyen bir ERC-8004 kimliği. Kararlar ValidationRegistry'ye yazılır; itibar zincir üzerinde kazanılır.",
    },
  },
  {
    key: "outrun",
    title: { en: "Outrun", tr: "Outrun" },
    body: {
      en: "One plan across Arc venues: CCTP, Gateway, StableFX, vaults and lending. Approve and act batched through Multicall3From into one final transaction.",
      tr: "Arc protokolleri üzerinde tek plan: CCTP, Gateway, StableFX, kasalar ve borç verme. Onay ve işlem Multicall3From ile tek kesin işlemde birleşir.",
    },
  },
  {
    key: "scent",
    title: { en: "Scent", tr: "Koku" },
    body: {
      en: "What can be proven about a token before anyone touches it: registry, bytecode, proxies, privileges, owner and a simulated buy and sell. Never “safe”.",
      tr: "Bir token hakkında, kimse dokunmadan önce kanıtlanabilenler: kayıt, bytecode, proxy'ler, yetkiler, sahip ve simüle alım-satım. Asla “güvenli” demez.",
    },
  },
  {
    key: "flock",
    title: { en: "Flock", tr: "Sürü" },
    body: {
      en: "A treasury view for stablecoin businesses: wallet, Gateway unified balance and venues in one sheet. Unpriced stays unpriced, never zero.",
      tr: "Stablecoin işletmeleri için hazine görünümü: cüzdan, Gateway birleşik bakiyesi ve protokoller tek tabloda. Fiyatsız olan fiyatsız kalır, asla sıfır değil.",
    },
  },
] as const;
