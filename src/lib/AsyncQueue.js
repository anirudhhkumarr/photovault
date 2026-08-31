/**
 * A bounded asynchronous queue with backpressure support.
 * Producers wait if the queue reaches its limit.
 * Consumers wait if the queue is empty.
 */
export class AsyncQueue {
  constructor(limit = 10) {
    this.limit = limit;
    this.items = [];
    this.resolvers = [];
    this.waiters = [];
    this.isClosed = false;
  }

  /**
   * Pushes an item to the queue.
   * If the queue is full, blocks until space is available.
   */
  async push(item) {
    if (this.isClosed) throw new Error("Queue is closed");
    
    // Apply backpressure if full
    if (this.items.length >= this.limit) {
      await new Promise(resolve => this.waiters.push(resolve));
    }
    
    this.items.push(item);
    
    // Wake up a waiting consumer
    if (this.resolvers.length > 0) {
      this.resolvers.shift()(this.items.shift());
      this._notifyWaiters();
    }
  }

  /**
   * Pops an item from the queue.
   * Blocks if the queue is empty.
   */
  async pop() {
    if (this.items.length > 0) {
      const item = this.items.shift();
      this._notifyWaiters();
      return item;
    }
    
    if (this.isClosed) return null;
    
    // Wait for an item
    return new Promise(resolve => this.resolvers.push(resolve));
  }
  
  /**
   * Marks the queue as done. All subsequent pops will return null once empty.
   */
  close() {
    this.isClosed = true;
    while (this.resolvers.length > 0) {
      this.resolvers.shift()(null);
    }
  }

  _notifyWaiters() {
    if (this.waiters.length > 0 && this.items.length < this.limit) {
      this.waiters.shift()();
    }
  }
}
