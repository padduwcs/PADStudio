export class ProjectContextAssembler {
  constructor({ projectStore, toolRegistry = null }) {
    this.projectStore = projectStore;
    this.toolRegistry = toolRegistry;
    this.capabilitiesPromise = null;
  }

  async build(projectId) {
    const context = await this.projectStore.readContext(projectId);
    const capabilities = await this.#capabilities();
    const current = context.intelligence.currentWorkItems;
    const activeWorkflow = context.intelligence.activeWorkflow;
    const checkpointMatches = Boolean(
      activeWorkflow &&
      context.checkpoint?.activeWorkflowId &&
      context.checkpoint.activeWorkflowId === activeWorkflow.id
    );
    const checkpointItem = checkpointMatches
      ? activeWorkflow.items.find((item) => item.id === context.checkpoint?.activeWorkItemId)
      : null;
    return {
      ...context,
      capabilities,
      resumeView: {
        checkpoint: context.checkpoint?.resume ?? null,
        activeWorkflowId: activeWorkflow?.id ?? null,
        activeWorkflowRevision: activeWorkflow?.revision ?? null,
        activeWorkItemId: checkpointItem?.id ?? null,
        attention: current.map((item) => ({
          id: item.id,
          status: item.status,
          purpose: item.purpose,
          blockedBy: item.dependsOn.filter((dependencyId) => {
            const dependency = context.intelligence.activeWorkflow?.items.find(
              (candidate) => candidate.id === dependencyId
            );
            return dependency?.status !== "completed";
          })
        })),
        pendingApprovalIds: context.intelligence.pendingApprovals.map((item) => item.id)
      }
    };
  }

  async #capabilities() {
    if (!this.toolRegistry) return { capabilities: [] };
    this.capabilitiesPromise ??= this.toolRegistry.describeCapabilities();
    return this.capabilitiesPromise;
  }
}
