/**
 * Decoupled, event-driven asynchronous task queue.
 * Supports task prioritization, configurable worker concurrency per task type,
 * pub/sub event emission, and idle/drain lifecycle tracking.
 */
export class TaskQueue {
  constructor() {
    this.queues = new Map(); // taskType -> array of { id, data, resolve, reject }
    this.workers = new Map(); // taskType -> { concurrency, handler }
    this.activeWorkers = new Map(); // taskType -> count
    this.listeners = new Map(); // eventName -> Set of callbacks
    this.completedCount = 0;
    this.failedCount = 0;
    this.totalEnqueued = 0;
    this.idleResolvers = [];
  }

  /**
   * Subscribe to an event.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event.
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  /**
   * Emit an event to all subscribers.
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in event listener for '${event}':`, err);
        }
      }
    }
  }

  /**
   * Registers a worker handler for a specific task type with concurrency limit.
   */
  registerWorker(taskType, concurrency = 1, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for task type '${taskType}' must be a function.`);
    }

    this.workers.set(taskType, { concurrency, handler });
    if (!this.queues.has(taskType)) {
      this.queues.set(taskType, []);
    }
    if (!this.activeWorkers.has(taskType)) {
      this.activeWorkers.set(taskType, 0);
    }

    // Pump any previously enqueued items
    this._pump(taskType);
  }

  /**
   * Enqueues a task of a specific type.
   * Returns a promise that resolves when that specific task finishes.
   */
  enqueue(taskType, data) {
    if (!this.queues.has(taskType)) {
      this.queues.set(taskType, []);
    }
    if (!this.activeWorkers.has(taskType)) {
      this.activeWorkers.set(taskType, 0);
    }

    this.totalEnqueued++;

    return new Promise((resolve, reject) => {
      const task = {
        id: `task_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        taskType,
        data,
        resolve,
        reject,
        enqueuedAt: Date.now()
      };

      this.queues.get(taskType).push(task);
      this.emit('task:enqueued', { taskType, task });
      this._pump(taskType);
    });
  }

  /**
   * Dispatches tasks to available workers for a given task type.
   */
  _pump(taskType) {
    const workerConfig = this.workers.get(taskType);
    if (!workerConfig) return; // No worker registered yet

    const queue = this.queues.get(taskType) || [];
    const currentActive = this.activeWorkers.get(taskType) || 0;
    const availableSlots = workerConfig.concurrency - currentActive;

    if (availableSlots <= 0 || queue.length === 0) {
      this._checkIdle();
      return;
    }

    for (let i = 0; i < availableSlots && queue.length > 0; i++) {
      const task = queue.shift();
      this.activeWorkers.set(taskType, (this.activeWorkers.get(taskType) || 0) + 1);

      this.emit('task:started', { taskType, task });

      // Run worker asynchronously
      (async () => {
        try {
          const result = await workerConfig.handler(task.data, task);
          this.completedCount++;
          task.resolve(result);
          this.emit('task:completed', { taskType, task, result });
        } catch (error) {
          this.failedCount++;
          task.reject(error);
          this.emit('task:error', { taskType, task, error });
        } finally {
          this.activeWorkers.set(taskType, Math.max(0, (this.activeWorkers.get(taskType) || 1) - 1));
          this._pump(taskType);
        }
      })();
    }

    this._checkIdle();
  }

  /**
   * Returns current statistics across all queues and workers.
   */
  getStats() {
    const queued = {};
    const active = {};
    let totalQueued = 0;
    let totalActive = 0;

    for (const [type, q] of this.queues.entries()) {
      queued[type] = q.length;
      totalQueued += q.length;
    }

    for (const [type, count] of this.activeWorkers.entries()) {
      active[type] = count;
      totalActive += count;
    }

    return {
      queued,
      active,
      totalQueued,
      totalActive,
      completed: this.completedCount,
      failed: this.failedCount,
      total: this.totalEnqueued,
      isIdle: totalQueued === 0 && totalActive === 0
    };
  }

  /**
   * Checks if all queues are empty and all workers are idle.
   */
  _checkIdle() {
    const stats = this.getStats();
    if (stats.isIdle) {
      this.emit('idle', stats);
      while (this.idleResolvers.length > 0) {
        const resolve = this.idleResolvers.shift();
        resolve(stats);
      }
    }
  }

  /**
   * Returns a promise that resolves when all queues and workers become idle.
   */
  waitUntilIdle() {
    const stats = this.getStats();
    if (stats.isIdle) {
      return Promise.resolve(stats);
    }
    return new Promise(resolve => this.idleResolvers.push(resolve));
  }

  /**
   * Clears pending queues and resets metrics.
   */
  clear() {
    for (const q of this.queues.values()) {
      while (q.length > 0) {
        const task = q.shift();
        task.reject(new Error('Queue cleared'));
      }
    }
    this.completedCount = 0;
    this.failedCount = 0;
    this.totalEnqueued = 0;
  }
}
