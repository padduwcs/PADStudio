import { readExecutionAuthorizations } from "./execution-authorizations.js";

// A voice with its own rate (often a Voice Library voice) costs a different number of credits per character than
// the model's listed multiplier, and ElevenLabs does not publish that rate in a form the catalog gives us. What the
// project does know is what earlier paid requests with the same voice and model actually cost: the provider's
// character-cost for each, recorded on its authorization, next to the length of the text in its Result.
//
// Every recorded cost is a whole number, so a request of n characters that cost c credits only tells us the rate lies
// within about [(c - 1) / n, (c + 0.5) / n]. Several requests are combined by intersecting those ranges. The upper end
// is what an estimate has to use if it is meant to be an approval ceiling.

/**
 * @returns {{ samples: object[], consistent: boolean, low: number|null, high: number|null }}
 *   `consistent` is false when the requests disagree, which means credits per character is not constant for this
 *   voice and nothing should be extrapolated from them.
 */
export async function observedCreditRate(store, projectId, { engine, voiceId, modelId }) {
  const [results, authorizations] = await Promise.all([
    store.readResults(projectId), readExecutionAuthorizations(store, projectId)
  ]);
  const byRun = new Map(authorizations
    .filter((record) => record.status === "consumed" && record.claimedByRun &&
      record.actualUsage?.unit === "credits" && record.actualUsage.amount > 0)
    .map((record) => [record.claimedByRun, record]));
  const samples = [];
  for (const result of results) {
    if (result.type !== "audio.tts" || result.data?.engine !== engine ||
        result.data.voiceId !== voiceId || result.data.modelId !== modelId) continue;
    const authorization = byRun.get(result.createdByRun);
    const characters = result.data.textLength;
    if (!authorization || !Number.isSafeInteger(characters) || characters <= 0) continue;
    const credits = authorization.actualUsage.amount;
    samples.push({
      resultId: result.id, authorizationId: authorization.id, characters, credits,
      low: (credits - 1) / characters, high: (credits + 0.5) / characters
    });
  }
  if (samples.length === 0) return { samples, consistent: true, low: null, high: null };
  const low = Math.max(...samples.map((sample) => sample.low));
  const high = Math.min(...samples.map((sample) => sample.high));
  return { samples, consistent: low <= high, low: low <= high ? low : null, high: low <= high ? high : null };
}

/**
 * Replace a listed estimate that is only a minimum with one measured from earlier requests, when there are any and
 * they agree. Returns the listed estimate unchanged otherwise, so the caller always gets something to show.
 */
export function calibratedUsage(listed, observation, characters) {
  if (!observation || observation.samples.length === 0 || !observation.consistent) return listed;
  const ids = observation.samples.map((sample) => sample.resultId).join(",");
  const measured = observation.samples.map((sample) => `${sample.credits}/${sample.characters}`).join(",");
  return {
    unit: "credits",
    amount: Math.ceil(characters * observation.high),
    basis: `observed_rate:${measured}_credits_per_characters;from_results:${ids};` +
      `ceiling_uses_upper_rounding_bound;listed_estimate:${listed.amount}`,
    uncertain: true,
    calibrated: true
  };
}
