export const HUMAN_CONFIRMATION_VERSION = "1.0";
export const HUMAN_CONFIRMATION_CHANNEL = "interactive_cli";

const ACTIONS = new Set(["execute_animation_code", "review_video", "accept_video"]);
const CONFIRMATION_KEYS = ["action", "channel", "confirmedAt", "targetId", "version"];

export function createHumanConfirmation(action, targetId, now = () => new Date().toISOString()) {
  if (!ACTIONS.has(action)) throw new Error(`Unsupported human confirmation action: ${action}.`);
  if (typeof targetId !== "string" || !targetId.trim()) throw new Error("Human confirmation target is required.");
  return {
    version: HUMAN_CONFIRMATION_VERSION,
    channel: HUMAN_CONFIRMATION_CHANNEL,
    action,
    targetId: targetId.trim(),
    confirmedAt: now(),
  };
}

export function validHumanConfirmation(value, action, targetId) {
  return Boolean(
    value &&
    Object.keys(value).sort().join("\0") === CONFIRMATION_KEYS.join("\0") &&
    value.version === HUMAN_CONFIRMATION_VERSION &&
    value.channel === HUMAN_CONFIRMATION_CHANNEL &&
    value.action === action &&
    value.targetId === targetId &&
    typeof value.confirmedAt === "string" &&
    Number.isFinite(Date.parse(value.confirmedAt))
  );
}

export function requireHumanConfirmation(value, action, targetId) {
  if (!validHumanConfirmation(value, action, targetId)) {
    throw new Error(`A direct interactive human confirmation is required for ${action}.`);
  }
  return value;
}
