import { getPhotos } from '../db';
import { arePhotosInSameScene } from '../phash';

const MAX_CONTAINER_SIZE = 150 * 1024 * 1024; // 150 MB

/**
 * Consumer for the fingerprint queue.
 * Groups incoming items by perceptual similarity on a rolling basis.
 * Flushes a group to the encoding queue when it reaches capacity or when ingestion finishes.
 */
export class ClusteringStage {
  constructor(inputQueue, outputQueue, onProgress) {
    this.inputQueue = inputQueue;
    this.outputQueue = outputQueue;
    this.onProgress = onProgress;
    
    this.activeClusters = new Map();
    this.groupSizeMap = new Map();
    this.existingPhotos = [];
  }

  async init() {
    this.existingPhotos = await getPhotos();
    this.existingPhotos.forEach(p => {
      this.groupSizeMap.set(p.videoId, (this.groupSizeMap.get(p.videoId) || 0) + p.size);
    });
  }

  _canGroupAccept(groupId, additionalSize) {
    const currentSize = this.groupSizeMap.get(groupId) || 0;
    return (currentSize + additionalSize) <= MAX_CONTAINER_SIZE;
  }

  async _flushGroup(groupId) {
    const items = this.activeClusters.get(groupId);
    if (!items || items.length === 0) return;

    this.onProgress(`Pushing container ${groupId} to encoder queue...`);
    
    // Push the cluster to the encoding queue
    await this.outputQueue.push({
      groupId,
      items
    });

    // Clear from active memory
    this.activeClusters.delete(groupId);
  }

  async start() {
    await this.init();

    while (true) {
      const item = await this.inputQueue.pop();
      
      if (!item) {
        // Queue is closed and empty. Flush all remaining clusters.
        this.onProgress('Ingestion complete. Flushing final containers...');
        for (const groupId of this.activeClusters.keys()) {
          await this._flushGroup(groupId);
        }
        this.outputQueue.close();
        break;
      }

      this.onProgress(`Clustering: ${item.name}`);
      let matchedGroupId = null;

      // 1. Exact Duplicate match against existing DB
      for (const p of this.existingPhotos) {
        if (p.contentHash && p.contentHash === item.contentHash) {
          if (this._canGroupAccept(p.videoId, item.size)) {
            matchedGroupId = p.videoId;
            break;
          }
        }
      }

      // 2. Pure Visual Scene Match against existing DB
      if (!matchedGroupId && item.fingerprint) {
        for (const p of this.existingPhotos) {
          if (p.fingerprint && arePhotosInSameScene(item.fingerprint, p.fingerprint)) {
            if (this._canGroupAccept(p.videoId, item.size)) {
              matchedGroupId = p.videoId;
              break;
            }
          }
        }
      }

      // 3. Rolling window match against active clusters
      if (!matchedGroupId && item.fingerprint) {
        for (const [activeGroupId, items] of this.activeClusters.entries()) {
          for (const prev of items) {
            if (prev.fingerprint && arePhotosInSameScene(item.fingerprint, prev.fingerprint)) {
              if (this._canGroupAccept(activeGroupId, item.size)) {
                matchedGroupId = activeGroupId;
                break;
              }
            }
          }
          if (matchedGroupId) break;
        }
      }

      // Create new group if no match found
      const targetGroupId = matchedGroupId || `group_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      item.videoId = targetGroupId;

      // Update size tracking
      const newSize = (this.groupSizeMap.get(targetGroupId) || 0) + item.size;
      this.groupSizeMap.set(targetGroupId, newSize);

      if (!this.activeClusters.has(targetGroupId)) {
        this.activeClusters.set(targetGroupId, []);
      }
      this.activeClusters.get(targetGroupId).push(item);

      // If this group is now at or near capacity, flush it immediately
      if (newSize >= MAX_CONTAINER_SIZE * 0.95) { // Flush at 95% capacity
        await this._flushGroup(targetGroupId);
      }
    }
  }
}
