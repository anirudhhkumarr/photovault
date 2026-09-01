import { describe, it, expect } from 'vitest';
import { encodeImagesToVideo, extractSingleFrame, extractAllFramesFromVideo, loadImageElement } from './videoEncoder.js';

function createPatternImage(color1, color2, width = 128, height = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  return canvas.toDataURL('image/png');
}

describe('videoEncoder Multi-Photo Container Extraction', () => {
  it('should encode 2 photos in 1 container and extract both frames independently', async () => {
    // 1. Create two distinct test photos
    const photo1 = createPatternImage('red', 'yellow');
    const photo2 = createPatternImage('blue', 'green');

    // 2. Encode both into a single video container
    const videoResult = await encodeImagesToVideo([photo1, photo2]);
    expect(videoResult.blob).toBeDefined();
    expect(videoResult.blob.length).toBeGreaterThan(0);
    expect(videoResult.frameCount).toBe(2);

    // 3. Extract single frame 0 (timestamp 0.5s)
    const extractedFrame0 = await extractSingleFrame(videoResult.blob, 0.5);
    expect(extractedFrame0).toBeTruthy();
    const img0 = await loadImageElement(extractedFrame0);
    expect(img0.width).toBeGreaterThan(0);

    // 4. Extract single frame 1 (timestamp 1.5s)
    const extractedFrame1 = await extractSingleFrame(videoResult.blob, 1.5);
    expect(extractedFrame1).toBeTruthy();
    const img1 = await loadImageElement(extractedFrame1);
    expect(img1.width).toBeGreaterThan(0);

    // 5. Extract all frames in bulk
    const allFrames = await extractAllFramesFromVideo(videoResult.blob, 2);
    expect(allFrames.length).toBe(2);
    expect(allFrames[0].dataUrl).toBeTruthy();
    expect(allFrames[1].dataUrl).toBeTruthy();

    // Verify frames are different images (photo 1 vs photo 2)
    expect(allFrames[0].dataUrl).not.toEqual(allFrames[1].dataUrl);
  });

  it('should encode and extract a 3-photo container without losing any frames', async () => {
    const photo1 = createPatternImage('red', 'black');
    const photo2 = createPatternImage('blue', 'white');
    const photo3 = createPatternImage('purple', 'cyan');

    const videoResult = await encodeImagesToVideo([photo1, photo2, photo3]);
    expect(videoResult.frameCount).toBe(3);

    const allFrames = await extractAllFramesFromVideo(videoResult.blob, 3);
    expect(allFrames.length).toBe(3);
    expect(allFrames[0].dataUrl).not.toEqual(allFrames[1].dataUrl);
    expect(allFrames[1].dataUrl).not.toEqual(allFrames[2].dataUrl);
  });
});
