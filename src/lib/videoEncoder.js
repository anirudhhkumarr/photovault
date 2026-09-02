import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

// Align to 16 for hardware encoders
function align16(val) {
  return Math.floor(val / 16) * 16;
}

export async function checkCodecSupport() {
  const hevcCodec = 'hvc1.1.6.L186.B0'; // HEVC Main Profile Level 6.2
  const vp9Codec = 'vp09.00.10.08';    // VP9 Profile 0

  const hevcSupport = await VideoEncoder.isConfigSupported({
    codec: hevcCodec, width: 1920, height: 1080
  });
  
  if (hevcSupport.supported) {
    return { codec: hevcCodec, type: 'mp4' };
  }
  
  const vp9Support = await VideoEncoder.isConfigSupported({
    codec: vp9Codec, width: 1920, height: 1080
  });

  if (vp9Support.supported) {
    return { codec: vp9Codec, type: 'webm' };
  }
  
  throw new Error('No supported hardware codec found (HEVC/VP9)');
}

export async function encodeContainer(items) {
  if (!items || items.length === 0) throw new Error("No items to encode");

  const support = await checkCodecSupport();
  
  // Base dimensions on the first item, aligned to 16
  const width = align16(items[0].width);
  const height = align16(items[0].height);
  
  const MuxerClass = support.type === 'mp4' ? Mp4Muxer : WebmMuxer;
  const TargetClass = support.type === 'mp4' ? Mp4Target : WebmTarget;

  const target = new TargetClass();
  const muxer = new MuxerClass({
    target,
    video: {
      codec: support.type === 'mp4' ? 'hevc' : 'V_VP9',
      width,
      height
    },
    fastStart: support.type === 'mp4' ? 'in-memory' : undefined,
    firstTimestampBehavior: 'offset'
  });

  const init = {
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; }
  };

  const config = {
    codec: support.codec,
    width,
    height,
    bitrate: 60000000,
    framerate: 1,
    // HEVC / WebCodecs might ignore quantizer, but per spec:
  };

  const encoder = new VideoEncoder(init);
  encoder.configure(config);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const bitmap = await createImageBitmap(item.file);
    
    // Scale and crop to align16 dimensions if necessary
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const frame = new VideoFrame(canvas, { timestamp: i * 1000000 }); // 1.0s = 1000000us
    
    encoder.encode(frame, { keyFrame: true });
    frame.close();
    bitmap.close();
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const buffer = target.buffer;
  const mime = support.type === 'mp4' ? 'video/mp4' : 'video/webm';
  const blob = new Blob([buffer], { type: mime });

  return {
    blob,
    width,
    height,
    duration: items.length,
    codec: support.codec,
    manifest: {
      v: 1,
      c: support.type.toUpperCase(),
      p: items.map((it, idx) => ({
        h: it.hash,
        w: it.width,
        ht: it.height,
        i: idx,
        m: it.mimeType,
        n: it.originalName,
        s: it.originalSize
      }))
    }
  };
}

// Extract single frame losslessly
export function extractFrame(videoBlob, frameIndex, mimeType) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(videoBlob);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    
    const safeTime = frameIndex + 0.5; // center of the frame duration
    
    // Append to DOM (required for Safari to reliably process Blob URLs)
    video.style.display = 'none';
    document.body.appendChild(video);
    
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.src = '';
      video.load();
      if (document.body.contains(video)) {
        document.body.removeChild(video);
      }
      URL.revokeObjectURL(url);
    };

    const onError = (err) => {
      cleanup();
      reject(new Error("Video extraction failed: " + (video.error ? video.error.message : err)));
    };
    
    const onSeeked = () => {
      if (video.readyState < 2) {
        // Wait for data
        const onCanPlay = () => {
          video.removeEventListener('canplay', onCanPlay);
          video.removeEventListener('loadeddata', onCanPlay);
          doExtract();
        };
        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('loadeddata', onCanPlay);
        return;
      }
      doExtract();
    };

    const doExtract = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        let dataUrl;
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
          dataUrl = canvas.toDataURL('image/jpeg', 0.98);
        } else {
          dataUrl = canvas.toDataURL('image/png');
        }
        
        cleanup();
        resolve(dataUrl);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = safeTime;
    });
  });
}
