import { TaskQueue } from './TaskQueue';
import { computeContentHash, extractSceneFingerprint, arePhotosInSameScene, generateThumbnail } from '../phash';
import { 
  getPhotos, addPhoto, updateVideo, getVideoBlob, 
  exportContainerMetadata 
} from '../db';
import { encodeImagesToVideo, extractAllFramesFromVideo } from '../videoEncoder';
import { 
  getAccessToken, uploadFileToGoogleDrive, 
  uploadOrUpdateFileInGoogleDrive 
} from '../googleDrive';

const MAX_CONTAINER_SIZE = 150 * 1024 * 1024; // 150 MB capacity cap
const CHUNK_PHOTO_THRESHOLD = 6; // Flush cluster after accumulating 6 photos
const CHUNK_SIZE_THRESHOLD = 15 * 1024 * 1024; // 15 MB
const IDLE_DEBOUNCE_MS = 400; // Auto-flush clusters with pending items after 400ms idle

/**
 * Event-driven photo vault coordinator.
 * Autonomous worker pools process image analysis, chunk-based encoding,
 * and concurrent cloud uploads reactively as work becomes ready.
 */
export class VaultQueue {
  constructor() {
    this.taskQueue = new TaskQueue();
    this.activeClusters = new Map(); // groupId -> { items: [], size: number, timer: timeoutId }
    this.existingPhotos = [];
    this.existingGroupSizes = new Map();
    this.isInitialized = false;

    this.totalPhotos = 0;
    this.processedPhotos = 0;

    this._setupWorkers();
  }

  async init() {
    if (this.isInitialized) return;
    try {
      this.existingPhotos = await getPhotos();
      this.existingGroupSizes.clear();
      for (const p of this.existingPhotos) {
        this.existingGroupSizes.set(
          p.videoId, 
          (this.existingGroupSizes.get(p.videoId) || 0) + (p.size || 0)
        );
      }
    } catch (err) {
      console.error('Could not preload photos from DB:', err);
      throw err;
    }
    this.isInitialized = true;
  }

  _setupWorkers() {
    // 1. Image Analysis Worker Pool (Concurrency: 4)
    this.taskQueue.registerWorker('ANALYZE_PHOTO', 4, async ({ file, tempId }) => {
      this.emit('progress', { 
        stage: 'analyzing', 
        name: file.name,
        stats: this.getLiveStats() 
      });

      const arrayBuffer = await file.arrayBuffer();
      const [contentHash, fingerprint, thumbnail] = await Promise.all([
        computeContentHash(arrayBuffer),
        extractSceneFingerprint(file),
        generateThumbnail(file, 400)
      ]);

      const item = {
        tempId,
        file,
        name: file.name,
        size: file.size,
        contentHash,
        fingerprint,
        thumbnail,
        data: new Uint8Array(arrayBuffer)
      };

      console.log(`[VaultQueue] 🔬 Analyzed ${item.name} (${(item.size / 1024 / 1024).toFixed(2)}MB, hash: ${contentHash?.substring(0, 8)}..., fingerprint: ${!!fingerprint})`);
      this.emit('photo:analyzed', item);
      await this.routeToCluster(item);
      return item;
    });

    // 2. Container Hardware Encoding Worker (Concurrency: 1)
    this.taskQueue.registerWorker('ENCODE_CONTAINER', 1, async ({ groupId, items }) => {
      console.log(`[VaultQueue] 🎬 Encoding container ${groupId} with ${items.length} photos...`);
      this.emit('container:encoding', { groupId, count: items.length });
      this.emit('progress', { 
        stage: 'encoding', 
        name: `Container ${groupId} (${items.length} items)`,
        stats: this.getLiveStats() 
      });

      const existingBlob = await getVideoBlob(groupId);
      let allImagesForGroup = [];

      if (existingBlob) {
        const currentPhotosInGroup = (await getPhotos()).filter(p => p.videoId === groupId);
        console.log(`[VaultQueue] 📦 Container ${groupId} already exists in DB with ${currentPhotosInGroup.length} photos. Appending ${items.length} new photos...`);
        const extractedFrames = await extractAllFramesFromVideo(existingBlob, currentPhotosInGroup.length);
        allImagesForGroup = [...extractedFrames.map(f => f.dataUrl), ...items.map(i => i.data)];
      } else {
        allImagesForGroup = items.map(i => i.data);
      }

      // Encode frames with WebCodecs hardware acceleration
      const encoded = await encodeImagesToVideo(allImagesForGroup, (cur, total) => {
        this.emit('progress', {
          stage: 'encoding',
          name: `Encoding ${groupId} frame ${cur}/${total}`,
          stats: this.getLiveStats()
        });
      });

      // Save photo records to IndexedDB
      const startIndex = existingBlob 
        ? (await getPhotos()).filter(p => p.videoId === groupId).length 
        : 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const frameIndex = startIndex + i;
        await addPhoto({
          filename: item.name,
          contentHash: item.contentHash,
          fingerprint: item.fingerprint,
          videoId: groupId,
          frameIndex,
          timestamp: frameIndex * 1.0 + 0.5,
          size: item.size,
          thumbnail: item.thumbnail,
          createdAt: Date.now()
        });
      }

      const allPhotosForGroup = (await getPhotos()).filter(p => p.videoId === groupId);
      const totalOriginal = allPhotosForGroup.reduce((sum, p) => sum + p.size, 0);

      await updateVideo(groupId, {
        originalSize: totalOriginal,
        videoSize: encoded.blob.length,
        frameCount: encoded.frameCount,
        width: encoded.width,
        height: encoded.height,
        blob: encoded.blob
      });

      // Update in-memory size cache
      this.existingGroupSizes.set(groupId, totalOriginal);

      console.log(`[VaultQueue] ✨ Encoded container ${groupId}: ${encoded.frameCount} frames, compressed ${(totalOriginal / 1024 / 1024).toFixed(2)}MB -> ${(encoded.blob.length / 1024 / 1024).toFixed(2)}MB (${((1 - encoded.blob.length / totalOriginal) * 100).toFixed(1)}% savings)`);

      this.emit('container:encoded', {
        groupId,
        blob: encoded.blob,
        mimeType: encoded.mimeType || 'video/mp4',
        items
      });

      // Immediately enqueue cloud upload job
      await this.taskQueue.enqueue('UPLOAD_CONTAINER', {
        groupId,
        blob: encoded.blob,
        mimeType: encoded.mimeType || 'video/mp4',
        items
      });

      return { groupId, frameCount: encoded.frameCount };
    });

    // 3. Cloud Upload Worker Pool (Concurrency: 2)
    this.taskQueue.registerWorker('UPLOAD_CONTAINER', 2, async ({ groupId, blob, mimeType, items }) => {
      console.log(`[VaultQueue] ☁️ Uploading container ${groupId} to Google Drive (${(blob.length / 1024 / 1024).toFixed(2)}MB)...`);
      this.emit('container:uploading', { groupId });
      this.emit('progress', { 
        stage: 'uploading', 
        name: `Syncing ${groupId} to Google Drive`,
        stats: this.getLiveStats() 
      });

      const token = getAccessToken();
      if (token) {
        try {
          await uploadFileToGoogleDrive(`${groupId}.mp4`, blob, mimeType || 'video/mp4', token);
          const dbJson = await exportContainerMetadata(groupId);
          const parsed = JSON.parse(dbJson);
          const count = parsed.photos ? parsed.photos.length : items.length;
          await uploadOrUpdateFileInGoogleDrive(`metadata_${groupId}_${count}.json`, dbJson, 'application/json', token);
          console.log(`[VaultQueue] 🚀 Cloud sync complete for ${groupId}`);
        } catch (err) {
          console.error(`[VaultQueue] ❌ Cloud upload failed for container ${groupId}:`, err);
          this.emit('error', err);
          throw err;
        }
      } else {
        console.log(`[VaultQueue] ℹ️ Cloud upload skipped for ${groupId} (not connected to Google Drive)`);
      }

      this.processedPhotos += items.length;

      const result = {
        groupId,
        items,
        itemIds: items.map(i => i.tempId)
      };

      this.emit('container:uploaded', result);
      this.emit('progress', { 
        stage: 'idle', 
        name: `Synced ${groupId}`,
        stats: this.getLiveStats() 
      });

      return result;
    });
  }

  _canGroupAccept(groupId, additionalSize) {
    const currentSize = this.existingGroupSizes.get(groupId) || 0;
    const activeCluster = this.activeClusters.get(groupId);
    const activeSize = activeCluster ? activeCluster.size : 0;
    return (currentSize + activeSize + additionalSize) <= MAX_CONTAINER_SIZE;
  }

  /**
   * Routes an analyzed photo to an appropriate cluster based on perceptual similarity.
   */
  async routeToCluster(item) {
    let matchedGroupId = null;

    // 1. Exact Duplicate match against existing DB
    for (const p of this.existingPhotos) {
      if (p.contentHash && p.contentHash === item.contentHash) {
        if (this._canGroupAccept(p.videoId, item.size)) {
          matchedGroupId = p.videoId;
          console.log(`[VaultQueue] 🔗 Exact duplicate match for ${item.name} in existing container ${matchedGroupId}`);
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
            console.log(`[VaultQueue] 🎨 Visual scene match for ${item.name} with existing photo in container ${matchedGroupId}`);
            break;
          }
        }
      }
    }

    // 3. Rolling window match against currently active in-memory clusters
    if (!matchedGroupId && item.fingerprint) {
      for (const [activeGroupId, cluster] of this.activeClusters.entries()) {
        for (const prev of cluster.items) {
          if (prev.fingerprint && arePhotosInSameScene(item.fingerprint, prev.fingerprint)) {
            if (this._canGroupAccept(activeGroupId, item.size)) {
              matchedGroupId = activeGroupId;
              console.log(`[VaultQueue] 🎨 Visual scene match for ${item.name} in active cluster ${matchedGroupId}`);
              break;
            }
          }
        }
        if (matchedGroupId) break;
      }
    }

    const targetGroupId = matchedGroupId || `group_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    item.videoId = targetGroupId;

    if (!this.activeClusters.has(targetGroupId)) {
      this.activeClusters.set(targetGroupId, { items: [], size: 0, timer: null });
      if (!matchedGroupId) {
        console.log(`[VaultQueue] 🆕 Created new cluster ${targetGroupId} for ${item.name}`);
      }
    }

    const cluster = this.activeClusters.get(targetGroupId);
    cluster.items.push(item);
    cluster.size += item.size;

    console.log(`[VaultQueue] 📌 Added ${item.name} to cluster ${targetGroupId} (${cluster.items.length} items, ${(cluster.size / 1024 / 1024).toFixed(2)}MB)`);

    // Check if cluster is ready for encoding
    const shouldFlushImmediately = 
      cluster.items.length >= CHUNK_PHOTO_THRESHOLD || 
      cluster.size >= CHUNK_SIZE_THRESHOLD ||
      (this.existingGroupSizes.get(targetGroupId) || 0) + cluster.size >= MAX_CONTAINER_SIZE * 0.95;

    if (shouldFlushImmediately) {
      console.log(`[VaultQueue] ⚡ Cluster ${targetGroupId} reached readiness threshold (${cluster.items.length} items). Flushing immediately to encoder...`);
      await this.flushCluster(targetGroupId);
    }
  }

  /**
   * Flushes an active cluster into the ENCODE_CONTAINER queue.
   */
  async flushCluster(groupId) {
    const cluster = this.activeClusters.get(groupId);
    if (!cluster || cluster.items.length === 0) return;

    const itemsToEncode = [...cluster.items];
    this.activeClusters.delete(groupId);

    // Enqueue encoding task
    await this.taskQueue.enqueue('ENCODE_CONTAINER', {
      groupId,
      items: itemsToEncode
    });
  }

  /**
   * Flushes all active in-memory clusters immediately.
   */
  async flushAllClusters() {
    const groupIds = Array.from(this.activeClusters.keys());
    for (const groupId of groupIds) {
      await this.flushCluster(groupId);
    }
  }

  /**
   * Enqueues a batch of files into the event-driven queue system.
   */
  async enqueueFiles(rawFiles) {
    await this.init();

    this.totalPhotos += rawFiles.length;

    const descriptors = rawFiles.map(file => {
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      return {
        id: tempId,
        filename: file.name,
        size: file.size,
        thumbnail: '',
        isUploading: true,
        file
      };
    });

    // Enqueue all files into the ANALYZE_PHOTO queue
    for (const item of descriptors) {
      this.taskQueue.enqueue('ANALYZE_PHOTO', {
        file: item.file,
        tempId: item.id
      }).catch(err => {
        console.error(`Error analyzing file ${item.filename}:`, err);
        this.emit('error', err);
      });
    }

    return descriptors;
  }

  /**
   * Waits until all currently enqueued tasks across all queues complete.
   */
  async waitUntilComplete() {
    // 1. Wait for analysis queue to finish
    await this.taskQueue.waitUntilTypeIdle('ANALYZE_PHOTO');

    // 2. Flush any remaining active clusters
    await this.flushAllClusters();

    // 3. Wait for encode and upload queues to become fully idle
    await this.taskQueue.waitUntilIdle();
  }

  /**
   * Returns live multi-stage queue metrics for UI dashboards.
   */
  getLiveStats() {
    const qStats = this.taskQueue.getStats();
    const percent = this.totalPhotos > 0 
      ? Math.min(100, Math.round((this.processedPhotos / this.totalPhotos) * 100))
      : 0;

    return {
      percent,
      total: this.totalPhotos,
      completed: this.processedPhotos,
      analyzing: {
        queued: qStats.queued['ANALYZE_PHOTO'] || 0,
        active: qStats.active['ANALYZE_PHOTO'] || 0
      },
      encoding: {
        queued: qStats.queued['ENCODE_CONTAINER'] || 0,
        active: qStats.active['ENCODE_CONTAINER'] || 0
      },
      uploading: {
        queued: qStats.queued['UPLOAD_CONTAINER'] || 0,
        active: qStats.active['UPLOAD_CONTAINER'] || 0
      },
      isIdle: qStats.isIdle && this.activeClusters.size === 0
    };
  }

  on(event, callback) {
    return this.taskQueue.on(event, callback);
  }

  off(event, callback) {
    return this.taskQueue.off(event, callback);
  }

  emit(event, data) {
    return this.taskQueue.emit(event, data);
  }

  clear() {
    for (const cluster of this.activeClusters.values()) {
      if (cluster.timer) clearTimeout(cluster.timer);
    }
    this.activeClusters.clear();
    this.taskQueue.clear();
    this.totalPhotos = 0;
    this.processedPhotos = 0;
  }
}
