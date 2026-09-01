import { describe, it, expect } from 'vitest';
import { TaskQueue } from './TaskQueue';

describe('Event-Driven TaskQueue', () => {
  it('should enforce worker concurrency limits', async () => {
    const queue = new TaskQueue();
    let currentConcurrent = 0;
    let maxObservedConcurrent = 0;

    queue.registerWorker('CONCURRENT_TEST', 2, async (data) => {
      currentConcurrent++;
      maxObservedConcurrent = Math.max(maxObservedConcurrent, currentConcurrent);
      await new Promise(resolve => setTimeout(resolve, 50));
      currentConcurrent--;
      return data * 2;
    });

    const promises = [
      queue.enqueue('CONCURRENT_TEST', 1),
      queue.enqueue('CONCURRENT_TEST', 2),
      queue.enqueue('CONCURRENT_TEST', 3),
      queue.enqueue('CONCURRENT_TEST', 4)
    ];

    const results = await Promise.all(promises);
    expect(results).toEqual([2, 4, 6, 8]);
    expect(maxObservedConcurrent).toBe(2);
  });

  it('should emit lifecycle events reactively', async () => {
    const queue = new TaskQueue();
    const enqueuedEvents = [];
    const completedEvents = [];
    let idleFired = false;

    queue.on('task:enqueued', (ev) => enqueuedEvents.push(ev.task.data));
    queue.on('task:completed', (ev) => completedEvents.push(ev.result));
    queue.on('idle', () => { idleFired = true; });

    queue.registerWorker('EVENT_TEST', 1, async (data) => {
      return `processed_${data}`;
    });

    await queue.enqueue('EVENT_TEST', 'item1');
    await queue.enqueue('EVENT_TEST', 'item2');
    await queue.waitUntilIdle();

    expect(enqueuedEvents).toEqual(['item1', 'item2']);
    expect(completedEvents).toEqual(['processed_item1', 'processed_item2']);
    expect(idleFired).toBe(true);
  });

  it('should handle worker errors and emit task:error', async () => {
    const queue = new TaskQueue();
    const errorEvents = [];

    queue.on('task:error', (ev) => errorEvents.push(ev.error.message));

    queue.registerWorker('FAIL_TEST', 1, async () => {
      throw new Error('Test task failure');
    });

    await expect(queue.enqueue('FAIL_TEST', {})).rejects.toThrow('Test task failure');
    expect(errorEvents).toEqual(['Test task failure']);
  });

  it('should accurately report live queue stats', async () => {
    const queue = new TaskQueue();

    queue.registerWorker('STATS_TEST', 1, async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
    });

    queue.enqueue('STATS_TEST', 'a');
    queue.enqueue('STATS_TEST', 'b');

    const liveStats = queue.getStats();
    expect(liveStats.active['STATS_TEST']).toBe(1);
    expect(liveStats.queued['STATS_TEST']).toBe(1);
    expect(liveStats.isIdle).toBe(false);

    await queue.waitUntilIdle();
    const idleStats = queue.getStats();
    expect(idleStats.isIdle).toBe(true);
    expect(idleStats.completed).toBe(2);
  });
});
