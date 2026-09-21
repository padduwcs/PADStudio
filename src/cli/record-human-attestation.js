process.stderr.write(
  "project:attest no longer accepts JSON claims authored by an Agent. " +
  "After the user approves the exact video in chat, use project:accept -- <project-id> <render-result-id> --from-agent-host. " +
  "Omit --from-agent-host only when the user wants to record the optional interactive full-view/full-listen attestation.\n"
);
process.exitCode = 1;
