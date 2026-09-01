# PhotoVault: Complete System Specification (SPEC)

## 1. High-Level Vision & Objectives
PhotoVault is a 100% private, client-side, hardware-accelerated photo library application that stores and synchronizes media directly with the user's personal Google Drive.

Key goals:
1. **Zero-Knowledge Client-Side Architecture:** Zero middleman servers or third-party storage. All compression, hashing, visual clustering, and cloud synchronization run purely in the user's browser.
2. **WebCodecs Hardware Intra-Keyframe Compression:** Group related photos into hardware-accelerated video containers (HEVC / H.264 / VP9) to achieve up to 90%+ storage savings while preserving original resolution and visual fidelity.
3. **Pure Visual Scene Clustering:** Use computer vision algorithms on raw pixel data (4x4 spatial luminance/gradient blocks, 32-bin HSV color histograms, 64-bit gradient dHash) to automatically cluster burst shots and visually similar photos without relying on metadata or filenames.
4. **Direct Google Drive Sync (API v3):** Direct client-side RFC 2387 `multipart/related` uploads into a dedicated `Photo Vault` folder with mutex concurrency controls and container manifests.
5. **Instant Random-Access Extraction:** On-demand loss-free single-frame extraction for inspection and downloading, ensuring format integrity (JPEG headers for JPEG files, PNG headers for PNG files).
6. **Robust Concurrency Pipeline:** Event-driven multi-stage queue (`TaskQueue` & `VaultQueue`) with dedicated worker concurrency pools, zero polling loops, and zero artificial timeout masking.

---

## 2. System Architecture & Components

```
+-------------------------------------------------------------------------------+
|                                  PhotoVault UI                                |
|  - Storage Savings Dashboard (Original vs Compressed vs Savings %)            |
|  - Google Drive Connect & OAuth2 Profile Integration                          |
|  - Reactive Photo Grid with Drag-and-Drop & Skeletons                         |
|  - High-Resolution Photo Inspector & Lossless Original Exporter               |
+---------------------------------------+---------------------------------------+
                                        |
+---------------------------------------v---------------------------------------+
|                    VaultQueue (Coordinator & Pipeline)                        |
|                                                                               |
|  [ Stage 1: ANALYZE_PHOTO (Concurrency: 4) ]                                  |
|    - SHA-256 Byte Hash (Deduplication)                                       |
|    - 4x4 Spatial Block Grid + 32-Bin HSV Histogram + 64-bit dHash             |
|    - HD Retina Thumbnail Data URL (1440px)                                    |
|                                                                               |
|  [ Stage 2: VISUAL CLUSTERING & ROUTING ]                                     |
|    - Continuous Cosine & Spatial Similarity Matching (Threshold: 0.72)        |
|    - In-Memory Cluster Buffers (Threshold: 10 items / 25MB)                   |
|                                                                               |
|  [ Stage 3: ENCODE_CONTAINER (Concurrency: 1) ]                               |
|    - WebCodecs Hardware VideoEncoder + mp4-muxer / webm-muxer                 |
|    - Lossless Intra-Keyframes (Level 6.2/6.0 for up to 8K/35MP DSLR photos)   |
|                                                                               |
|  [ Stage 4: UPLOAD_CONTAINER (Concurrency: 2) ]                               |
|    - RFC 2387 Multipart/Related Uploads to Google Drive v3                   |
|    - Manifest Metadata Injection (appProperties)                              |
+---------------------------------------+---------------------------------------+
            |                                               |
+-----------v-----------+                       +-----------v-----------+
|   IndexedDB (idb)     |                       |   Google Drive API    |
| - 'photos' Store      |                       | - 'Photo Vault' Dir   |
| - 'videos' Store      |                       | - Video Containers    |
| - 'sync_meta' Store   |                       | - Manifest Metadata   |
+-----------------------+                       +-----------------------+
```

---

## 3. Subsystem Detailed Specifications

### A. Computer Vision & Scene Clustering (`phash.js`)
1. **SHA-256 Exact Byte Deduplication:**
   - Hash raw image bytes with Web Crypto API (`crypto.subtle.digest('SHA-256', buffer)`).
   - Skip duplicate uploads immediately before any encoding.
2. **Visual Feature Extraction:**
   - **Normalized 64x64 Canvas:** Scale and center-crop image into a 64x64 working buffer.
   - **Spatial 4x4 Block Grid (16 sub-regions):** Each 16x16 block stores average luminance, horizontal gradient, and vertical gradient.
   - **32-Bin HSV Ambient Color Histogram:** 16 Hue bins, 8 Saturation bins, 8 Value bins to measure lighting and color temperature.
   - **64-Bit Global Gradient dHash:** Adjacent pixel luminance comparisons.
3. **Similarity Metric & Grouping:**
   - Score: `0.50 * top12_spatial_avg + 0.30 * color_score + 0.20 * struct_score`.
   - Threshold `0.72` clusters burst shots and same-scene photos into the same video container.

### B. Hardware Video Compression Container Engine (`videoEncoder.js`)
1. **WebCodecs Hardware Encoding:**
   - Align image dimensions to multiples of 16 (`align16`).
   - Negotiate supported codec profile:
     - HEVC Main Profile Level 6.2/6.0/5.1 (`hvc1.1.6.L186.B0`, `hev1.1.6.L186.B0`, `hvc1.1.6.L153.B0`, `hvc1.1.6.L120.90`) via `mp4-muxer`.
     - AVC/H.264 High Profile (`avc1.640034`, `avc1.640028`, `avc1.4d002a`) via `mp4-muxer`.
     - VP9 Profile 0 (`vp09.00.10.08`) via `webm-muxer`.
   - Each frame is encoded as an intra-keyframe (`keyFrame: true`, `quantizer: 0`, `bitrate: 60Mbps`, duration: 1.0s).
2. **Lossless Frame Extraction:**
   - Extract single or all frames from off-screen `<video>` on native `seeked` / `canplay` events.
   - Dynamic target MIME export (`image/jpeg` with 0.98 quality for JPEGs, `image/png` for PNGs).

### C. Concurrency Task Queue (`TaskQueue.js` & `VaultQueue.js`)
1. **Event-Driven Architecture:**
   - Supports task prioritization, configurable concurrency limits per worker type, and lifecycle events (`task:enqueued`, `task:started`, `task:completed`, `task:error`, `idle`).
2. **Lifecycle Synchronization:**
   - `waitUntilTypeIdle(taskType)` and `waitUntilIdle()` resolve based on event emissions without polling or timeouts.
3. **Multi-Stage Coordination:**
   - `ANALYZE_PHOTO` (Concurrency 4) -> Clustering -> `ENCODE_CONTAINER` (Concurrency 1) -> `UPLOAD_CONTAINER` (Concurrency 2).

### D. Google Drive Cloud Synchronization (`googleDrive.js`)
1. **Authentication:**
   - Client-side Google Identity Services (GIS) OAuth2 token client.
   - Scopes: `https://www.googleapis.com/auth/drive.file`, `userinfo.profile`, `userinfo.email`.
2. **Concurrency Mutex:**
   - Mutex lock guarantees that only one request creates the `Photo Vault` folder.
3. **RFC 2387 Multipart Uploads:**
   - Single-request upload with boundary containing metadata (`application/json; charset=UTF-8`) and binary video container (`video/mp4` or `video/webm`).
   - Manifest metadata stored in `appProperties`.
4. **Cloud Import & JIT Video Fetching:**
   - Scans container manifests from Google Drive on connect and populates local database without fetching entire video binaries until inspection or download.

### E. Local Storage Architecture (`db.js`)
- IndexedDB database `PhotoVaultDB` (version 2):
  - `photos`: key `id` (autoIncrement), indexes: `contentHash`, `videoId`, `createdAt`.
  - `videos`: key `id` (groupId).
  - `sync_meta`: key `key`.

### F. User Interface & Experience
- **Header:** Storage metrics (Original size, Compressed size, Space saved percentage), Google Drive user profile badge / connect button, live upload progress indicator.
- **Photo Grid:** Drag-and-drop file/folder uploader, skeleton loaders during analysis/encoding, photo cards with download button, and visual scene indicators.
- **Photo Inspector:** Full-screen modal, high-resolution canvas extraction, frame navigation, metadata view, and direct download.
- **Error Banner:** Global error alert banner that surfaces non-swallowed exceptions directly to the user.

---

## 4. Design & Architecture Pitfalls (Lessons Learned & Invariants)

### ⚠️ Pitfall 1: WebKit / Safari Blob URL Lifecycle (`WebKitBlobResource error 1`)
- **Issue:** Revoking an object URL (`URL.revokeObjectURL(url)`) while a `<video>` or `<img>` element still has its `src` bound to that URL causes WebKit to cancel the underlying media stream immediately and throw `WebKitBlobResource error 1`.
- **Solution:** Clean up media elements properly by clearing the `src` attribute, calling `video.load()`, removing the element from memory, and only then revoking the object URL. Avoid transient Blob URLs in optimistic UI skeleton states.

### ⚠️ Pitfall 2: WebCodecs Codec Profile & Resolution Caps
- **Issue:** Passing low-level codec identifiers like HEVC Level 4.0 (`hvc1.1.6.L120.90`) caps the maximum picture size at ~2.2MP (1080p). Feeding high-resolution 24MP+ DSLR photos (e.g. 6016x4000) causes hardware decoder failure, leading to pitch-black extracted frames.
- **Solution:** Specify Level 6.2/6.0 profile strings (`hvc1.1.6.L186.B0` / `hev1.1.6.L186.B0`) which support resolutions up to 8K / 35.6MP.
- **Issue:** Safari’s `VideoEncoder` advertises support for HEVC Profile 4 (`hev1.4.10.L120.B0`), but Safari's `<video>` tag AVFoundation decoder fails to render it.
- **Solution:** Use standard HEVC Main Profile (`hvc1.1.6.L186.B0` / `hev1.1.6.L186.B0`) and Main 10 (`hvc1.2.4.L120.B0`), which decode reliably across all Apple platforms.

### ⚠️ Pitfall 3: Off-Screen Video Seeking & Canvas Extraction Timing
- **Issue:** In headless/off-screen `<video>` elements, setting `video.currentTime = safeTime` without verifying readyState (`video.readyState >= 2`) or relying on `requestVideoFrameCallback` (which only works when connected to the visible DOM compositor) causes `ctx.drawImage` to paint an unpopulated/black surface.
- **Solution:** Listen directly to the native `seeked` and `canplay` / `loadeddata` events, ensuring `video.readyState >= 2` before invoking `ctx.drawImage`.

### ⚠️ Pitfall 4: MIME Header & Extension Mismatch on Download
- **Issue:** Exporting `canvas.toDataURL('image/png')` and saving the resulting binary with a `.jpg` or `.jpeg` file extension creates a corrupt JPEG file starting with PNG magic bytes (`89 50 4E 47`), which OS image viewers (macOS Preview, Windows Photos) reject.
- **Solution:** Inspect the original file extension/MIME type and dynamically call `canvas.toDataURL('image/jpeg', 0.98)` for JPEGs and `canvas.toDataURL('image/png')` for PNGs.

### ⚠️ Pitfall 5: Google Drive Concurrent Folder Creation Race Conditions
- **Issue:** Multiple upload workers running simultaneously can query for the `Photo Vault` root folder at the same instant, conclude it doesn't exist, and create duplicate `Photo Vault` folders in Google Drive.
- **Solution:** Enforce a concurrency mutex / async lock around folder creation and lookup routines.

### ⚠️ Pitfall 6: Artificial Timeouts & Silent Error Masking
- **Issue:** Wrapping async operations in arbitrary `setTimeout` delays (e.g. `Promise.race([..., setTimeout(6000)])`) masks performance issues, causes non-deterministic race conditions on slow machines, and swallows underlying exceptions.
- **Solution:** Maintain a strict **Hard-Failing Fail-Fast Principle**. All async operations must be driven purely by native events and promises. Zero empty catch blocks (`try { ... } catch {}`), and all errors must propagate directly to the user-facing error banner.

---

## 5. Engineering Invariants & Rules
1. **Hard-Failing Fail-Fast Principle:** Throw and reject on all failures with clear messages.
2. **Zero Artificial Delays / Timeouts:** No `setTimeout` or `setInterval` to mask latency.
3. **MIME Type & Header Integrity:** Exported files must match their extensions with valid headers (`FF D8 FF` for JPEG, `89 50 4E 47` for PNG).
4. **Clean Workspace Policy:** Never leave temporary test artifacts or screenshots in source directories.
