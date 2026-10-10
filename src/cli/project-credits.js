import { ProjectStore } from "../project/project-store.js";
import { clearCreditBudget, configureCreditBudget, creditBudgetSnapshot } from "../execution/credit-budget.js";
import { resolveProjectRoot } from "../config/project-root.js";

const USAGE = "Cách dùng: npm run project:credits -- <project-id> [show | set <số credit tối đa> | clear]";

async function main(args) {
  const [projectId, action = "show", amount, ...rest] = args;
  const valid = projectId && ["show", "set", "clear"].includes(action) && rest.length === 0 &&
    (action === "set" ? /^\d{1,12}$/.test(amount ?? "") : amount === undefined);
  if (!valid) throw new Error(USAGE);
  const store = new ProjectStore(resolveProjectRoot());
  if (action === "set") await configureCreditBudget(store, projectId, { maxCredits: Number(amount) });
  if (action === "clear") await clearCreditBudget(store, projectId);
  process.stdout.write(JSON.stringify(await creditBudgetSnapshot(store, projectId), null, 2) + "\n");
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
