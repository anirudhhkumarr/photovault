import { TaskQueue } from './TaskQueue';
// We will import actual logic handlers here later
// import { analyzePhoto } from './phash';
// import { encodeContainer } from './videoEncoder';
// import { uploadContainer } from './googleDrive';

export const vaultQueue = new TaskQueue();

// Orchestrate the pipeline: ANALYZE_PHOTO (Concurrency 4) -> Clustering -> ENCODE_CONTAINER (Concurrency 1) -> UPLOAD_CONTAINER (Concurrency 2).
vaultQueue.registerType('ANALYZE_PHOTO', 4);
vaultQueue.registerType('ENCODE_CONTAINER', 1);
vaultQueue.registerType('UPLOAD_CONTAINER', 2);

vaultQueue.addEventListener('task:started', async (e) => {
  const task = e.detail;
  try {
    if (task.type === 'ANALYZE_PHOTO') {
      // result = await analyzePhoto(task.payload.file);
      // vaultQueue.complete(task.id, result);
    } else if (task.type === 'ENCODE_CONTAINER') {
      // result = await encodeContainer(task.payload);
      // vaultQueue.complete(task.id, result);
    } else if (task.type === 'UPLOAD_CONTAINER') {
      // result = await uploadContainer(task.payload);
      // vaultQueue.complete(task.id, result);
    }
  } catch (error) {
    vaultQueue.fail(task.id, error);
  }
});

// A buffer for clustering
export const clusterBuffer = [];
// This will be called when an ANALYZE_PHOTO task completes successfully.
vaultQueue.addEventListener('task:completed', (e) => {
  const task = e.detail;
  if (task.type === 'ANALYZE_PHOTO') {
    // 1. Add to clusterBuffer
    // 2. Run clustering logic
    // 3. If threshold met (10 items or 25MB), or similarity boundary hit:
    //    const group = flushCluster();
    //    vaultQueue.enqueue('ENCODE_CONTAINER', group);
  } else if (task.type === 'ENCODE_CONTAINER') {
    // Then upload
    // vaultQueue.enqueue('UPLOAD_CONTAINER', task.result);
  }
});
