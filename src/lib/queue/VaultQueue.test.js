import { describe, it, expect, vi } from 'vitest';
import { VaultQueue } from './VaultQueue';

vi.mock('../db', () => ({
  getPhotos: vi.fn().mockResolvedValue([]),
  addPhoto: vi.fn().mockResolvedValue(1),
  updateVideo: vi.fn().mockResolvedValue(1),
  getVideoBlob: vi.fn().mockResolvedValue(null),
  exportContainerMetadata: vi.fn().mockResolvedValue('{"photos":[]}')
}));

vi.mock('../videoEncoder', () => ({
  encodeImagesToVideo: vi.fn().mockResolvedValue({
    blob: new Uint8Array([1, 2, 3, 4]),
    frameCount: 2,
    width: 1920,
    height: 1080,
    mimeType: 'video/mp4'
  }),
  extractAllFramesFromVideo: vi.fn().mockResolvedValue([])
}));

vi.mock('../phash', () => ({
  computeContentHash: vi.fn().mockResolvedValue('hash123'),
  extractSceneFingerprint: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2])),
  arePhotosInSameScene: vi.fn().mockReturnValue(true),
  generateThumbnail: vi.fn().mockResolvedValue('data:image/jpeg;base64,mock')
}));

vi.mock('../googleDrive', () => ({
  getAccessToken: vi.fn().mockReturnValue(null),
  uploadFileToGoogleDrive: vi.fn().mockResolvedValue({ id: 'file123' }),
  uploadOrUpdateFileInGoogleDrive: vi.fn().mockResolvedValue({ id: 'meta123' })
}));

describe('VaultQueue Event-Driven Coordinator', () => {
  it('should stream images through analysis, chunk clustering, encoding, and upload', async () => {
    const vaultQueue = new VaultQueue();
    const analyzedPhotos = [];
    const encodedContainers = [];
    const uploadedContainers = [];

    vaultQueue.on('photo:analyzed', (item) => analyzedPhotos.push(item));
    vaultQueue.on('container:encoded', (ev) => encodedContainers.push(ev));
    vaultQueue.on('container:uploaded', (ev) => uploadedContainers.push(ev));

    // Create 3 mock File objects
    const createMockFile = (name) => {
      const blob = new Blob(['mock image data'], { type: 'image/jpeg' });
      blob.name = name;
      return blob;
    };

    const files = [
      createMockFile('photo1.jpg'),
      createMockFile('photo2.jpg'),
      createMockFile('photo3.jpg')
    ];

    const descriptors = await vaultQueue.enqueueFiles(files);
    expect(descriptors.length).toBe(3);

    // Await complete processing
    await vaultQueue.waitUntilComplete();

    expect(analyzedPhotos.length).toBe(3);
    expect(encodedContainers.length).toBeGreaterThan(0);
    expect(uploadedContainers.length).toBeGreaterThan(0);
  });
});
