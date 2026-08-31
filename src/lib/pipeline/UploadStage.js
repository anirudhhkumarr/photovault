import { getAccessToken, uploadFileToGoogleDrive, uploadOrUpdateFileInGoogleDrive } from '../googleDrive';
import { exportContainerMetadata } from '../db';

/**
 * Consumer for the upload queue.
 * Takes encoded MP4 containers and uploads them to Google Drive (if authenticated).
 * Also backs up the container metadata JSON.
 */
export class UploadStage {
  constructor(inputQueue, onProgress, onItemsComplete) {
    this.inputQueue = inputQueue;
    this.onProgress = onProgress;
    this.onItemsComplete = onItemsComplete;
  }

  async start() {
    while (true) {
      const container = await this.inputQueue.pop();
      if (!container) {
        break; // Pipeline finished
      }

      const { groupId, blob, mimeType, itemCount, itemIds } = container;
      const token = getAccessToken();
      
      if (!token) {
        // Skip upload if not connected to Google Drive
        continue;
      }

      this.onProgress(`Syncing container ${groupId} to Google Drive...`);

      try {
        // Upload the MP4 container
        await uploadFileToGoogleDrive(`${groupId}.mp4`, blob, mimeType || 'video/mp4', token);

        // Export and upload the metadata JSON
        const dbJson = await exportContainerMetadata(groupId);
        await uploadOrUpdateFileInGoogleDrive(`metadata_${groupId}.json`, dbJson, 'application/json', token);
        
        this.onProgress(`Successfully synced ${groupId}`);
      } catch (err) {
        console.error(`Failed to upload container ${groupId}:`, err);
      } finally {
        // Always report items complete, even if Drive sync skipped/failed
        if (this.onItemsComplete && itemCount) {
          this.onItemsComplete(itemCount, itemIds);
        }
      }
    }
  }
}
