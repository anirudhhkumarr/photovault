import { describe, it, expect, vi } from 'vitest';
import { PipelineRouter } from '../../../lib/PipelineRouter';

describe('PipelineRouter', () => {
  it('should route tasks to the correct handler', async () => {
    const router = new PipelineRouter();
    
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    router.use('TASK_A', handlerA);
    router.use('TASK_B', handlerB);

    await router.dispatch({ type: 'TASK_A', payload: 123 }, { someContext: true });

    expect(handlerA).toHaveBeenCalledWith(
      { type: 'TASK_A', payload: 123 },
      { someContext: true },
      expect.any(Function)
    );
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('should throw an error if no handler is found', async () => {
    const router = new PipelineRouter();
    
    await expect(
      router.dispatch({ type: 'UNKNOWN_TASK' }, {})
    ).rejects.toThrow('No handlers registered for task type: UNKNOWN_TASK');
  });

  it('should allow chaining multiple handlers for the same type (middleware)', async () => {
    const router = new PipelineRouter();
    
    const executionOrder = [];
    
    router.use('TASK', async (task, context, next) => {
      executionOrder.push('handler1_start');
      await next();
      executionOrder.push('handler1_end');
    });

    router.use('TASK', async (task, context, next) => {
      executionOrder.push('handler2');
      await next();
    });

    await router.dispatch({ type: 'TASK' }, {});

    expect(executionOrder).toEqual(['handler1_start', 'handler2', 'handler1_end']);
  });
});
