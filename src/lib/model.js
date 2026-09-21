// Model-level constants and the one rule that decides whether AVNI answers.
//
// The abstain gate used to live as a number in the answer bank and as a
// string in the UI, which let the demo print "gate < 0.45" next to an answer
// with a 0.42 score. Everything now derives from the constants below, so the
// rule, the number on the card, the reason line and every export agree.

export const ABSTAIN_GATE = 0.45;
export const ORIENTATIONS = 8;

// How many of the 8 image orientations the reading survived. Derived from the
// score so the two can never drift apart again.
export function stableOrientations(score) {
  return Math.max(0, Math.min(ORIENTATIONS, Math.round(score * ORIENTATIONS)));
}

export function abstains(score) {
  return score < ABSTAIN_GATE;
}

// Builds a confidence block: score in, consistent reason/abstain decision out.
export function confidence(score, detail) {
  const stable = stableOrientations(score);
  const declined = abstains(score);
  return {
    consistency_score: score,
    abstained: declined,
    stable_of: stable,
    orientations: ORIENTATIONS,
    gate: ABSTAIN_GATE,
    reason: declined
      ? `${detail} Stable in only ${stable} of ${ORIENTATIONS} orientations, below the ${ABSTAIN_GATE} gate.`
      : `${detail} Stable across ${stable} of ${ORIENTATIONS} image orientations.`
  };
}

// The consistency line as it appears in the execution trace.
export const consistencyValue = (score) => `${score.toFixed(2)} (${stableOrientations(score)}/${ORIENTATIONS} stable)`;
