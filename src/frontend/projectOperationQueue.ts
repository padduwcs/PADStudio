export class ProjectOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.tail.then(operation);

    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
