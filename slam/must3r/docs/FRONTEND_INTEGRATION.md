# MUSt3R Frontend Integration

This document describes the integration surfaces currently provided by this repository.

## Integration choices

There are three useful ways to connect a custom frontend:

1. **Recommended: backend job + exported files**
   Run `slam.py` from a backend worker, then expose `all_poses.npz`, `memory.pkl`, and optional rendered assets through your own HTTP API.

2. **Python service API**
   Import `must3r.model.load_model`, `must3r.demo.inference.must3r_inference_video`, or the lower-level inference functions from a Python service.

3. **Live 3D viewer**
   Create `must3r.demo.viser.ViserWrapper` and embed the Viser URL in your frontend. Viser owns its browser communication protocol; MUSt3R sends scene updates through the Viser Python client API.

There is currently no first-party REST API, GraphQL API, or documented raw JSON WebSocket protocol in this repository. The Gradio app is a demo UI, not a stable frontend contract.

## Model loading

```python
from must3r.model import load_model

model = load_model(
    chkpt_path="checkpoints/MUSt3R_512.pth",
    device="cuda:0",
    img_size=512,
    memory_mode=None,
    verbose=True,
)
# model is a tuple: (encoder, decoder)
```

Important arguments:

- `chkpt_path`: local MUSt3R checkpoint.
- `device`: `cuda:0` for GPU or `cpu`.
- `img_size`: `224` or `512`, matching the checkpoint.
- `memory_mode`: optional decoder memory mode: `norm_y`, `kv`, or `raw`.

For the RTX 5050 setup used here, the recommended runtime is CUDA plus BF16 autocast:

```python
import torch

dtype = torch.bfloat16
with torch.autocast("cuda", dtype=dtype):
    # call inference here
    pass
```

## High-level Python inference

### Video/sequence SLAM inference

```python
from must3r.demo.inference import must3r_inference_video

scene = must3r_inference_video(
    model=model,
    device="cuda:0",
    image_size=512,
    amp="bf16",
    filelist=["frames/frame_000001.jpg", "frames/frame_000002.jpg"],
    max_bs=1,
    init_num_images=2,
    batch_num_views=1,
    local_context_size=25,
    is_keyframe_function=lambda frame_id, result, state: frame_id % 5 == 0,
    scene_state=None,
    scene_state_update_function=lambda result, state: state,
    viser_server=None,
    num_refinements_iterations=0,
    verbose=True,
)
```

`scene` is a `SceneState` with:

- `scene.x_out`: list of per-frame prediction dictionaries.
- `scene.imgs`: RGB tensors prepared for visualization.
- `scene.true_shape`: original resized image shapes.
- `scene.focals`: per-frame focal lengths.
- `scene.cams2world`: per-frame camera-to-world 4x4 matrices.
- `scene.image_list`: frame paths in the processed order.

Typical keys in each `scene.x_out[i]` prediction are:

- `pts3d`: global 3D point map, tensor shaped approximately `[H, W, 3]`.
- `pts3d_local`: camera-local 3D point map, tensor shaped approximately `[H, W, 3]`.
- `conf`: per-pixel confidence map, approximately `[H, W]`.
- `c2w`: camera-to-world 4x4 transform.
- `focal`: estimated focal value.

Treat tensor shapes as runtime values because aspect ratio and patch resizing can change them. Convert tensors before sending them to a browser:

```python
points = prediction["pts3d"].detach().cpu().numpy().astype("float32")
confidence = prediction["conf"].detach().cpu().numpy().astype("float32")
pose = prediction["c2w"].detach().cpu().numpy().astype("float32")
```

### General sequence inference

`must3r_inference(...)` is used for ordered or retrieval-based image collections. Its important arguments are:

- `filelist`: ordered image paths.
- `num_mem_images`: number of memory/keyframe images.
- `max_bs`: maximum inference batch size; `0` means automatic/unlimited in the wrapper.
- `render_once`: render non-memory frames once.
- `is_sequence`: ordered sequence mode. Set false when using retrieval.
- `retrieval`: retrieval checkpoint is passed to the wrapper, not this function directly.

Use `must3r_inference_video` for a camera/video sequence and `must3r_inference` for a fixed image collection.

## Native SLAM command API

The most stable existing backend interface is `slam.py`:

```powershell
python slam.py `
  --chkpt checkpoints/MUSt3R_512.pth `
  --device cuda:0 `
  --input "path/to/video.mp4" `
  --output outputs/run-001 `
  --res 512 `
  --skip_every 1 `
  --subsamp 4 `
  --rerender `
  --rerender_bs 16 `
  --varying_focals
```

Input options:

- `--input`: one or more video paths, image directories, or `cam:0` webcam sources.
- `--res`: `224` or `512`.
- `--skip_every`: process every Nth input frame.
- `--subsamp`: keyframe point subsampling; `4` is a practical 512px starting value.
- `--rerender`: regenerate all frames from the final memory after tracking.
- `--rerender_bs`: rerender batch size; reduce if VRAM is exhausted.
- `--varying_focals`: allow changing focal length.
- `--pointcloud_conf`: confidence threshold for the exported keyframe PLY; default `1.0`.
- `--gui`: use the Open3D GUI instead of headless export.
- `--output`: required for headless export.

The command writes:

- `all_poses.npz`: trajectory and confidence data.
- `memory.pkl`: Python/Pickle memory state for MUSt3R continuation.
- `pointcloud.ply`: binary colored keyframe point cloud, filtered by `--pointcloud_conf`.

### `all_poses.npz` schema

```python
import numpy as np

result = np.load("outputs/run-001/all_poses.npz", allow_pickle=True)
poses = result["poses"]       # [N, 4, 4], camera-to-world transforms
timestamps = result["timestamps"]
confs = result["confs"]
focal = result["focal"]        # usually a dict-like object for camera agents
```

The pose translation is `poses[:, :3, 3]`. The rotation is `poses[:, :3, :3]`.
MUSt3R uses camera-to-world matrices. Confirm the coordinate convention in your renderer by displaying the first pose and a known test scene before applying an engine-specific axis conversion.

`memory.pkl` is an internal Python pickle, not a browser format. Do not expose it directly to untrusted clients. Use it only on a trusted backend, or convert the required keyframe data to a versioned JSON/binary schema first.

## Viser live protocol

`must3r.demo.viser.ViserWrapper` starts a Viser server:

```python
from must3r.demo.viser import ViserWrapper

viser = ViserWrapper(host="127.0.0.1", port=8080)
```

The browser URL is:

```text
http://127.0.0.1:8080
```

MUSt3R uses these Viser scene paths:

```text
/frames/t{frame_id}/point_cloud
/frames/t{frame_id}/frustum
```

The wrapper creates these interactive controls:

- `Point size`
- `Camera size`
- `Confidence`
- `Max Points`
- `Local pointmaps`
- `Follow Cam`
- `Keyframes Only`
- `Hide Images`
- `Hide Predictions`
- `RGB`, `Depth`, and `Confidence` images
- A progress bar

The wrapper's main update method is:

```python
viser.set_views(frame_ids, rgbs, pointmaps, is_keyframe=None)
```

Each `pointmaps` item must provide tensors for:

- `pts3d`: `[H, W, 3]`
- `pts3d_local`: `[H, W, 3]`
- `conf`: `[H, W]`
- `c2w`: `[4, 4]`
- `focal`: scalar

`rgbs` contains normalized image tensors in the model's image format. The wrapper unnormalizes them before sending them to Viser.

To send a completion notification:

```python
viser.send_message("Finished")
```

### Using Viser in your own frontend

Preferred options:

- Embed the Viser URL in an iframe for the complete built-in 3D viewer.
- Use Viser's supported browser/client package if you need to control scene nodes from JavaScript.
- Keep MUSt3R and Viser behind your backend when the viewer should not be publicly reachable.

Do not build a raw WebSocket client against undocumented Viser message frames. Viser owns that protocol and may change its serialized messages across versions. Use its client library or iframe integration.

## Gradio demo communication

The Gradio demo is started by `demo.py` and exposes a browser UI, normally on a local URL such as `http://127.0.0.1:7860`.

Relevant CLI options:

```text
--weights PATH
--retrieval PATH
--image_size 224|512
--device cuda|cpu
--amp False|bf16|fp16
--viser
--embed_viser
--allow_local_files
--server_port PORT
```

The demo accepts image files or a local image directory. It does not accept an MP4 directly in the upload control; extract frames first or call native `slam.py` with `--input video.mp4`.

Gradio's generated request/event protocol is version-dependent. For a custom frontend, do not depend on the generated component IDs. Call your own backend wrapper instead, or use the Python APIs above.

## Recommended custom backend API

Wrap the native command or Python functions in your own versioned service. A useful contract is:

```text
POST /api/v1/jobs
Content-Type: multipart/form-data

video=<file>
resolution=512
skip_every=1
subsamp=4
rerender=true
varying_focals=true
```

Return:

```json
{
  "job_id": "run-001",
  "status": "queued"
}
```

Expose progress:

```text
GET /api/v1/jobs/run-001
```

```json
{
  "job_id": "run-001",
  "status": "running",
  "processed_frames": 456,
  "total_frames": 5895,
  "progress": 0.0773
}
```

Expose results:

```text
GET /api/v1/jobs/run-001/result
```

```json
{
  "job_id": "run-001",
  "status": "completed",
  "poses_url": "/api/v1/jobs/run-001/poses",
  "pointcloud_url": "/api/v1/jobs/run-001/pointcloud.ply",
  "memory_url": "/api/v1/jobs/run-001/memory.pkl",
  "viser_url": "http://127.0.0.1:8080"
}
```

For browser rendering, prefer converting results server-side into one of:

- `glb` for a complete scene.
- `ply` for point clouds.
- JSON or MessagePack for poses and per-frame metadata.
- JPEG/PNG/WebP or tiled depth textures for RGB/depth/confidence previews.

Example pose response:

```json
{
  "frame": 42,
  "timestamp": 42,
  "pose": [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1]
  ],
  "focal": 612.4,
  "confidence_mean": 4.18
}
```

## Streaming options

For live progress, use one of these protocols in your own backend:

- **Server-Sent Events**: simple one-way progress updates.
- **WebSocket**: progress plus interactive commands such as pause/cancel.
- **Polling**: simplest implementation; poll `/api/v1/jobs/{id}`.

MUSt3R itself does not define these job endpoints. They are recommended application-level endpoints around the Python worker.

## Security and deployment

- Bind Viser and Gradio to `127.0.0.1` by default.
- Do not expose `memory.pkl` to users; Pickle can execute code when loaded.
- Validate uploaded video size, duration, codec, and frame count.
- Run inference in a worker process with a job timeout and cancellation policy.
- Store results outside the source repository and return opaque job IDs.
- Convert tensors to bounded float32 arrays before serialization.
- Downsample or tile point clouds before sending large scenes to browsers.
- Add CORS and authentication only in your backend; MUSt3R does not provide them.

## Current limitations

- No official stable REST/GraphQL API.
- No stable raw Viser WebSocket schema.
- `memory.pkl` is an internal Python state file.
- Gradio event payloads depend on the installed Gradio version.
- The optional CUDA RoPE2D extension may be unavailable; the PyTorch fallback still works but is slower.
