import { computeContentHash, extractSceneFingerprint, generateThumbnail } from '../phash';

/**
 * Consumer for the initial ingest queue.
 * Takes a raw File, computes its perceptual data, and pushes it to the next queue.
 */
export class FingerprintStage {
  constructor(inputQueue, outputQueue, onProgress) {
    this.inputQueue = inputQueue;
    this.outputQueue = outputQueue;
    this.onProgress = onProgress;
  }

  async start() {
    while (true) {
      const file = await this.inputQueue.pop();
      if (!file) {
        // null means the queue was closed and is now empty
        this.outputQueue.close();
        break;
      }

      this.onProgress(`Analyzing: ${file.name}`);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const [contentHash, fingerprint, thumbnail] = await Promise.all([
          computeContentHash(arrayBuffer),
          extractSceneFingerprint(file).catch(() => null),
          generateThumbnail(file, 400)
        ]);

        const processedItem = {
          file,
          name: file.name,
          size: file.size,
          contentHash,
          fingerprint,
          thumbnail,
          data: new Uint8Array(arrayBuffer)
        };

        await this.outputQueue.push(processedItem);
      } catch (err) {
        console.error(`Failed to process fingerprint for ${file.name}:`, err);
      }
    }
  }
}
