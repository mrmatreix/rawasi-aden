const { AsyncLocalStorage } = require('node:async_hooks');
class SqliteCoordinator {
  constructor() { this.tail = Promise.resolve(); this.context = new AsyncLocalStorage(); }
  execute(task) {
    if (this.context.getStore() === this) return Promise.resolve().then(task);
    const work = this.tail.then(() => this.context.run(this, task));
    this.tail = work.catch(() => {});
    return work;
  }
  drain() { return this.tail; }
}
module.exports = { SqliteCoordinator };
