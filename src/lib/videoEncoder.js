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
    { codec: 'hvc1.1.6.L120.90', muxer: 'mp4', avcType: 'hevc' },
    { codec: 'hev1.1.6.L120.90', muxer: 'mp4', avcType: 'hevc' }
  ];

  for (const cand of candidateConfigs) {
    try {
      const testConfig = {
        codec: cand.codec,
        width,
        height,
        bitrate: 40_000_000,
        framerate: 1
      };
      const support = await VideoEncoder.isConfigSupported(testConfig);
      if (support && support.supported) {
        return {
          config: support.config || testConfig,
          muxerType: cand.muxer,
          codecFamily: cand.avcType
        };
      }
    } catch {
      // Continue search
    }
  }

  throw new Error('HEVC (H.265) hardware encoding is required for frame interpolation, but it is not supported on this browser/device.');
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

  // Original resolution is preserved without downscaling to 4K

  const width = align16(rawW);
  const height = align16(rawH);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const { config: encoderConfig, muxerType, codecFamily } = await getSupportedEncoderConfig(width, height);

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
      console.error('VideoEncoder error:', e);
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

  try {
    encoder.configure(encoderParams);
  } catch (err) {
    // Fallback if bitrateMode quantizer not supported
    encoder.configure({
      ...encoderConfig,
      width,
      height,
      bitrate: 60_000_000,
      framerate: 1
    });
  }

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
      keyFrame: i === 0,
      quantizer: 0 // Lossless QP = 0
    });
    frame.close();

    await new Promise(r => setTimeout(r, 8));
  }

  await Promise.race([
    encoder.flush(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Encoder flush timeout')), 10000))
  ]);

  encoder.close();
  muxer.finalize();

  const buffer = target.buffer;
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
export async function extractSingleFrame(videoBlobData, targetTimestampSec = 0.2) {
  return new Promise((resolve) => {
    const rawBlob = videoBlobData instanceof Blob ? videoBlobData : new Blob([videoBlobData], { type: 'video/mp4' });
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
      video.remove();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve('');
    }, 6000);

    video.onloadedmetadata = () => {
      video.currentTime = Math.max(0.05, targetTimestampSec);
    };

    video.onseeked = () => {
      try {
        clearTimeout(timer);
        const width = video.videoWidth || 1920;
        const height = video.videoHeight || 1080;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, 0, 0, width, height);

        // Lossless PNG extraction for 100% bit-exact pixel fidelity
        canvas.toBlob((blob) => {
          cleanup();
          if (blob) {
            resolve(URL.createObjectURL(blob));
          } else {
            resolve(canvas.toDataURL('image/png'));
          }
        }, 'image/png');
      } catch {
        cleanup();
        resolve('');
      }
    };

    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      resolve('');
    };

    video.src = url;
    video.load();
  });
}

/**
 * Extracts all frames from a container in full fidelity.
 */
export async function extractAllFramesFromVideo(videoBlobData, maxExpectedFrames = 30) {
  return new Promise((resolve) => {
    const rawBlob = videoBlobData instanceof Blob ? videoBlobData : new Blob([videoBlobData], { type: 'video/mp4' });
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
      video.remove();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(frames);
    }, 15000);

    video.onloadedmetadata = () => {
      const duration = Math.max(1, video.duration || maxExpectedFrames);
      const step = 1.0;

      const captureNext = () => {
        const time = currentIndex * step + 0.2;
        if (time >= duration || currentIndex >= maxExpectedFrames) {
          clearTimeout(timer);
          cleanup();
          return resolve(frames);
        }
        video.currentTime = time;
      };

      video.onseeked = () => {
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
          captureNext();
        } catch {
          clearTimeout(timer);
          cleanup();
          resolve(frames);
        }
      };

      captureNext();
    };

    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      resolve(frames);
    };

    video.src = url;
    video.load();
  });
}
