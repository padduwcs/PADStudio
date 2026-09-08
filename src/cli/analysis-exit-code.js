export function analysisExitCode(response) {
  if (!response || typeof response !== "object") return 1;
  if (response.state === "completed") return 0;
  if (response.state === "failed") {
    if (!Array.isArray(response.job?.units)) return 1;
    return response.job.units.some((unit) => unit.state === "failed") ? 1 : 2;
  }
  if (["partial", "blocked", "interrupted", "cancelled"].includes(response.state)) return 2;
  return 1;
}
