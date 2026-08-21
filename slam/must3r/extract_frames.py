#!/usr/bin/env python3
"""
FFmpeg Frame Extraction Script for MUSt3R 3D SLAM.
Extracts JPEG keyframes from videos into slam/must3r/frames/ for 3D reconstruction.
"""

import argparse
import os
import subprocess
from pathlib import Path

MUST3R_DIR = Path(__file__).resolve().parent
DEFAULT_FRAMES_DIR = MUST3R_DIR / "frames"

def find_ffmpeg() -> str:
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    winget_ffmpeg = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages" / "Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe" / "ffmpeg-9.0.1-full_build-shared" / "bin" / "ffmpeg.exe"
    if winget_ffmpeg.exists():
        return str(winget_ffmpeg)
    return "ffmpeg"

def extract_frames(video_name_or_path: str, fps: int = 5, output_dir: Path = DEFAULT_FRAMES_DIR):
    v_path = Path(video_name_or_path)
    if not v_path.is_absolute():
        v_path = MUST3R_DIR / video_name_or_path

    if not v_path.exists():
        print(f"[ERROR] Video file not found: {v_path}")
        return False

    output_dir.mkdir(parents=True, exist_ok=True)

    # Clear old frames
    for old_frame in output_dir.glob("frame_*.jpg"):
        try:
            old_frame.unlink()
        except Exception:
            pass

    ffmpeg_bin = find_ffmpeg()
    out_pattern = output_dir / "frame_%06d.jpg"

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", str(v_path),
        "-vf", f"fps={fps}",
        "-q:v", "2",
        str(out_pattern)
    ]

    print(f"[INFO] Extracting frames from '{v_path.name}' at {fps} FPS...")
    print(f"[INFO] Running command: {' '.join(cmd)}")

    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print(f"[ERROR] FFmpeg error: {res.stderr[-300:]}")
        return False

    extracted = sorted(list(output_dir.glob("frame_*.jpg")))
    print(f"[SUCCESS] Extracted {len(extracted)} frames into: {output_dir}")
    print(f"[NOTE] Copy-paste this path into Gradio 'local_path' tab:")
    print(f"       {output_dir}")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract video frames for MUSt3R 3D SLAM")
    parser.add_argument("--video", type=str, default="WhatsApp Video 2026-08-20 at 23.28.57.mp4", help="Video filename or path")
    parser.add_argument("--fps", type=int, default=5, help="Frame extraction rate (default: 5)")
    args = parser.parse_args()

    extract_frames(args.video, args.fps)
