import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

function align16(dim) {
  return Math.max(16, Math.floor(dim / 16) * 16);
}

export async function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    let blob;
    if (source instanceof Blob || source instanceof File) {
      blob = source;
    } else if (source instanceof Uint8Array || source?.data instanceof Uint8Array) {
      const data = source.data || source;
      blob = new Blob([data], { type: 'image/jpeg' });
    } else if (typeof source === 'string') {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = source;
      return;
    } else {
      return reject(new Error('Unsupported image source type'));
    }

    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/**
 * Checks and negotiates supported hardware encoder configurations.
 */
async function getSupportedEncoderConfig(width, height) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs VideoEncoder is not supported in this browser.');
  }

  const candidateConfigs = [
    // Try Main 4:4:4 10 (Format Range Extensions, Profile 4) for best color fidelity
    { codec: 'hev1.4.10.L120.B0', muxer: 'mp4', avcType: 'hevc' },
    { codec: 'hvc1.4.10.L120.B0', muxer: 'mp4', avcType: 'hevc' },
    
    // Fallback to Main 10 (Profile 2)
    { codec: 'hev1.2.4.L120.B0', muxer: 'mp4', avcType: 'hevc' },
    { codec: 'hvc1.2.4.L120.B0', muxer: 'mp4', avcType: 'hevc' },
    
    // Fallback to standard Main (Profile 1)
    { codec: 'hvc1.1.6.L120.90', muxer: 'mp4', avcType: 'hevc' },
    { codec: 'hev1.1.6.L120.90', muxer: 'mp4', avcType: 'hevc' },

    // Fallback to AVC/H.264 High Profile
    { codec: 'avc1.640028', muxer: 'mp4', avcType: 'avc' },
    { codec: 'avc1.4d002a', muxer: 'mp4', avcType: 'avc' },
    { codec: 'avc1.42e01f', muxer: 'mp4', avcType: 'avc' },

    // Fallback to VP9
    { codec: 'vp09.00.10.08', muxer: 'webm', avcType: 'vp9' }
  ];

  for (const cand of candidateConfigs) {
    const support = await VideoEncoder.isConfigSupported({
      codec: cand.codec,
      width,
      height,
      bitrate: 60_000_000,
      framerate: 1
    });
    if (support && support.supported) {
      return {
        config: support.config || { codec: cand.codec },
        muxerType: cand.muxer,
        codecFamily: cand.avcType
      };
    }
  }

  throw new Error(`No supported video encoder configuration found for resolution ${width}x${height}`);
}

/**
 * Encodes an array of images into an inter-frame container with hardware acceleration and full fidelity.
 */
export async function encodeImagesToVideo(images, onProgress) {
  if (!images || images.length === 0) {
    throw new Error('No images provided for container encoding');
  }

  const firstImg = await loadImageElement(images[0]);
  let rawW = firstImg.naturalWidth || firstImg.width || 1920;
  let rawH = firstImg.naturalHeight || firstImg.height || 1080;

  const width = align16(rawW);
  const height = align16(rawH);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const { config: encoderConfig, muxerType, codecFamily } = await getSupportedEncoderConfig(width, height);
  console.log(`[videoEncoder] 🚀 Initializing encoder for ${images.length} frames (${width}x${height}, codec: ${encoderConfig.codec}, muxer: ${muxerType})`);

  let muxer;
  let target;

  if (muxerType === 'webm') {
    target = new WebmTarget();
    muxer = new WebmMuxer({
      target,
      video: {
        codec: 'V_VP9',
        width,
        height
      }
    });
  } else {
    target = new Mp4Target();
    muxer = new Mp4Muxer({
      target,
      video: {
        codec: codecFamily === 'hevc' ? 'hevc' : 'avc',
        width,
        height
      },
      fastStart: 'in-memory'
    });
  }

  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => {
      console.error('[videoEncoder] ❌ VideoEncoder error:', e);
      encodeError = e;
    }
  });

  const encoderParams = {
    ...encoderConfig,
    width,
    height,
    bitrate: 60_000_000,
    framerate: 1,
    latencyMode: 'quality'
  };

  encoder.configure(encoderParams);

  for (let i = 0; i < images.length; i++) {
    if (encodeError) throw encodeError;

    if (onProgress) {
      onProgress(i + 1, images.length);
    }

    const img = i === 0 ? firstImg : await loadImageElement(images[i]);

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const imgAspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
    const canvasAspect = width / height;
    let renderW = width;
    let renderH = height;
    let renderX = 0;
    let renderY = 0;

    if (imgAspect > canvasAspect) {
      renderH = width / imgAspect;
      renderY = (height - renderH) / 2;
    } else {
      renderW = height * imgAspect;
      renderX = (width - renderW) / 2;
    }

    ctx.drawImage(img, renderX, renderY, renderW, renderH);

    const timestampMicros = i * 1_000_000;
    const frame = new VideoFrame(canvas, {
      timestamp: timestampMicros,
      duration: 1_000_000
    });

    encoder.encode(frame, { 
      keyFrame: true, // Ensure each photo frame is an independently seekable lossless keyframe
      quantizer: 0
    });
    frame.close();
  }

  await encoder.flush();

  encoder.close();
  muxer.finalize();

  const buffer = target.buffer;
  console.log(`[videoEncoder] 🏁 Finalized video container: ${images.length} frames (${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB, ${muxerType})`);

  return {
    blob: new Uint8Array(buffer),
    width,
    height,
    frameCount: images.length,
    mimeType: muxerType === 'webm' ? 'video/webm' : 'video/mp4'
  };
}

/**
 * Extracts a single photo frame from a container in 100% full fidelity PNG.
 */
export async function extractSingleFrame(videoBlobData, targetTimestampSec = 0.5) {
  return new Promise((resolve, reject) => {
    // Detect MIME type from magic bytes
    let mimeType = 'video/mp4';
    if (videoBlobData instanceof Uint8Array || videoBlobData instanceof ArrayBuffer) {
      const bytes = new Uint8Array(videoBlobData);
      if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
        mimeType = 'video/webm';
      }
    } else if (videoBlobData instanceof Blob && videoBlobData.type) {
      mimeType = videoBlobData.type;
    }

    const rawBlob = videoBlobData instanceof Blob ? videoBlobData : new Blob([videoBlobData], { type: mimeType });
    const url = URL.createObjectURL(rawBlob);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    let isDone = false;
    const cleanup = () => {
      if (isDone) return;
      isDone = true;
      URL.revokeObjectURL(url);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    };

    const performExtraction = () => {
      if (isDone) return;
      try {
        const width = video.videoWidth || 1920;
        const height = video.videoHeight || 1080;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/png');
        console.log(`[videoEncoder] 🖼️ Extracted frame at ${video.currentTime.toFixed(2)}s (${width}x${height})`);
        cleanup();
        resolve(dataUrl);
      } catch (err) {
        console.error('[videoEncoder] ❌ Error extracting single frame:', err);
        cleanup();
        reject(err);
      }
    };

    let seekInitiated = false;
    const startSeek = () => {
      if (seekInitiated) return;
      seekInitiated = true;
      const dur = video.duration || 1.0;
      const safeTime = Math.min(Math.max(0.02, targetTimestampSec), Math.max(0.02, dur - 0.05));
      video.currentTime = safeTime;
    };

    video.addEventListener('loadedmetadata', startSeek, { once: true });
    video.addEventListener('loadeddata', startSeek, { once: true });

    video.addEventListener('seeked', () => {
      performExtraction();
    }, { once: true });

    video.addEventListener('error', (e) => {
      cleanup();
      const msg = video.error ? `${video.error.message} (code ${video.error.code})` : String(e);
      console.error('[videoEncoder] ❌ Video decode error:', msg);
      reject(new Error(`Video decode error during single frame extraction: ${msg}`));
    }, { once: true });

    video.src = url;
    video.load();
  });
}

/**
 * Extracts all frames from a container in full fidelity.
 */
export async function extractAllFramesFromVideo(videoBlobData, maxExpectedFrames = 30) {
  return new Promise((resolve, reject) => {
    let mimeType = 'video/mp4';
    if (videoBlobData instanceof Uint8Array || videoBlobData instanceof ArrayBuffer) {
      const bytes = new Uint8Array(videoBlobData);
      if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
        mimeType = 'video/webm';
      }
    } else if (videoBlobData instanceof Blob && videoBlobData.type) {
      mimeType = videoBlobData.type;
    }

    const rawBlob = videoBlobData instanceof Blob ? videoBlobData : new Blob([videoBlobData], { type: mimeType });
    const url = URL.createObjectURL(rawBlob);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const frames = [];
    let currentIndex = 0;
    let isDone = false;

    const cleanup = () => {
      if (isDone) return;
      isDone = true;
      URL.revokeObjectURL(url);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    };

    const captureCurrentFrame = () => {
      if (isDone) return;
      try {
        const width = video.videoWidth || 1920;
        const height = video.videoHeight || 1080;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/png');
        frames.push({
          frameIndex: currentIndex,
          timestamp: video.currentTime,
          dataUrl
        });

        currentIndex++;
        if (currentIndex >= maxExpectedFrames) {
          console.log(`[videoEncoder] ✅ Successfully extracted all ${frames.length} frames`);
          cleanup();
          return resolve(frames);
        }

        seekNext();
      } catch (err) {
        console.error('[videoEncoder] ❌ Error during frame capture:', err);
        cleanup();
        reject(err);
      }
    };

    const seekNext = () => {
      if (currentIndex >= maxExpectedFrames) {
        cleanup();
        return resolve(frames);
      }

      const dur = Math.max(0.1, video.duration || maxExpectedFrames);
      const targetTime = currentIndex * 1.0 + 0.5;
      const safeTime = Math.min(Math.max(0.02, targetTime), Math.max(0.02, dur - 0.05));
      video.currentTime = safeTime;
    };

    video.addEventListener('loadedmetadata', () => {
      const dur = Math.max(0.1, video.duration || maxExpectedFrames);
      console.log(`[videoEncoder] 🎞️ Extracting ${maxExpectedFrames} frames from container (duration: ${dur.toFixed(2)}s)`);
      seekNext();
    }, { once: true });

    video.addEventListener('seeked', () => {
      captureCurrentFrame();
    });

    video.addEventListener('error', (e) => {
      cleanup();
      const msg = video.error ? `${video.error.message} (code ${video.error.code})` : String(e);
      console.error('[videoEncoder] ❌ Video error during bulk extraction:', msg);
      reject(new Error(`Video error during bulk frame extraction: ${msg}`));
    }, { once: true });

    video.src = url;
    video.load();
  });
}
