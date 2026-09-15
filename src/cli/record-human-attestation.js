process.stderr.write(
  "project:attest no longer accepts JSON claims authored by an Agent. " +
  "After personally reviewing the exact video, run: npm run project:accept -- <project-id> <render-result-id>\n"
);
process.exitCode = 1;
