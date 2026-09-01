import { render, cleanup } from '@testing-library/react';
import { vi } from 'vitest';


// Mock IntersectionObserver to trigger immediately in tests
const mockIntersectionObserver = vi.fn((callback) => ({
  observe: () => {
    callback([{ isIntersecting: true }]);
  },
  unobserve: () => null,
  disconnect: () => null
}));
window.IntersectionObserver = mockIntersectionObserver;

// Mock createImageBitmap to avoid JSDOM/Happy-DOM errors
window.createImageBitmap = vi.fn().mockResolvedValue({
  width: 100,
  height: 100,
  close: vi.fn()
});

// Mock WebCodecs and other hardware APIs
vi.mock('../lib/videoEncoder', () => ({
  encodeContainer: vi.fn().mockImplementation(async (cluster, onProgress) => {
    onProgress('Mock encoding...');
    return { 
      blob: new Blob(['fake-video']), 
      mimeType: 'video/mp4', 
      manifest: { c: 'MP4', p: cluster.map(c => ({ h: c.id })) } 
    };
  }),
  extractFrame: vi.fn().mockResolvedValue('data:image/jpeg;base64,mockedframe')
}));

vi.mock('../lib/phash', () => ({
  analyzeVisualFeatures: vi.fn().mockResolvedValue({
    dHash: '1010', hsvHist: [], spatialBlocks: [], thumbnailDataUrl: 'data:image/jpeg;base64,mock'
  }),
  getFileHash: vi.fn().mockResolvedValue('fakehash123'),
  isSameScene: vi.fn().mockReturnValue(true)
}));

export function renderWithCleanup(ui) {
  cleanup();
  return render(ui);
}
