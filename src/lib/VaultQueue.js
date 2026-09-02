import { TaskQueue } from './TaskQueue';
import { PipelineRouter } from './PipelineRouter';

export function createVaultPipeline(services) {
  const vaultQueue = new TaskQueue();
  const router = new PipelineRouter();

  vaultQueue.registerType('ANALYZE_PHOTO', 4);
  vaultQueue.registerType('ENCODE_CONTAINER', 1);
  vaultQueue.registerType('UPLOAD_CONTAINER', 2);

  const clusterBuffer = [];
  const CLUSTER_THRESHOLD_ITEMS = 10;
  const CLUSTER_THRESHOLD_BYTES = 150 * 1024 * 1024; // 150MB

  function forceFlushCluster() {
    if (clusterBuffer.length === 0) return;
    const cluster = [...clusterBuffer];
    clusterBuffer.length = 0;
    vaultQueue.enqueue('ENCODE_CONTAINER', cluster);
  }

  // Define Handlers using the new Composable PipelineRouter
  router.use('ANALYZE_PHOTO', async (task, context) => {
    const file = task.payload.file;
    const skeletonId = task.payload.skeletonId;
    
    context.queue.dispatchEvent(new CustomEvent('vault:progress', { detail: { itemIds: [skeletonId], state: 'analyzing' } }));
    
    const hash = await services.db.getFileHash(file);
    
    // Deduplication check
    const existingPhoto = await services.db.getPhoto(hash);
    if (existingPhoto) {
      context.queue.dispatchEvent(new CustomEvent('vault:progress', { detail: { itemIds: [skeletonId], state: 'duplicate' } }));
      context.queue.complete(task.id, { isDuplicate: true, skeletonId });
      return;
    }

    const bitmap = await services.image.createImageBitmap(file);
    const features = await services.phash.analyzeVisualFeatures(file);
    
    const photoData = {
      id: hash,
      file,
      originalName: file.name,
      originalSize: file.size,
      mimeType: file.type,
      width: bitmap.width,
      height: bitmap.height,
      ...features,
      skeletonId: task.payload.skeletonId
    };
    bitmap.close();
    
    context.queue.complete(task.id, photoData);
  });

  router.use('ENCODE_CONTAINER', async (task, context) => {
    const cluster = task.payload;
    const containerId = `vault_${Date.now()}_${cluster.length}_${cluster[0].id.slice(0,8)}`;
    const itemIds = cluster.map(p => p.skeletonId);
    
    context.queue.dispatchEvent(new CustomEvent('vault:progress', { detail: { itemIds, state: 'packing', message: `Encoding cluster of ${cluster.length} photos...` } }));
    
    const { blob, mimeType, manifest } = await services.encoder.encodeContainer(cluster, (msg) => {
      context.queue.dispatchEvent(new CustomEvent('vault:progress', { detail: { message: msg } }));
    });
    
    for (let i = 0; i < cluster.length; i++) {
      const photo = cluster[i];
      const dbPhoto = {
        id: photo.id,
        filename: photo.originalName,
        mimeType: photo.mimeType,
        originalSize: photo.originalSize,
        width: photo.width,
        height: photo.height,
        thumbnailDataUrl: photo.thumbnailDataUrl,
        videoId: containerId,
        frameIndex: i,
        timestamp: i + 0.5,
        createdAt: Date.now(),
        skeletonId: photo.skeletonId,
        syncStatus: 'packing'
      };
      await services.db.addPhoto(dbPhoto);
      cluster[i] = dbPhoto;
    }
    
    const originalTotalBytes = cluster.reduce((sum, p) => sum + p.originalSize, 0);
    
    // SAVE TO LOCAL DATABASE FOR PERSISTENCE BEFORE UPLOAD
    await services.db.addVideo({
      id: containerId,
      blob,
      manifest,
      photos: cluster,
      originalTotalBytes
    });
    
    context.queue.complete(task.id, {
      containerId,
      blob,
      manifest,
      originalTotalBytes,
      itemCount: cluster.length,
      photos: cluster
    });
  });

  router.use('UPLOAD_CONTAINER', async (task, context) => {
    // If blob is missing in payload (e.g. retry), fetch from DB
    let { containerId, blob, manifest, originalTotalBytes, photos } = task.payload;
    
    if (!blob) {
      const dbVideo = await services.db.getVideo(containerId);
      if (!dbVideo) throw new Error(`Video container ${containerId} not found in local database`);
      blob = dbVideo.blob;
      manifest = dbVideo.manifest;
      photos = dbVideo.photos;
      originalTotalBytes = dbVideo.originalTotalBytes;
    }
    
    const itemIds = photos.map(p => p.skeletonId);
    context.queue.dispatchEvent(new CustomEvent('vault:progress', { detail: { itemIds, state: 'uploading', message: `Uploading ${containerId}.mp4...` } }));
    
    try {
      await services.drive.uploadContainer({
        groupId: containerId,
        blob,
        manifest,
        fullPhotos: photos
      });
      
      // SUCCESS! Mark as synced and delete heavy local blob
      for (const p of photos) {
        await services.db.addPhoto({ ...p, syncStatus: 'synced' });
      }
      await services.db.deleteVideo(containerId);
      
      context.queue.complete(task.id, { containerId, originalTotalBytes, photos });
    } catch (err) {
      // FAILURE! Mark as failed
      for (const p of photos) {
        await services.db.addPhoto({ ...p, syncStatus: 'failed' });
      }
      throw err;
    }
  });

  // Attach PipelineRouter to TaskQueue
  vaultQueue.addEventListener('task:started', async (e) => {
    const task = e.detail;
    try {
      await router.dispatch(task, { queue: vaultQueue, services });
    } catch (error) {
      vaultQueue.fail(task.id, error);
    }
  });

  vaultQueue.addEventListener('task:completed', (e) => {
    const task = e.detail;
    
    if (task.type === 'ANALYZE_PHOTO') {
      if (task.result.isDuplicate) return;
      
      const photoData = { ...task.result, syncStatus: 'analyzed' };
      const bufferSize = clusterBuffer.reduce((sum, p) => sum + p.originalSize, 0);
      
      // Intelligent scene flushing
      if (clusterBuffer.length > 0) {
        const prev = clusterBuffer[clusterBuffer.length - 1];
        if (prev.fingerprint && photoData.fingerprint && !services.phash.isSameScene(prev.fingerprint, photoData.fingerprint)) {
          forceFlushCluster();
        }
      }
      
      clusterBuffer.push(photoData);
      const newSize = bufferSize + photoData.originalSize;
      
      if (clusterBuffer.length >= CLUSTER_THRESHOLD_ITEMS || newSize >= CLUSTER_THRESHOLD_BYTES) {
        forceFlushCluster();
      }
      
    } else if (task.type === 'ENCODE_CONTAINER') {
      vaultQueue.enqueue('UPLOAD_CONTAINER', task.result);
    }
  });

  return { vaultQueue, forceFlushCluster };
}
