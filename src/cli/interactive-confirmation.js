import { createInterface } from "node:readline/promises";

export function requireInteractiveTerminal(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "Human confirmation must be entered directly in an interactive terminal; JSON files, pipes and Agent automation are not accepted."
    );
  }
}

export async function confirmExactPhrase({ phrase, prompt, input = process.stdin, output = process.stdout }) {
  requireInteractiveTerminal(input, output);
  const terminal = createInterface({ input, output });
  try {
    const answer = await terminal.question(`${prompt}\n\nType exactly:\n${phrase}\n> `);
    if (answer.trim() !== phrase) throw new Error("Confirmation cancelled; the exact phrase was not entered.");
  } finally {
    terminal.close();
  }
}
