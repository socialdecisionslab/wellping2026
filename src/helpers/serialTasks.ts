/** Failed work stays at the head until an explicit retry succeeds. */
export class SerialTasks {
  private pending: (() => Promise<void>)[] = [];
  private running: Promise<void> | null = null;

  enqueue(task: () => Promise<void>): Promise<void> {
    this.pending.push(task);
    return this.flush();
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      while (this.pending.length) {
        await this.pending[0]();
        this.pending.shift();
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
