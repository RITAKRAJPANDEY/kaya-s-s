# MUSt3R Integration Guide

This guide is for an AI coding agent integrating this repository into an existing application that already has a backend, frontend, and dashboard.

The recommended integration is to keep MUSt3R as a backend reconstruction worker and expose a small application-owned API to the dashboard. Do not make the dashboard call internal Python modules, Gradio events, or undocumented Viser messages directly.

## What this repository provides

- `must3r.model.load_model`: loads a MUSt3R checkpoint and returns the encoder and decoder.
- `must3r.demo.inference`: high-level inference for ordered image collections and video-like sequences.
- `must3r_slam` / `slam.py`: command-line SLAM pipeline for image directories, videos, and webcams.
- `must3r.demo.viser.ViserWrapper`: optional live 3D viewer.
- Exported reconstruction files:
  - `all_poses.npz`: camera trajectory and related values.
  - `pointcloud.ply`: colored point cloud for standard 3D viewers.
  - `memory.pkl`: internal Python state for trusted backend continuation only.

This repository does **not** provide a stable REST API, GraphQL API, frontend component, or public JSON WebSocket protocol. The existing Gradio UI is a demo and should not be used as a long-term dashboard API contract.

## Integration decision

Use this flow unless the host application already has a strong reason to embed Python directly:

```text
Dashboard -> Host backend API -> Job queue/worker -> MUSt3R -> Versioned output files -> Dashboard
```

The host backend should own:

- Authentication and authorization.
- Upload handling and input validation.
- Job IDs, status, cancellation, and retry behavior.
- Per-job temporary directories.
- Artifact URLs or authenticated download endpoints.
- Conversion of NumPy and pickle data into application-owned formats.
- Cleanup and retention policies.

MUSt3R should own model loading, inference, camera tracking, and reconstruction generation.

## Copy-in checklist for an AI agent

1. Copy this repository into a dedicated backend directory such as `vendor/must3r/` or install it as a package from the repository root.
2. Do not copy the bundled virtual environment, build directories, `*.egg-info`, `.crdownload` files, checkpoints, or generated `outputs/` into production source control.
3. Confirm that the host backend uses Python 3.11 or newer.
4. Install the dependencies from `requirements.txt` and the dependency requirements in the root `README.md`. The package also declares dependencies in `setup.py`.
5. Install a PyTorch build matching the machine's CUDA version, or explicitly configure CPU mode for development.
6. Download a compatible checkpoint into a data or model directory outside the source tree. Use `MUSt3R_512.pth` for normal quality, or `MUSt3R_224_cvpr.pth` for lower memory usage.
7. Keep model loading in a long-lived worker process. Do not load a checkpoint once per HTTP request.
8. Create a per-job working directory. Never let a user choose an arbitrary output path.
9. Add an adapter in the host application rather than modifying MUSt3R internals first.
10. Add a smoke test using two or more valid images before wiring the full dashboard.
11. Verify the MUSt3R Non-Commercial License, dataset restrictions, and checkpoint terms in `LICENSE` and `NOTICE` before shipping a commercial feature.

## Suggested host application layout

The names can be adapted to the host project, but keep the responsibilities separate:

```text
backend/
  integrations/must3r/
    config.py          # checkpoint, device, resolution, limits
    worker.py          # process/job orchestration
    adapter.py         # MUSt3R invocation and output normalization
    schemas.py         # host-owned request and response schemas
    artifacts.py       # safe artifact storage and conversion
frontend/
  features/reconstruction/
    api.ts
    ReconstructionDashboard.*
```

Do not place the model checkpoint inside a public static directory. Do not return raw absolute server paths to the browser.

## Minimal command-line adapter

The native command is useful for a first backend implementation or a worker subprocess:

```powershell
python slam.py `
  --chkpt "C:\models\MUSt3R_512.pth" `
  --device cuda:0 `
  --input "C:\jobs\job-123\frames" `
  --output "C:\jobs\job-123\result" `
  --res 512 `
  --subsamp 4 `
  --rerender
```

Equivalent installed entry point:

```powershell
must3r_slam --chkpt "C:\models\MUSt3R_512.pth" --device cuda:0 --input "C:\jobs\job-123\frames" --output "C:\jobs\job-123\result" --res 512 --subsamp 4 --rerender
```

For a first integration, use a directory of extracted image frames. The Gradio upload flow does not accept MP4 directly. For video input, pass the video to `slam.py` or extract frames in the host backend.

Useful runtime options:

| Option | Purpose | Starting value |
| --- | --- | --- |
| `--res` | Model image resolution | `512` for quality, `224` for lower VRAM |
| `--device` | Compute device | `cuda:0` in production GPU workers |
| `--skip_every` | Process every Nth input frame | `1` |
| `--subsamp` | Point-cloud subsampling | `4` at resolution 512 |
| `--rerender` | Re-render frames from final memory | Enable when full-frame artifacts are needed |
| `--rerender_bs` | Rerender batch size | Lower it when VRAM is exhausted |
| `--varying_focals` | Estimate changing focal length | Enable only when required |
| `--pointcloud_conf` | Point-cloud confidence threshold | `1.0` |
| `--gui` | Open3D interactive window | Disable on headless servers |

The exact supported options are defined by `must3r.slam.slam`. Treat that module as the source of truth if the CLI changes.

## Recommended API contract

Define this contract in the host backend, not in MUSt3R. A REST example:

```text
POST /api/reconstructions
Content-Type: multipart/form-data

images[]: image files
mode: "sequence" | "unordered"
resolution: 224 | 512
```

Return immediately:

```json
{
  "id": "job-123",
  "status": "queued"
}
```

Expose status separately:

```text
GET /api/reconstructions/job-123
```

```json
{
  "id": "job-123",
  "status": "running",
  "progress": 0.42,
  "processed_frames": 42,
  "total_frames": 100,
  "error": null,
  "artifacts": {
    "pointcloud": null,
    "trajectory": null,
    "viewer": null
  }
}
```

Completed response:

```json
{
  "id": "job-123",
  "status": "completed",
  "progress": 1.0,
  "processed_frames": 100,
  "total_frames": 100,
  "error": null,
  "artifacts": {
    "pointcloud": "/api/reconstructions/job-123/artifacts/pointcloud.ply",
    "trajectory": "/api/reconstructions/job-123/artifacts/trajectory.json",
    "viewer": null
  }
}
```

Recommended statuses are `queued`, `running`, `completed`, `failed`, and `cancelled`. The dashboard should handle all of them, including a missing or expired artifact.

## Python adapter shape

For direct Python integration, keep the adapter small and normalize tensors at the boundary:

```python
from pathlib import Path

import numpy as np
from must3r.model import load_model
from must3r.demo.inference import must3r_inference_video


class Must3rAdapter:
    def __init__(self, checkpoint: Path, device: str = "cuda:0", image_size: int = 512):
        self.device = device
        self.image_size = image_size
        self.model = load_model(
            chkpt_path=str(checkpoint),
            device=device,
            img_size=image_size,
            verbose=False,
        )

    def reconstruct(self, image_paths: list[Path]) -> dict:
        scene = must3r_inference_video(
            model=self.model,
            device=self.device,
            image_size=self.image_size,
            amp="bf16" if self.device.startswith("cuda") else False,
            filelist=[str(path) for path in image_paths],
            max_bs=1,
            init_num_images=2,
            batch_num_views=1,
            local_context_size=25,
            num_refinements_iterations=0,
            verbose=False,
        )

        poses = np.stack([
            pose.detach().cpu().numpy()
            for pose in scene.cams2world
        ]).astype("float32")
        return {
            "poses": poses,
            "image_list": list(scene.image_list),
        }
```

The example is a starting point, not a complete production worker. Confirm the installed version's inference signature and scene fields in `must3r/demo/inference.py` before binding a public API. Keep GPU tensors inside the worker and convert only the fields needed by the host application.

## Artifact handling

### Point cloud

Serve `pointcloud.ply` through an authenticated download endpoint or convert it to the format used by the existing dashboard viewer. Check file size before download and consider server-side decimation for large scenes.

### Camera trajectory

`all_poses.npz` is a NumPy container. On the trusted backend, read it with `allow_pickle=True` because the `focal` value may be object-like, then emit an application-owned JSON schema:

```python
import numpy as np

result = np.load(path, allow_pickle=True)
poses = result["poses"]       # [N, 4, 4], camera-to-world matrices
timestamps = result["timestamps"]
confs = result["confs"]
```

A browser-facing trajectory should contain plain JSON arrays, for example:

```json
{
  "coordinate_system": "must3r-camera-to-world",
  "poses": [[[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]],
  "timestamps": [0.0],
  "confidence": [1.0]
}
```

MUSt3R writes camera-to-world transforms. Before rendering them in an existing engine, verify axis orientation and units with a known test scene. Apply any conversion in one documented adapter function.

### Pickle state

Treat `memory.pkl` as trusted backend-only state. Python pickle can execute code during deserialization. Never accept a user-supplied pickle and never expose this file directly to the browser or an untrusted download client.

## Live viewer options

Choose one of these approaches:

- Use the host dashboard's existing 3D renderer with `pointcloud.ply`, trajectory JSON, and converted images.
- Run `ViserWrapper` behind the backend and embed its URL in an iframe.
- Use Viser's supported client package if the host frontend needs scene-node control.

Do not implement a custom client for undocumented Viser WebSocket frames. Viser owns that protocol and may change it. A Viser server is also a separate service with its own host, port, authentication, and reverse-proxy requirements; do not publish it without access control.

## Dashboard behavior

The dashboard should provide:

- Upload or select input images/video.
- A clear queued/running/completed/failed state.
- Progress and processed-frame counts when available.
- Cancel and retry actions wired to backend job controls.
- A 3D preview or a point-cloud download.
- A trajectory or camera-path view when pose data is available.
- A useful error message without exposing Python tracebacks, local paths, or checkpoint paths.
- A loading state while artifacts are being generated.
- A cleanup or retention policy for old jobs.

Keep the dashboard responsive: reconstruction is GPU/CPU-intensive and must not run in the HTTP request thread.

## Resource and security rules

- Limit upload count, image dimensions, total bytes, video duration, and frame count.
- Validate file types by content, not only by filename.
- Store uploads and outputs outside the public source tree.
- Use random per-job directories and authenticated artifact access.
- Prevent path traversal when accepting image paths or directories.
- Enforce one GPU worker at a time unless GPU memory has been measured for concurrency.
- Use `max_bs=1` and lower `--rerender_bs` when memory is limited.
- Delete temporary frames and failed job directories according to the host retention policy.
- Avoid logging image contents, credentials, absolute model paths, or private user data.
- Pin compatible versions of PyTorch, torchvision, Open3D, Viser, and the MUSt3R checkout in deployment.

## Smoke test before frontend work

Run a small reconstruction from the repository root:

```powershell
python slam.py `
  --chkpt "checkpoints\MUSt3R_512.pth" `
  --device cuda:0 `
  --input "path\to\two-or-more-frames" `
  --output "outputs\integration-smoke-test" `
  --res 512 `
  --subsamp 4
```

Confirm that the output directory contains `all_poses.npz`, `memory.pkl`, and `pointcloud.ply`. Then parse the trajectory and open the point cloud with the host application's intended viewer. If the machine has no compatible GPU, use `--device cpu` only as a functional smoke test; it may be substantially slower.

## Troubleshooting map

| Symptom | First checks |
| --- | --- |
| Checkpoint load failure | Check checkpoint path, Python/PyTorch compatibility, and model resolution. |
| CUDA out-of-memory | Use resolution 224, `max_bs=1`, lower rerender batch size, or reduce frame/keyframe count. |
| Empty or poor point cloud | Check input overlap, image ordering, confidence threshold, and camera motion. |
| Slow long-video processing | Increase `--skip_every` or `--subsamp`; process in a dedicated worker. |
| Dashboard hangs | Move inference out of the request thread and poll a job endpoint. |
| Viewer cannot connect | Check Viser host/port, reverse proxy and authentication configuration. |
| Browser cannot read NPZ/Pickle | Convert them on the backend to versioned JSON or a browser-safe binary format. |

## Source-of-truth files

- [README.md](README.md): installation, checkpoints, demos, and model behavior.
- [docs/FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md): detailed Python, Viser, Gradio, and output-schema notes.
- `setup.py`: package dependencies and installed commands.
- `must3r/slam/slam.py`: native SLAM CLI and export behavior.
- `must3r/demo/inference.py`: high-level inference behavior.
- `LICENSE` and `NOTICE`: usage and dataset restrictions.

When integrating into another project, keep this guide and the source-of-truth files together so a future AI agent can verify assumptions against the implementation instead of guessing.
