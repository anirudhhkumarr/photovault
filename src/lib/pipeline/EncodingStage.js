import { getVideoBlob, getPhotos, addPhoto, updateVideo, extractAllFramesFromVideo } from '../db';
import { encodeImagesToVideo } from '../videoEncoder';

/**
 * Consumer for the encoding queue.
 * Takes a cluster of photos, retrieves any existing container from IndexedDB,
 * extracts existing frames, appends new frames, and encodes into HEVC MP4.
 */
export class EncodingStage {
  constructor(inputQueue, outputQueue, onProgress) {
    this.inputQueue = inputQueue;
    this.outputQueue = outputQueue;
    this.onProgress = onProgress;
  }

  async start() {
    while (true) {
      const cluster = await this.inputQueue.pop();
      if (!cluster) {
        this.outputQueue.close();
        break;
      }

      const { groupId, items } = cluster;
      this.onProgress(`Preparing to encode container ${groupId}...`);

      try {
        const existingContainerBlob = await getVideoBlob(groupId);
        let allImagesForGroup = [];
        
        // 1. Gather all frames (existing + new)
        if (existingContainerBlob) {
          const currentPhotosInGroup = (await getPhotos()).filter(p => p.videoId === groupId);
          const extractedFrames = await extractAllFramesFromVideo(existingContainerBlob, currentPhotosInGroup.length);
          allImagesForGroup = [...extractedFrames.map(f => f.dataUrl), ...items.map(item => item.data)];
        } else {
          allImagesForGroup = items.map(item => item.data);
        }

        // 2. Hardware HEVC Encoding
        const encoded = await encodeImagesToVideo(allImagesForGroup, (cur, total) => {
          this.onProgress(`Encoding container ${groupId} (frame ${cur}/${total})...`);
        });

        // 3. Save new metadata to DB
        const startIndex = existingContainerBlob ? ((await getPhotos()).filter(p => p.videoId === groupId).length) : 0;
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const frameIndex = startIndex + i;
          await addPhoto({
            filename: item.name,
            contentHash: item.contentHash,
            fingerprint: item.fingerprint,
            videoId: groupId,
            frameIndex,
            timestamp: frameIndex * 1.0 + 0.2, // standard 1 fps offset
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

        // 4. Push to Upload queue
        await this.outputQueue.push({
          groupId,
          blob: encoded.blob,
          mimeType: encoded.mimeType || 'video/mp4',
          itemCount: items.length,
          itemIds: items.map(i => i._tempId)
        });

      } catch (err) {
        console.error(`Failed to encode container ${groupId}:`, err);
      }
    }
  }
}
