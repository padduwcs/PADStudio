const PROFILES = Object.freeze({
  "spoken-video-v1": Object.freeze({
    id: "spoken-video-v1",
    speechExpected: true,
    minimumFrames: 3,
    minimumContactSheets: 1,
    minimumSpeechLeadSeconds: 0.12,
    minimumSpeechTailSeconds: 0.3,
    minimumFinalWordScore: 0.5
  }),
  "nonverbal-video-v1": Object.freeze({
    id: "nonverbal-video-v1",
    speechExpected: false,
    minimumFrames: 3,
    minimumContactSheets: 1
  })
});

export function listOutputQualityProfiles() {
  return Object.values(PROFILES).map((profile) => structuredClone(profile));
}

export function readOutputQualityProfile(id) {
  const profile = PROFILES[id];
  if (!profile) throw new Error(`Output quality profile không được hỗ trợ: ${id}.`);
  return structuredClone(profile);
}
