import { describe, it, expect, vi } from 'vitest';
import { TaskQueue } from '../lib/TaskQueue';

describe('TaskQueue Invariants', () => {
  it('should enforce hard-failing fail-fast principle', async () => {
    const queue = new TaskQueue();
    queue.registerType('TEST', 1);

    let errorCaught = null;
    queue.addEventListener('task:error', (e) => {
      errorCaught = e.detail.error;
    });

    queue.addEventListener('task:started', (e) => {
      // Simulate immediate hard failure without catching it inside setTimeout
      queue.fail(e.detail.id, new Error("Hard fail"));
    });

    queue.enqueue('TEST', {});
    
    // Wait for idle to process
    await queue.waitUntilIdle();
    
    expect(errorCaught).toBeDefined();
    expect(errorCaught.message).toBe("Hard fail");
  });

  it('should process events without setTimeout or artificial delays', async () => {
    const queue = new TaskQueue();
    queue.registerType('TEST', 2); // Concurrency 2

    let completed = 0;
    queue.addEventListener('task:started', (e) => {
      // Synchronous completion - no setTimeout
      queue.complete(e.detail.id, { done: true });
    });

    queue.addEventListener('task:completed', () => {
      completed++;
    });

    queue.enqueue('TEST', { id: 1 });
    queue.enqueue('TEST', { id: 2 });
    queue.enqueue('TEST', { id: 3 });

    await queue.waitUntilIdle();
    
    expect(completed).toBe(3);
  });
});
