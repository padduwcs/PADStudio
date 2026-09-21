export const HUMAN_CONFIRMATION_VERSION = "1.0";
export const HUMAN_CONFIRMATION_CHANNEL = "interactive_cli";
export const AGENT_HOST_CONFIRMATION_CHANNEL = "agent_host";

const ACTIONS = new Set(["execute_animation_code", "review_video", "accept_video"]);
const CONFIRMATION_KEYS = ["action", "channel", "confirmedAt", "targetId", "version"];

function supportedChannel(action, channel) {
  return channel === HUMAN_CONFIRMATION_CHANNEL ||
    (action === "accept_video" && channel === AGENT_HOST_CONFIRMATION_CHANNEL);
}

export function createHumanConfirmation(action, targetId, options = {}) {
  if (typeof options === "function") options = { now: options };
  const {
    channel = HUMAN_CONFIRMATION_CHANNEL,
    now = () => new Date().toISOString()
  } = options;
  if (!ACTIONS.has(action)) throw new Error(`Unsupported human confirmation action: ${action}.`);
  if (typeof targetId !== "string" || !targetId.trim()) throw new Error("Human confirmation target is required.");
  if (!supportedChannel(action, channel)) {
    throw new Error(`Unsupported human confirmation channel ${channel} for ${action}.`);
  }
  return {
    version: HUMAN_CONFIRMATION_VERSION,
    channel,
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
    supportedChannel(action, value.channel) &&
    value.action === action &&
    value.targetId === targetId &&
    typeof value.confirmedAt === "string" &&
    Number.isFinite(Date.parse(value.confirmedAt))
  );
}

export function requireHumanConfirmation(value, action, targetId) {
  if (!validHumanConfirmation(value, action, targetId)) {
    throw new Error(`An explicit human confirmation through a supported channel is required for ${action}.`);
  }
  return value;
}
