/**
 * A generic middleware-based task router.
 * Supports registering handlers for different task types and intercepting payloads.
 */
export class PipelineRouter {
  constructor() {
    this.handlers = new Map();
  }

  /**
   * Register a handler for a specific task type.
   * A handler is an async function (task, context, next) => { ... }
   */
  use(taskType, handler) {
    if (!this.handlers.has(taskType)) {
      this.handlers.set(taskType, []);
    }
    this.handlers.get(taskType).push(handler);
  }

  /**
   * Process a task through its registered middleware chain.
   */
  async dispatch(task, context = {}) {
    const typeHandlers = this.handlers.get(task.type) || [];
    
    if (typeHandlers.length === 0) {
      throw new Error(`No handlers registered for task type: ${task.type}`);
    }

    let index = -1;
    
    const next = async () => {
      index++;
      if (index < typeHandlers.length) {
        const handler = typeHandlers[index];
        await handler(task, context, next);
      }
    };
    
    await next();
  }
}
