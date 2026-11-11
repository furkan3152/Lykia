/**
 * "How this works" for each area: three short bullets at most and the
 * question the "Ask Lyko about this" button puts in the composer. Pure, so
 * tests check every area has its explanation.
 */
import { LYKIA_TERMS } from "@lykia/core";
import { t } from "../../i18n";

export const HELP_AREAS = ["fold", "flock", "trails", "herding", "pack", "fence", "leash", "lyko", "ask", "review", "you", "forge", "stress"] as const;
export type HelpArea = (typeof HELP_AREAS)[number];

export interface HelpEntry {
  readonly title: string;
  /** Three bullets at most, each one plain sentence. */
  readonly bullets: readonly string[];
  /** Prefilled in Ask Lyko by "Ask Lyko about this". */
  readonly ask: string;
}

export const HELP: Readonly<Record<HelpArea, HelpEntry>> = {
  fold: { title: t("help.theFoldEverythingYouOwn"), bullets: [t("help.everythingYouHoldOnArcAnd"), t("help.lykoOnWatchReadsItAll"), t("help.nothingMovesUntilYouSignIn")], ask: t("help.walkMeThroughMyFold") },
  flock: { title: `${LYKIA_TERMS.flock.word} · ${LYKIA_TERMS.flock.plain}`, bullets: [t("help.everyPositionInEveryPlaceLykia"), t("help.tapARowForTheDetails"), t("help.anythingThatCannotBeReadIs")], ask: t("help.whereIsMyMoneyAndWhat") },
  trails: { title: `${LYKIA_TERMS.trails.word} · ${LYKIA_TERMS.trails.plain}`, bullets: [t("help.everythingThatHappenedPaymentsPlansRefus"), t("help.eachLineSaysWhyItWas"), t("help.everyTransactionLinksToTheExplorer")], ask: t("help.whatHappenedInMyAccountThis") },
  herding: { title: `${LYKIA_TERMS.herding.word} · ${LYKIA_TERMS.herding.plain}`, bullets: [t("help.rulesThatRunOnTheirOwn"), t("help.eachOneShowsWhenItRuns"), t("help.pauseOrRemoveAnyOfThem")], ask: t("help.whatRunsOnItsOwnThis") },
  pack: { title: `${LYKIA_TERMS.pack.word} · ${LYKIA_TERMS.pack.plain}`, bullets: [t("help.botsThatWorkForYouEach"), t("help.aLeashGivesAnOutsideBot"), t("help.revokeOrPauseAnyOfThem")], ask: t("help.myBotNeedsABudget") },
  fence: { title: `${LYKIA_TERMS.fence.word} · ${LYKIA_TERMS.fence.plain}`, bullets: [t("help.everyMoveIsCheckedAgainstThese"), t("help.lykiaSBetaLimitSitsOn"), t("help.makingRulesStricterAppliesAtOnce")], ask: t("help.explainMyFenceInPlainWords") },
  leash: { title: `${LYKIA_TERMS.leash.word} · ${LYKIA_TERMS.leash.plain}`, bullets: [t("help.youSetHowMuchABot"), t("help.theLimitsSitOnChainThe"), t("help.revokeStopsItsKeyAtOnce")], ask: t("help.whatIsALeash") },
  lyko: { title: t("help.lykoOnWatchYourPortfolioAssistant"), bullets: [t("help.readsEverythingInTheFoldPositions"), t("help.saysWhenSomethingIsCloseTo"), t("help.draftsTheFixYouSignIt")], ask: t("help.whatShouldILookAtFirst") },
  ask: { title: t("help.askLykoSayItInWords"), bullets: [t("help.sayWhatYourMoneyShouldDo"), t("help.yourFenceChecksEveryStepAnd"), t("help.ifSomethingIsMissingLykoAsks")], ask: t("help.whatCanYouDo") },
  review: { title: t("help.reviewBeforeYouSign"), bullets: [t("help.whatLeavesYourWalletAndWhat"), t("help.feesTheNetworkFeeAndYour"), t("help.aSimulationListsEveryBalanceChange")], ask: t("help.howDoIReadThisReview") },
  you: { title: t("help.yourLykoYourSettings"), bullets: [t("help.howCarefulLykoIsHowMuch"), t("help.everySettingSaysWhatItChanges"), t("help.yourFenceStillHasTheLast")], ask: t("help.whichSettingsShouldIChange") },
  forge: { title: t("help.theForgeForDevelopers"), bullets: [t("help.keysProjectsWebhooksAndTheApi"), t("help.testKeysRunOnArcTestnet"), t("help.everyExampleRunsAsWritten")], ask: t("help.howDoIStartBuildingWith") },
  stress: { title: t("help.stressTestWhatIfPricesMove"), bullets: [t("help.pickAScenarioLykoRePrices"), t("help.youSeeYourValueBeforeAnd"), t("help.nothingMovesItIsACalculation")], ask: t("help.whatIfEurcDrops5") },
};
