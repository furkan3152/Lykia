/**
 * Lyko on watch without a model: the Fold's read-only answer mode. It reads
 * the position map (or the sample fixture when signed out), answers with a
 * sourced facts card and a short verdict in which every figure carries its
 * source and its block or read time, and never plans: a request to move
 * money is pointed to Ask Lyko. When a figure cannot be read it says
 * "unavailable", never an estimate.
 */
import { intlTag } from "../i18n/format.js";
import { isSampleOwner } from "@lykia/core";
import { sourceLine, type AnswerBlock, type BlockSource } from "@lykia/core/api/answer";
import { balanceCard, emitBlock, gasCard, infoQuestion, positionsFacts, rateCard, stepsFor } from "./cards.js";
import type { DeterministicInput } from "./deterministic.js";
import type { TurnResult } from "./orchestrator.js";
import { foldPositions, foldSnapshot } from "../fold/sample.js";

import { tx } from "@lykia/core";
const MOVE = /\b(?:send|pay|swap|convert|bridge|deposit|withdraw|put .* to work|earn on|buy|sell|borrow|repay|lend|stake|move|transfer|plan|draft|set up|create)\b/iu;

function done(input: DeterministicInput, text: string): TurnResult {
  input.emit("text", { text });
  return { text, proposals: [], stopReason: "end_turn", delegations: 0, modelCalls: 0 };
}

/** "Arc chain and venue APIs · block 29857405" (or the read time when there is no block), with "sample" for the fixture. */
const cite = (from: BlockSource, sample: boolean) => (sample ? tx("sample, not read from Arc") : sourceLine(from));

export async function watchTurn(input: DeterministicInput): Promise<TurnResult> {
  const steps = stepsFor(input.emit);
  const owner = input.owner;
  const sample = isSampleOwner(owner);
  if (MOVE.test(input.message) && !/\?\s*$/u.test(input.message.trim())) {
    // Reached only for the sample flock: a real owner's request to act is planned (agents/chat.ts).
    steps.start("intent", tx("Reading your request")).end("ok", tx("A move on the sample flock"));
    return done(input, tx("This is the sample flock, so there is nothing of yours to move.\n\n**Next:** connect a wallet and I plan this for your own money."));
  }
  if (!owner) return done(input, tx("Connect a wallet so I can read its Fold."));
  const question = infoQuestion(input.message);
  if (question?.kind === "rate") {
    const pricing = steps.start("price", tx("Checking the reference rate"));
    const card = await rateCard(input.ctx, question.base, question.quote, input.fence);
    if (!card || card.kind !== "rate") {
      pricing.end("fail", tx("Unavailable"));
      return done(input, tx("The {base}/{quote} reference rate is unavailable right now: the Chainlink price is stale or could not be read.\n\n**Next:** ask again in a minute.", { base: question.base, quote: question.quote }));
    }
    pricing.end(card.from?.stale ? "warn" : "ok", `1 ${card.base} = ${card.rate} ${card.quote}`, card.from ? sourceLine(card.from) : undefined);
    emitBlock(input.emit, card);
    return done(input, tx("1 {base} = {rate} {quote} at the reference rate.\n\n- **Source:** {value}\n\n**Next:** say “convert 100 {base} to {quote}” for a routed quote.", { base: card.base, rate: card.rate, quote: card.quote, value: card.from ? sourceLine(card.from) : "unavailable" }));
  }
  if (question?.kind === "gas" || question?.kind === "balance") {
    const reading = steps.start("wallet", tx("Reading the wallet"));
    const snap = await foldSnapshot(input.ctx, input.environment, owner, { fixture: "fold" }).catch(() => null);
    if (!snap) {
      reading.end("fail", tx("Unavailable"));
      return done(input, tx("The wallet is unavailable right now: Arc did not answer.\n\n**Next:** ask again in a moment."));
    }
    const card: AnswerBlock | null = question.kind === "gas" ? await gasCard(input.ctx, input.environment, owner, snap, sample) : balanceCard(snap);
    reading.end("ok", question.kind === "gas" ? tx("Gas read") : tx("Holdings read"), card && "from" in card && card.from ? sourceLine(card.from) : undefined);
    emitBlock(input.emit, card);
    if (card?.kind === "gas") return done(input, tx("Gas: {balance} USDC against your {floor} USDC floor.\n\n- **Source:** {value}\n\n**Next:** nothing to do unless it sits under the floor.", { balance: card.balance, floor: card.floor, value: card.from ? cite(card.from, sample) : "unavailable" }));
    if (card?.kind === "balance") return done(input, tx("{value} {value2}.\n\n- **Source:** {value3}{value4}\n\n**Next:** open the Flock tab for every position.", { value: sample ? tx("The sample flock holds") : tx("You hold"), value2: card.totalUsd === null ? tx("a total that is unavailable (some holdings are unpriced)") : `$${Number(card.totalUsd).toLocaleString(intlTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, value3: card.from ? cite(card.from, sample) : "unavailable", value4: card.unpriced ? tx("\n- **Unpriced:** {unpriced, plural, one {# holding} other {# holdings}}, shown without a value, never as $0", { unpriced: card.unpriced }) : "" }));
  }
  const reading = steps.start("wallet", tx("Reading every venue"));
  const res = await foldPositions(input.ctx, input.environment, owner, { personal: input.ownerVerified === true, fixture: "fold" }).catch(() => null);
  if (!res) {
    reading.end("fail", tx("Unavailable"));
    return done(input, tx("Your positions are unavailable right now: the venues did not answer.\n\n**Next:** ask again in a moment."));
  }
  const facts = positionsFacts(res, sample ? tx("The sample flock") : tx("Your Fold, read now"), { sample });
  reading.end(res.summary.unavailable.length > 0 ? "warn" : "ok", `${res.summary.positions} positions`, sample ? tx("Sample, not read from Arc.") : sourceLine({ source: "Arc chain and venue APIs", readAt: res.at, block: res.block }));
  emitBlock(input.emit, facts);
  const rows = facts.kind === "facts" ? facts.rows : [];
  const row = (label: string) => rows.find((r) => r.label === label);
  const net = row(tx("Net worth"));
  const apy = row(tx("Blended APY on what earns"));
  const yearly = row(tx("Yearly estimate, net of borrowing"));
  const lowest = row(tx("Lowest health factor"));
  const lines = [
    apy ? tx("- **Blended APY:** {value} · {value2}", { value: apy.value, value2: cite(apy.from, sample) }) : null,
    yearly ? tx("- **Yearly estimate:** {value} · {value2}", { value: yearly.value, value2: cite(yearly.from, sample) }) : null,
    lowest ? tx("- **Lowest health:** {value} · {value2}", { value: lowest.value, value2: cite(lowest.from, sample) }) : res.summary.unavailable.length > 0 ? tx("- **Not read:** {value} (unavailable, not zero)", { value: res.summary.unavailable.join(", ") }) : null,
  ].filter((l): l is string => l !== null);
  const lead = net ? tx("{value} worth {value2} · {value3}.", { value: sample ? tx("The sample flock is") : tx("Your Fold is"), value2: net.value, value3: cite(net.from, sample) }) : tx("Your net worth is unavailable.");
  return done(input, `${lead}\n\n${lines.join("\n")}\n\n**Next:** ${lowest && Number(lowest.value) < Number(res.healthFloor) ? tx("the loan under the health floor comes first; say “fix my loan health”.") : tx("open the Flock tab to see each position.")}`);
}
