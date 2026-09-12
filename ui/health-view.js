let lastSignature = null;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function renderHealth(container, context) {
  const signature = JSON.stringify([context.project.id, context.health]);
  if (lastSignature === signature) return;
  lastSignature = signature;
  container.replaceChildren();
  const health = context.health;
  if (!health) {
    container.append(node("p", "Chưa đọc được trạng thái vận hành.", "empty-note"));
    return;
  }
  const summary = node("div", undefined, "health-summary health-" + health.status);
  summary.append(
    node("strong", health.status === "ready" ? "Sẵn sàng" :
      health.status === "attention" ? "Cần chú ý" : "Đang bị chặn"),
    node(
      "p",
      health.counts.results + " Result · " +
        health.counts.deliveries + " bundle · " +
        health.counts.pendingFinalizations + " finalization chờ · " +
        health.counts.pendingFeedback + " feedback chờ",
      "input-meta"
    )
  );
  container.append(summary);
  if (!health.issues.length) {
    container.append(node("p", "Không phát hiện blocker vận hành trong snapshot hiện tại.", "empty-note"));
    return;
  }
  const list = node("div", undefined, "health-issues");
  for (const issue of health.issues) {
    const card = node("article", undefined, "health-issue health-" + issue.severity);
    card.append(
      node("h4", issue.code),
      node("p", issue.message),
      node("p", issue.remediation, "input-meta")
    );
    if (issue.ids.length) card.append(node("code", issue.ids.join(", ")));
    list.append(card);
  }
  container.append(list);
}

export function clearHealth(container) {
  lastSignature = null;
  container.replaceChildren();
}
