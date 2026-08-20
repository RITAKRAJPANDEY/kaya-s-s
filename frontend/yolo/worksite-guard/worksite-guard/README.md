# WorksiteGuard

A FastAPI server on your laptop that multiple cameras (phones over the browser,
Raspberry Pis via a Python script) stream video to over WiFi. The server runs
YOLO object detection on every frame, applies worker-safety threat rules, and
shows all feeds live on a dashboard.

```
Phone (browser) ──┐
Phone (browser) ──┼──WebSocket──▶  FastAPI server  ──WebSocket──▶  Dashboard
Raspberry Pi    ──┘                (YOLO + threat rules)           (your laptop browser)
```

## Read this first: what "accurate" means here

You asked for detection that doesn't flag random objects as threats. Two
things make that possible, and it's worth understanding both before you rely
on this for real safety monitoring:

1. **Debouncing.** A threat is only raised once it's been seen in most of the
   last few frames for that camera (`config.py` → `FRAME_HISTORY` /
   `DEBOUNCE_HITS`). A single misread frame can't trigger an alert by itself.
2. **The model you actually run.** Out of the box this uses YOLOv8n trained
   on COCO, which knows `person`, `car`, `truck`, `bus`, `motorcycle`,
   `knife`, `scissors`, etc. — but **COCO has no classes for hard hats,
   safety vests, or fire/smoke.** So by default, threats are limited to what
   the general model can actually see: a worker standing close to a vehicle,
   or a sharp tool near a worker. That's real and useful, but it is not PPE
   compliance checking.

   For real hard-hat / safety-vest detection, drop a PPE-trained YOLOv8
   model at `server/models/ppe.pt` — the server auto-loads it if present and
   the threat engine already knows what to do with its output. Two ways to
   get one:
   - Download a pretrained one, e.g. `Hansung-Cho/yolov8-ppe-detection` on
     Hugging Face (`hf_hub_download(repo_id=..., filename="best.pt")`).
   - Fine-tune your own with Ultralytics on the Roboflow "Construction Site
     Safety Image Dataset" — its classes (`Hardhat`, `NO-Hardhat`,
     `Safety Vest`, `NO-Safety Vest`, `Person`, `machinery`, `vehicle`, ...)
     already match what `threat_engine.py` expects.

   Test whichever model you pick on your own footage before trusting it —
   accuracy claims on a model card don't always hold up in your lighting,
   your camera angle, your workers' actual gear.

## Prerequisites

- Python 3.10+ on your laptop (server)
- Laptop and all phones/Pis on the **same WiFi network**
- `openssl` available (for the self-signed cert — usually preinstalled on
  macOS/Linux; on Windows use Git Bash or WSL)

## 1. Set up the server

```bash
cd worksite-guard
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r server/requirements.txt
```

The first run downloads `yolov8n.pt` automatically (~6MB).

## 2. Generate a TLS certificate

Phone browsers only allow camera access (`getUserMedia`) on a "secure
context." Plain `http://` on your LAN IP does not qualify, even on your own
WiFi — so the server needs to run HTTPS with a self-signed cert:

```bash
chmod +x gen_cert.sh && ./gen_cert.sh
```

This creates `key.pem` and `cert.pem` in the project root.

## 3. Run the server

```bash
cd server
uvicorn main:app --host 0.0.0.0 --port 8000 \
  --ssl-keyfile ../key.pem --ssl-certfile ../cert.pem
```

Find your laptop's LAN IP (`ipconfig` on Windows, `ifconfig`/`ip a` on
macOS/Linux — look for something like `192.168.1.42`).

## 4. Open the dashboard

On the laptop: `https://<laptop-ip>:8000/` — your browser will warn about
the self-signed certificate; click through ("Advanced → Proceed").

## 5. Connect a phone

On the phone's browser: `https://<laptop-ip>:8000/client` — accept the same
certificate warning, give the camera a name, tap **Start streaming**, allow
camera access. It should appear on the dashboard within a second or two.

## 6. Connect a Raspberry Pi

```bash
cd pi_client
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python pi_client.py --server 192.168.1.42:8000 --name gate-cam-1
```

If the Pi uses a CSI ribbon camera module rather than a USB webcam and
`--camera-index 0` doesn't open, enable the legacy camera stack
(`sudo raspi-config` → Interface Options → Legacy Camera) or run the script
prefixed with `libcamerify`.

## Tuning

Everything is in `server/config.py`:

| Setting | Effect |
|---|---|
| `CONF_THRESHOLD` | Higher = fewer false positives, may miss real objects |
| `INFER_WIDTH` | Lower = faster inference, worse on small/far objects |
| `PROXIMITY_DANGER_RATIO` / `CAUTION_RATIO` | How close (as a fraction of frame diagonal) counts as a threat |
| `FRAME_HISTORY` / `DEBOUNCE_HITS` | How many recent frames a threat must appear in before it's real |
| `MAX_STREAM_FPS` | Caps per-client frame rate the server will process — lower this first if multiple cameras make the dashboard laggy |

Running multiple camera streams through YOLO on a laptop CPU is the main
bottleneck. If it lags with several clients: lower `MAX_STREAM_FPS` and
`INFER_WIDTH` first, and use a GPU (`pip install` the CUDA build of
`torch`) if your laptop has an NVIDIA GPU.

## Project layout

```
worksite-guard/
├── gen_cert.sh
├── server/
│   ├── main.py            # FastAPI app, WebSocket routes, broadcast loop
│   ├── detector.py         # YOLO model wrapper (general + optional PPE)
│   ├── threat_engine.py    # Proximity / sharp-object / PPE rules + debouncing
│   ├── config.py           # All tunable thresholds
│   ├── models/              # put ppe.pt here (optional)
│   └── static/              # dashboard + phone client (HTML/CSS/JS)
└── pi_client/
    └── pi_client.py         # Raspberry Pi / USB webcam streamer
```
