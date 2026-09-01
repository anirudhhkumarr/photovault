import { describe, it, expect } from 'vitest';
import { encodeImagesToVideo, extractSingleFrame, loadImageElement } from './videoEncoder.js';

// Helper to fetch the test image as a Blob from the public or test_photos directory
// Since this runs in the browser, we can fetch it via HTTP
async function fetchTestImageBlob(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return await response.blob();
}

/**
 * Calculates PSNR between two ImageData objects.
 */
function calculatePSNR(img1, img2) {
  if (img1.width !== img2.width || img1.height !== img2.height) {
    throw new Error(`Dimension mismatch: ${img1.width}x${img1.height} vs ${img2.width}x${img2.height}`);
  }
  const data1 = img1.data;
  const data2 = img2.data;
  let mse = 0;
  for (let i = 0; i < data1.length; i += 4) {
    const r = data1[i] - data2[i];
    const g = data1[i + 1] - data2[i + 1];
    const b = data1[i + 2] - data2[i + 2];
    mse += r * r + g * g + b * b;
  }
  mse = mse / (img1.width * img1.height * 3);
  if (mse === 0) return Infinity;
  const max = 255;
  return 20 * Math.log10(max) - 10 * Math.log10(mse);
}

async function getImageData(source) {
  const img = await loadImageElement(source);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

describe('videoEncoder MP4 Roundtrip', () => {
  it('should encode an image to MP4 and extract it back', async () => {
    // 1. Fetch the image
    const imageBlob = await fetchTestImageBlob('/test_photos/photo2.jpg');
    expect(imageBlob.size).toBeGreaterThan(0);

    // 2. Encode to video
    const videoResult = await encodeImagesToVideo([imageBlob]);
    expect(videoResult.blob).toBeDefined();
    expect(videoResult.blob.length).toBeGreaterThan(0);
    expect(videoResult.mimeType).toMatch(/video\/(mp4|webm)/);

    // 3. Extract frame back
    const extractedSrc = await extractSingleFrame(videoResult.blob, 0.5);
    expect(extractedSrc).toBeTruthy();

    // 4. Calculate dimensions and compare
    // Note: Due to MAX_DIM = 3840 in videoEncoder.js and YUV 4:2:0 subsampling,
    // this will NOT be bit-exact, and dimensions might differ if the original is > 4K.
    
    const originalData = await getImageData(imageBlob);
    const extractedData = await getImageData(extractedSrc);

    expect(extractedData.width).toBeGreaterThan(0);
    expect(extractedData.height).toBeGreaterThan(0);

    console.log(`Original Dimensions: ${originalData.width}x${originalData.height}`);
    console.log(`Extracted Dimensions: ${extractedData.width}x${extractedData.height}`);
    
    // Assert that dimensions are strictly preserved
    expect(extractedData.width).toBe(originalData.width);
    expect(extractedData.height).toBe(originalData.height);
    expect(extractedData.data.length).toBeGreaterThan(0);

    const psnr = calculatePSNR(originalData, extractedData);
    console.log(`PSNR: ${psnr.toFixed(2)} dB`);
    
    // Check if it's perfectly bit-exact
    if (psnr === Infinity) {
      console.log('The conversion was mathematically lossless (Bit-Exact)!');
    } else {
      console.log(`The conversion was LOSSY (PSNR: ${psnr.toFixed(2)} dB) due to YUV subsampling and hardware encoder constraints.`);
    }

    // Assert that it's lossy to prove the point (PSNR won't be infinity)
    expect(psnr).toBeLessThan(Infinity);
  });

  it('should demonstrate lossy compression on a small image (no resizing)', async () => {
    // Create a 100x100 red square data URL
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Draw a complex pattern to ensure it's not trivial to compress
    const gradient = ctx.createLinearGradient(0, 0, 128, 128);
    gradient.addColorStop(0, 'red');
    gradient.addColorStop(0.5, 'green');
    gradient.addColorStop(1, 'blue');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    
    const dataUrl = canvas.toDataURL('image/png');
    const originalData = ctx.getImageData(0, 0, 128, 128);

    // Encode
    const videoResult = await encodeImagesToVideo([dataUrl]);
    
    // Decode
    const extractedSrc = await extractSingleFrame(videoResult.blob, 0.5);
    const extractedData = await getImageData(extractedSrc);
    
    expect(originalData.width).toBe(extractedData.width);
    expect(originalData.height).toBe(extractedData.height);
    
    const psnr = calculatePSNR(originalData, extractedData);
    console.log(`Small Image PSNR: ${psnr.toFixed(2)} dB`);
    
    // It should be lossy (not Infinity)
    expect(psnr).toBeLessThan(Infinity);
  });
});

