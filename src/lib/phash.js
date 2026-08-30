/**
 * 100% Pure Computer Vision Scene & Perceptual Feature Matcher
 * 
 * Evaluates image pixel content ONLY (zero filename or metadata heuristics):
 * - 4x4 Spatial background sub-region correlation (tolerates moving subjects/people)
 * - 32-bin HSV ambient color & lighting distribution
 * - Perceptual gradient structure (dHash)
 */

/**
 * Computes SHA-256 hash of a file or ArrayBuffer for exact byte deduplication.
 */
export async function computeContentHash(data) {
  const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extracts a pure visual Scene Fingerprint from pixel data:
 * 1. 4x4 Spatial Block Grid (16 sub-region luminance & gradient profiles)
 * 2. 32-bin Color Structure Histogram (Hue, Saturation, Value)
 * 3. 64-bit Global Gradient Hash (dHash)
 */
export async function extractSceneFingerprint(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return reject(new Error('Canvas 2D context unavailable'));
      }
      
      const W = 64;
      const H = 64;
      canvas.width = W;
      canvas.height = H;
      
      // Normalized scale-and-fill to preserve visual structure regardless of resolution
      const imgW = img.naturalWidth || img.width || 64;
      const imgH = img.naturalHeight || img.height || 64;
      const scale = Math.max(W / imgW, H / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const drawX = (W - drawW) / 2;
      const drawY = (H - drawH) / 2;
      
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;
      
      // 1. Color Histogram (16 Hue bins, 8 Saturation bins, 8 Value bins)
      const hueBins = new Float32Array(16);
      const satBins = new Float32Array(8);
      const valBins = new Float32Array(8);
      const gray64 = new Float32Array(W * H);
      
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        gray64[i / 4] = lum;
        
        // RGB to HSV for ambient lighting / scene color distribution
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        
        let h = 0;
        if (delta > 0.001) {
          if (max === r) h = ((g - b) / delta) % 6;
          else if (max === g) h = (b - r) / delta + 2;
          else h = (r - g) / delta + 4;
          h = Math.round(h * 60);
          if (h < 0) h += 360;
        }
        
        const s = max === 0 ? 0 : delta / max;
        const v = max;
        
        const hIdx = Math.min(15, Math.floor(h / 22.5));
        const sIdx = Math.min(7, Math.floor(s * 8));
        const vIdx = Math.min(7, Math.floor(v * 8));
        
        hueBins[hIdx]++;
        satBins[sIdx]++;
        valBins[vIdx]++;
      }
      
      const totalPixels = W * H;
      for (let i = 0; i < 16; i++) hueBins[i] /= totalPixels;
      for (let i = 0; i < 8; i++) satBins[i] /= totalPixels;
      for (let i = 0; i < 8; i++) valBins[i] /= totalPixels;
      
      // 2. Spatial 4x4 Grid Descriptors (16 Blocks)
      const blockGrid = [];
      const blockSize = 16;
      
      for (let gy = 0; gy < 4; gy++) {
        for (let gx = 0; gx < 4; gx++) {
          let blockLumSum = 0;
          let blockGradH = 0;
          let blockGradV = 0;
          
          for (let by = 0; by < blockSize; by++) {
            for (let bx = 0; bx < blockSize; bx++) {
              const x = gx * blockSize + bx;
              const y = gy * blockSize + by;
              const idx = y * W + x;
              const val = gray64[idx];
              blockLumSum += val;
              
              if (bx < blockSize - 1) {
                blockGradH += Math.abs(val - gray64[idx + 1]);
              }
              if (by < blockSize - 1) {
                blockGradV += Math.abs(val - gray64[idx + W]);
              }
            }
          }
          
          const count = blockSize * blockSize;
          blockGrid.push({
            avgLum: blockLumSum / count,
            gradH: blockGradH / count,
            gradV: blockGradV / count
          });
        }
      }
      
      // 3. Global 64-bit dHash
      let globalDHash = '';
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sampleY = Math.floor(y * 8);
          const sampleX1 = Math.floor(x * 8);
          const sampleX2 = Math.floor((x + 1) * 7.5);
          const left = gray64[sampleY * W + sampleX1];
          const right = gray64[sampleY * W + sampleX2];
          globalDHash += left > right ? '1' : '0';
        }
      }
      
      resolve({
        hueBins: Array.from(hueBins),
        satBins: Array.from(satBins),
        valBins: Array.from(valBins),
        blockGrid,
        globalDHash
      });
    };
    
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    
    img.src = url;
  });
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculates a continuous Scene Similarity Score (0.0 to 1.0)
 * using top-matching spatial background blocks and ambient lighting.
 */
export function computeSceneSimilarity(fp1, fp2) {
  if (!fp1 || !fp2 || !fp1.blockGrid || !fp2.blockGrid) return 0;
  
  // 1. Color Harmony Similarity (ambient lighting & scene palette)
  const hueSim = cosineSimilarity(fp1.hueBins, fp2.hueBins);
  const satSim = cosineSimilarity(fp1.satBins, fp2.satBins);
  const valSim = cosineSimilarity(fp1.valBins, fp2.valBins);
  const colorScore = 0.5 * hueSim + 0.25 * satSim + 0.25 * valSim;
  
  // 2. Continuous Spatial Sub-Region Correlation (16 Blocks)
  const blockScores = [];
  for (let i = 0; i < 16; i++) {
    const b1 = fp1.blockGrid[i];
    const b2 = fp2.blockGrid[i];
    const lumDiff = Math.abs(b1.avgLum - b2.avgLum);
    const gradHDiff = Math.abs(b1.gradH - b2.gradH);
    const gradVDiff = Math.abs(b1.gradV - b2.gradV);
    
    const diff = (lumDiff / 0.35) * 0.5 + (gradHDiff / 0.18) * 0.25 + (gradVDiff / 0.18) * 0.25;
    const sim = Math.max(0, 1.0 - diff);
    blockScores.push(sim);
  }
  
  // Top 12 background regions (75% of frame)
  blockScores.sort((a, b) => b - a);
  const top12Avg = blockScores.slice(0, 12).reduce((sum, v) => sum + v, 0) / 12.0;
  
  // 3. Global Structural Correlation (dHash)
  let dHashMatches = 0;
  for (let i = 0; i < 64; i++) {
    if (fp1.globalDHash[i] === fp2.globalDHash[i]) dHashMatches++;
  }
  const structScore = dHashMatches / 64.0;
  
  // 50% spatial background correlation + 30% ambient color palette + 20% structural layout
  return 0.50 * top12Avg + 0.30 * colorScore + 0.20 * structScore;
}

/**
 * Determines whether two photos belong to the same visual scene.
 * Pure visual comparison on pixels only (threshold: 0.58).
 */
export function arePhotosInSameScene(fp1, fp2, threshold = 0.58) {
  if (!fp1 || !fp2) return false;
  
  const score = computeSceneSimilarity(fp1, fp2);
  return score >= threshold;
}

/**
 * Generates a high-definition thumbnail data URL for retina displays and preview.
 */
export async function generateThumbnail(file, maxDimension = 1440) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.94));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };
    img.src = url;
  });
}
