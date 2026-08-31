import { AsyncQueue } from '../AsyncQueue';
import { FingerprintStage } from './FingerprintStage';
import { ClusteringStage } from './ClusteringStage';
import { EncodingStage } from './EncodingStage';
import { UploadStage } from './UploadStage';

/**
 * Orchestrates the entire producer/consumer pipeline.
 */
export class PipelineManager {
  constructor(onProgress, onComplete, onStats, onContainerComplete) {
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onStats = onStats;
    this.onContainerComplete = onContainerComplete;
    
    this.totalItems = 0;
    this.completedItems = 0;
    this.startTime = 0;
    
    // Create bounded queues with backpressure
    this.fingerprintQueue = new AsyncQueue(20); // Keep max 20 images in memory during hashing
    this.clusteringQueue = new AsyncQueue(20);
    this.encodingQueue = new AsyncQueue(2); // Process 2 containers at a time
    this.uploadQueue = new AsyncQueue(3); // Upload up to 3 at a time

    // Initialize stages
    this.fingerprintStage = new FingerprintStage(this.fingerprintQueue, this.clusteringQueue, onProgress);
    this.clusteringStage = new ClusteringStage(this.clusteringQueue, this.encodingQueue, onProgress);
    this.encodingStage = new EncodingStage(this.encodingQueue, this.uploadQueue, onProgress);
    this.uploadStage = new UploadStage(this.uploadQueue, onProgress, (count, itemIds) => this._handleItemsComplete(count, itemIds));

    this.workers = [];
  }

  /**
   * Starts all consumer workers in the background.
   */
  start() {
    this.workers = [
      this.fingerprintStage.start(),
      this.clusteringStage.start(),
      this.encodingStage.start(),
      this.uploadStage.start()
    ];

    // When the final upload stage finishes, the pipeline is fully complete
    Promise.all(this.workers)
      .then(() => {
        if (this.onComplete) this.onComplete();
      })
      .catch(err => {
        console.error('Pipeline failed:', err);
        if (this.onComplete) this.onComplete(err);
      });
  }

  setTotalItems(count) {
    this.totalItems = count;
    this.completedItems = 0;
    this.startTime = Date.now();
  }

  _handleItemsComplete(count, itemIds) {
    this.completedItems += count;
    
    if (this.totalItems > 0 && this.completedItems <= this.totalItems) {
      const elapsedMs = Date.now() - this.startTime;
      const rate = this.completedItems / elapsedMs; // items per ms
      const remainingItems = this.totalItems - this.completedItems;
      const etaSeconds = rate > 0 ? Math.round((remainingItems / rate) / 1000) : 0;
      const percent = Math.min(100, Math.round((this.completedItems / this.totalItems) * 100));
      
      if (this.onStats) {
        this.onStats({ percent, etaSeconds, completed: this.completedItems, total: this.totalItems });
      }
    }
    
    // Notify the UI to refresh its view now that a container has been completely processed
    if (this.onContainerComplete) {
      this.onContainerComplete(itemIds);
    }
  }

  /**
   * Allows the producer (UI) to push raw files into the ingestion queue.
   */
  async enqueueFile(file) {
    await this.fingerprintQueue.push(file);
  }

  /**
   * Signals that no more files will be added.
   * This triggers a cascade of queue closures as each stage empties.
   */
  finishIngestion() {
    this.fingerprintQueue.close();
  }
}
