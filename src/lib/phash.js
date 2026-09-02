// --- 1. SHA-256 Deduplication ---
export async function getFileHash(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Helper: Get Image Bitmap for Canvas ---
async function getImageBitmap(file) {
  return await createImageBitmap(file);
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;

  if (max === min) {
    h = 0; // achromatic
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, v];
}

// --- 2. Visual Feature Extraction ---
export async function analyzeVisualFeatures(file) {
  const bitmap = await getImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;

  // OffscreenCanvas for 64x64
  const canvas = new OffscreenCanvas(64, 64);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  // Center-crop and scale to 64x64
  const size = Math.min(width, height);
  const sx = (width - size) / 2;
  const sy = (height - size) / 2;
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, 64, 64);
  
  const imageData = ctx.getImageData(0, 0, 64, 64);
  const data = imageData.data;
  
  // 32-Bin HSV Histogram (16 H, 8 S, 8 V)
  const hsvHist = new Array(32).fill(0);
  let totalPixels = 64 * 64;
  
  // 64-bit dHash (using 8x8 blocks, so scale down to 9x8)
  const dHashCanvas = new OffscreenCanvas(9, 8);
  const dHashCtx = dHashCanvas.getContext('2d', { willReadFrequently: true });
  dHashCtx.drawImage(canvas, 0, 0, 64, 64, 0, 0, 9, 8);
  const dHashData = dHashCtx.getImageData(0, 0, 9, 8).data;
  let dHash = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idx1 = (y * 9 + x) * 4;
      const idx2 = (y * 9 + (x + 1)) * 4;
      const luma1 = dHashData[idx1] * 0.299 + dHashData[idx1 + 1] * 0.587 + dHashData[idx1 + 2] * 0.114;
      const luma2 = dHashData[idx2] * 0.299 + dHashData[idx2 + 1] * 0.587 + dHashData[idx2 + 2] * 0.114;
      dHash += luma1 > luma2 ? '1' : '0';
    }
  }

  // 4x4 Spatial Blocks (16 sub-regions of 16x16)
  const spatialBlocks = [];
  for (let by = 0; by < 4; by++) {
    for (let bx = 0; bx < 4; bx++) {
      let lumaSum = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const px = bx * 16 + x;
          const py = by * 16 + y;
          const idx = (py * 64 + px) * 4;
          const r = data[idx];
          const g = data[idx+1];
          const b = data[idx+2];
          
          const luma = r * 0.299 + g * 0.587 + b * 0.114;
          lumaSum += luma;
          
          // Populate HSV hist on the fly
          const [hsvH, hsvS, hsvV] = rgbToHsv(r, g, b);
          const hBin = Math.floor(hsvH * 15.99); // 0-15
          const sBin = Math.floor(hsvS * 7.99) + 16; // 16-23
          const vBin = Math.floor(hsvV * 7.99) + 24; // 24-31
          hsvHist[hBin]++;
          hsvHist[sBin]++;
          hsvHist[vBin]++;
        }
      }
      spatialBlocks.push({ lumaAvg: lumaSum / 256 });
    }
  }

  // Normalize Histogram
  for (let i = 0; i < 32; i++) hsvHist[i] /= totalPixels;

  // Extract Thumbnail (Grid optimized, 320px)
  const thumbSize = 320;
  const thumbScale = Math.min(thumbSize / width, thumbSize / height);
  const tw = width * thumbScale;
  const th = height * thumbScale;
  const thumbCanvas = new OffscreenCanvas(tw, th);
  const thumbCtx = thumbCanvas.getContext('2d');
  thumbCtx.drawImage(bitmap, 0, 0, tw, th);
  
  const blob = await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const thumbnailDataUrl = await new Promise(r => {
    const reader = new FileReader();
    reader.onload = () => r(reader.result);
    reader.readAsDataURL(blob);
  });

  bitmap.close();
  return { dHash, hsvHist, spatialBlocks, thumbnailDataUrl };
}

// --- 3. Similarity Metric ---
export function calculateSimilarity(feat1, feat2) {
  // 1. Structural Score (dHash hamming distance)
  let hammingDistance = 0;
  for (let i = 0; i < 64; i++) {
    if (feat1.dHash[i] !== feat2.dHash[i]) hammingDistance++;
  }
  const struct_score = 1 - (hammingDistance / 64);

  // 2. Color Score (Cosine similarity of HSV Histogram)
  let dotProduct = 0, norm1 = 0, norm2 = 0;
  for (let i = 0; i < 32; i++) {
    dotProduct += feat1.hsvHist[i] * feat2.hsvHist[i];
    norm1 += feat1.hsvHist[i] ** 2;
    norm2 += feat2.hsvHist[i] ** 2;
  }
  const color_score = (norm1 === 0 || norm2 === 0) ? 0 : dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));

  // 3. Spatial Score
  const spatialDiffs = [];
  for (let i = 0; i < 16; i++) {
    const diff = Math.abs(feat1.spatialBlocks[i].lumaAvg - feat2.spatialBlocks[i].lumaAvg) / 255;
    spatialDiffs.push(1 - diff);
  }
  spatialDiffs.sort((a, b) => b - a); // Top highest similarities
  const top12_spatial_avg = spatialDiffs.slice(0, 12).reduce((a, b) => a + b, 0) / 12;

  // Total Score
  const score = (0.50 * top12_spatial_avg) + (0.30 * color_score) + (0.20 * struct_score);
  return score;
}
export function isSameScene(feat1, feat2) { return calculateSimilarity(feat1, feat2) > 0.85; }
