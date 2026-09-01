export class TaskQueue extends EventTarget {
  constructor() {
    super();
    this.queues = new Map(); // taskType -> { queue: [], running: 0, concurrency: 1 }
    this.tasks = new Map(); // taskId -> { ...taskData }
    this.nextTaskId = 1;
  }

  registerType(type, concurrency = 1) {
    if (!this.queues.has(type)) {
      this.queues.set(type, { queue: [], running: 0, concurrency });
    } else {
      this.queues.get(type).concurrency = concurrency;
    }
  }

  enqueue(type, payload, priority = 0) {
    if (!this.queues.has(type)) {
      this.registerType(type);
    }
    const taskId = `task-${this.nextTaskId++}`;
    const task = { id: taskId, type, payload, priority, status: 'PENDING' };
    
    this.tasks.set(taskId, task);
    
    const qData = this.queues.get(type);
    qData.queue.push(task);
    // Sort by priority (higher is better)
    qData.queue.sort((a, b) => b.priority - a.priority);
    
    this.dispatchEvent(new CustomEvent('task:enqueued', { detail: task }));
    
    this._process(type);
    return taskId;
  }

  _process(type) {
    const qData = this.queues.get(type);
    if (!qData) return;

    while (qData.running < qData.concurrency && qData.queue.length > 0) {
      const task = qData.queue.shift();
      qData.running++;
      task.status = 'RUNNING';
      
      this.dispatchEvent(new CustomEvent('task:started', { detail: task }));
      
      // We expect the consumer to listen to 'task:started', execute it, 
      // and call complete(taskId) or fail(taskId, error).
    }

    if (qData.running === 0 && qData.queue.length === 0) {
      this.dispatchEvent(new CustomEvent('idle', { detail: { type } }));
    }
  }

  complete(taskId, result) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    task.status = 'COMPLETED';
    task.result = result;
    
    const qData = this.queues.get(task.type);
    qData.running--;
    
    this.dispatchEvent(new CustomEvent('task:completed', { detail: task }));
    this._process(task.type);
  }

  fail(taskId, error) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    task.status = 'FAILED';
    task.error = error;
    
    const qData = this.queues.get(task.type);
    qData.running--;
    
    this.dispatchEvent(new CustomEvent('task:error', { detail: task }));
    this._process(task.type);
  }

  waitUntilTypeIdle(type) {
    return new Promise((resolve) => {
      const qData = this.queues.get(type);
      if (!qData || (qData.running === 0 && qData.queue.length === 0)) {
        return resolve();
      }
      const listener = (e) => {
        if (e.detail.type === type) {
          this.removeEventListener('idle', listener);
          resolve();
        }
      };
      this.addEventListener('idle', listener);
    });
  }

  waitUntilIdle() {
    return new Promise((resolve) => {
      const checkIdle = () => {
        for (const [_, qData] of this.queues.entries()) {
          if (qData.running > 0 || qData.queue.length > 0) return false;
        }
        return true;
      };

      if (checkIdle()) return resolve();

      const listener = () => {
        if (checkIdle()) {
          this.removeEventListener('idle', listener);
          resolve();
        }
      };
      this.addEventListener('idle', listener);
    });
  }
}
