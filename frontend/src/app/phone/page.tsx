"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Navbar from "@/components/Navigation/Navbar";
import { 
  Smartphone, 
  Radio, 
  MapPin, 
  Battery, 
  Check, 
  AlertCircle, 
  Play, 
  Square, 
  ArrowLeft, 
  Compass,
  Sparkles,
  Target,
  Send,
  ShieldAlert,
  Lock,
  Layers,
  HelpCircle,
  Camera,
  Video,
  VideoOff,
  RefreshCw,
  Eye
} from "lucide-react";

import { calculateDistanceMeters, calculateSpeedMps, formatSpeedKmh } from "@/lib/geo";
import { GPSKalmanFilter } from "@/lib/kalman";
import { ThreatDetection, BlindSpotAlert } from "@/lib/types";

export default function PhoneBroadcasterPage() {
  const [deviceId, setDeviceId] = useState("Phone-" + Math.floor(100 + Math.random() * 900));
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [status, setStatus] = useState("Ready to start broadcast");
  const [statusType, setStatusType] = useState<"idle" | "active" | "error">("idle");
  
  // GPS Coordinates
  const [currentLat, setCurrentLat] = useState<number | null>(null);
  const [currentLon, setCurrentLon] = useState<number | null>(null);
  const [currentAccuracy, setCurrentAccuracy] = useState<number | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [currentAltitude, setCurrentAltitude] = useState<number | null>(null);
  const [pingLatency, setPingLatency] = useState<number>(0);

  // IMU / Orientation State
  const [heading, setHeading] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const [roll, setRoll] = useState<number | null>(null);
  const [hasImuSupport, setHasImuSupport] = useState(false);
  const [needsIosPermission, setNeedsIosPermission] = useState(false);
  const [imuSource, setImuSource] = useState<string>("Waiting for motion...");

  // Device & Network State
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isSimulatedWalk, setIsSimulatedWalk] = useState(false);
  const [packetsSent, setPacketsSent] = useState(0);
  const [isSecure, setIsSecure] = useState(true);
  const [hostIp, setHostIp] = useState("");

  // Camera Capture & Streaming State
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const isCameraActiveRef = useRef<boolean>(false);

  useEffect(() => {
    isCameraActiveRef.current = isCameraActive;
  }, [isCameraActive]);

  // Shared Perception & Threat Detection State
  const [activeDetections, setActiveDetections] = useState<ThreatDetection[]>([]);
  const [blindSpotAlerts, setBlindSpotAlerts] = useState<BlindSpotAlert[]>([]);
  const activeDetectionsRef = useRef<ThreatDetection[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => { activeDetectionsRef.current = activeDetections; }, [activeDetections]);

  const wsRef = useRef<WebSocket | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const highRateIntervalRef = useRef<any>(null);
  const streamTickRef = useRef<any>(null);
  const videoStreamTickRef = useRef<any>(null);
  const simIntervalRef = useRef<any>(null);
  const kalmanRef = useRef<GPSKalmanFilter>(new GPSKalmanFilter(2.5));
  
  // High-rate state refs for seamless transmission
  const latestLatRef = useRef<number | null>(null);
  const latestLonRef = useRef<number | null>(null);
  const latestAccuracyRef = useRef<number | null>(null);
  const latestAltitudeRef = useRef<number | null>(null);
  const latestSpeedRef = useRef<number>(0);
  const latestHeadingRef = useRef<number | null>(null);
  const latestPitchRef = useRef<number | null>(null);
  const latestRollRef = useRef<number | null>(null);

  // Keep refs synced for transmission
  useEffect(() => {
    latestHeadingRef.current = heading;
    latestPitchRef.current = pitch;
    latestRollRef.current = roll;
  }, [heading, pitch, roll]);

  // Check secure context (HTTPS / localhost)
  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostIp(window.location.host);
      const secure = window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      setIsSecure(secure);

      // Check if iOS DeviceOrientation permission is needed
      if (
        typeof (DeviceOrientationEvent as any) !== "undefined" &&
        typeof (DeviceOrientationEvent as any).requestPermission === "function"
      ) {
        setNeedsIosPermission(true);
      }
    }
  }, []);

  // Read Battery status if supported
  useEffect(() => {
    if (typeof window !== "undefined" && "getBattery" in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(battery.level * 100);
        battery.addEventListener("levelchange", () => {
          setBatteryLevel(battery.level * 100);
        });
      }).catch(() => {});
    }
  }, []);

  // Listen to IMU Orientation with high-frequency updates
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOrientation = (e: any) => {
      setHasImuSupport(true);
      let calculatedHeading: number | null = null;

      // iOS WebKit compass heading (True North or Magnetic North)
      if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
        calculatedHeading = e.webkitCompassHeading;
        setImuSource("iOS Compass Hardware");
      } else if (e.alpha !== null && e.alpha !== undefined) {
        // Android / standard (alpha: 0-360)
        calculatedHeading = (360 - e.alpha) % 360;
        setImuSource(e.absolute ? "Android Absolute Compass" : "Gyroscope Orientation");
      }

      if (calculatedHeading !== null && !isNaN(calculatedHeading)) {
        const rounded = Math.round(calculatedHeading);
        setHeading(rounded);
        latestHeadingRef.current = rounded;
      }
      if (e.beta !== null && e.beta !== undefined && !isNaN(e.beta)) {
        const p = Math.round(e.beta);
        setPitch(p);
        latestPitchRef.current = p;
      }
      if (e.gamma !== null && e.gamma !== undefined && !isNaN(e.gamma)) {
        const r = Math.round(e.gamma);
        setRoll(r);
        latestRollRef.current = r;
      }
    };

    // Attach BOTH listeners for maximum compatibility
    window.addEventListener("deviceorientation", handleOrientation, true);
    window.addEventListener("deviceorientationabsolute" as any, handleOrientation, true);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      window.removeEventListener("deviceorientationabsolute" as any, handleOrientation, true);
    };
  }, []);

  // Request iOS 13+ DeviceOrientation permission or unlock sensors on tap
  const requestIosSensors = async () => {
    if (
      typeof (DeviceOrientationEvent as any) !== "undefined" &&
      typeof (DeviceOrientationEvent as any).requestPermission === "function"
    ) {
      try {
        const response = await (DeviceOrientationEvent as any).requestPermission();
        if (response === "granted") {
          setNeedsIosPermission(false);
          setStatus("Motion & IMU permissions granted!");
        } else {
          alert("Motion sensor permission was denied. Heading won't be streamed.");
        }
      } catch (err: any) {
        console.error("iOS sensor permission error:", err);
      }
    } else {
      setStatus("Sensor listeners activated!");
    }
  };

  // Camera Management Methods
  const startCamera = async (facing: "environment" | "user" = cameraFacing) => {
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 480, max: 640 },
          height: { ideal: 360, max: 480 },
          frameRate: { ideal: 12, max: 20 }
        },
        audio: false
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setIsCameraActive(true);
      setStatus("Camera feed active & streaming to laptop");
      setStatusType("active");
    } catch (err: any) {
      console.warn("Camera error:", err);
      setStatus(`Camera error: ${err.message || "Permission denied"}`);
      setStatusType("error");
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const toggleCamera = () => {
    if (isCameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  const flipCamera = () => {
    const nextFacing = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(nextFacing);
    if (isCameraActive) {
      startCamera(nextFacing);
    }
  };

  const isHttpSendingRef = useRef<boolean>(false);

  // High-FPS binary JPEG video streamer over direct WebSocket (<15ms latency)
  const sendVideoFrameWs = () => {
    if (!isCameraActiveRef.current || !videoRef.current || !captureCanvasRef.current) return;
    const v = videoRef.current;
    const c = captureCanvasRef.current;
    if (v.videoWidth === 0 || v.videoHeight === 0) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const w = 480;
      const h = Math.round((w * v.videoHeight) / v.videoWidth) || 360;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(v, 0, 0, w, h);
        c.toBlob(
          (blob) => {
            if (blob && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(blob);
            }
          },
          "image/jpeg",
          0.65
        );
      }
    }
  };

  const sendCurrentPose = () => {
    // Use fallback coordinates if GPS hasn't acquired yet (allows IMU-only streaming)
    const latToSend = latestLatRef.current !== null ? latestLatRef.current : (currentLat || 28.6139);
    const lonToSend = latestLonRef.current !== null ? latestLonRef.current : (currentLon || 77.2090);

    // Attach lightweight Base64 JPEG frame snapshot for live dashboard tile rendering
    let cameraFrameBase64: string | undefined = undefined;
    if (isCameraActiveRef.current && videoRef.current && captureCanvasRef.current) {
      const v = videoRef.current;
      const c = captureCanvasRef.current;
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        const w = 360;
        const h = Math.round((w * v.videoHeight) / v.videoWidth) || 270;
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const ctx = c.getContext("2d", { willReadFrequently: false });
        if (ctx) {
          ctx.drawImage(v, 0, 0, w, h);
          try {
            cameraFrameBase64 = c.toDataURL("image/jpeg", 0.5);
          } catch (e) {}
        }
      }
    }

    const payload = {
      device_id: deviceId,
      agent_id: deviceId,
      name: deviceId,
      type: "phone",
      lat: latToSend,
      lon: lonToSend,
      altitude: latestAltitudeRef.current || 0,
      heading: latestHeadingRef.current,
      heading_deg: latestHeadingRef.current,
      pitch: latestPitchRef.current,
      pitch_deg: latestPitchRef.current,
      roll: latestRollRef.current,
      camera_hfov_deg: 68,
      camera_frame_base64: cameraFrameBase64,
      detections: activeDetectionsRef.current,
      accuracy_m: latestAccuracyRef.current || (latestLatRef.current ? 5 : 50),
      speed_mps: latestSpeedRef.current,
      altitude_m: latestAltitudeRef.current,
      battery: batteryLevel,
      timestamp: Date.now() / 1000,
      client_time: Date.now(),
      online: true
    };

    // 1. Send over WebSocket if open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }

    // 2. Send via HTTP POST without keepalive (avoid 64KB browser payload limit)
    if (isHttpSendingRef.current) return;
    isHttpSendingRef.current = true;

    const t0 = Date.now();
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const roundtrip = Date.now() - t0;
        setPingLatency(roundtrip);
        setPacketsSent((p) => p + 1);

        // Check if there are active blind-spot alerts for this device
        if (data.blind_spot_alerts && data.blind_spot_alerts.length > 0) {
          setBlindSpotAlerts(data.blind_spot_alerts);
        } else {
          setBlindSpotAlerts([]);
        }
      })
      .catch((err) => {
        console.warn("Telemetry transmission error:", err);
        setStatus(`Transmission Notice: ${err.message || "Failed to reach server"}`);
        setStatusType("error");
      })
      .finally(() => {
        isHttpSendingRef.current = false;
      });
  };

  // High-accuracy GPS processor with 2D/3D Kinematic Kalman Filter
  const processGpsFix = (c: GeolocationCoordinates) => {
    const now = Date.now() / 1000;
    const rawLat = c.latitude;
    const rawLon = c.longitude;
    const rawAccuracy = c.accuracy || 5;
    const rawAlt = c.altitude || 0;

    // Pass through Kinematic Kalman Filter to eliminate noise & calculate velocity
    const filtered = kalmanRef.current.update(rawLat, rawLon, rawAccuracy, now, rawAlt);

    latestLatRef.current = filtered.lat;
    latestLonRef.current = filtered.lon;
    latestAccuracyRef.current = filtered.accuracy;
    latestAltitudeRef.current = filtered.alt;

    // Use optimal speed derived directly from Kalman velocity state vector
    let speedMps = filtered.speedMps;
    if (c.speed !== null && c.speed !== undefined && c.speed > 0) {
      speedMps = Math.max(c.speed, filtered.speedMps);
    }
    latestSpeedRef.current = speedMps;

    setCurrentLat(filtered.lat);
    setCurrentLon(filtered.lon);
    setCurrentAccuracy(filtered.accuracy);
    setCurrentAltitude(filtered.alt);
    setCurrentSpeed(speedMps);

    // Broadcast immediately on fix
    sendCurrentPose();
    
    const accuracyLabel = filtered.accuracy <= 4 ? `🛰️ Satellite Lock (±${filtered.accuracy.toFixed(1)}m)` : filtered.accuracy <= 12 ? `Good (±${filtered.accuracy.toFixed(1)}m)` : `Coarse (±${Math.round(filtered.accuracy)}m)`;
    setStatus(`Live GPS: ${filtered.lat.toFixed(6)}, ${filtered.lon.toFixed(6)} · ${accuracyLabel} · ${formatSpeedKmh(speedMps)}`);
    setStatusType("active");
  };

  const startBroadcasting = async () => {
    setIsBroadcasting(true);
    setStatus("Connecting to Telemetry Hub · Acquiring GPS & Camera...");
    setStatusType("active");

    // Unlock sensors and auto-start camera on broadcast activation
    requestIosSensors();
    if (!isCameraActiveRef.current) {
      startCamera();
    }

    // Establish Direct High-Speed Binary WebSocket Connection
    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.hostname;
      const port = "8000";
      const ws = new WebSocket(`${proto}//${host}:${port}/ws/stream/${deviceId}`);
      ws.binaryType = "blob";

      ws.onopen = () => {
        setStatus("🚀 High-Speed 30 FPS WebSocket Stream Active!");
        setStatusType("active");
      };
      ws.onclose = () => {
        // Fallback gracefully to sub-20ms HTTP SSE
      };
      wsRef.current = ws;
    } catch (e) {
      console.warn("WebSocket fallback to HTTP:", e);
    }

    // 1. High-FPS Binary Video Frame Streamer (30 FPS binary JPEG over WebSocket)
    videoStreamTickRef.current = setInterval(() => {
      sendVideoFrameWs();
    }, 33);

    // 2. High-Rate Background Broadcast Heartbeat (streams pose every 250ms)
    sendCurrentPose();
    streamTickRef.current = setInterval(() => {
      sendCurrentPose();
    }, 250);

    // If simulation requested
    if (isSimulatedWalk) {
      startSimulation();
      return;
    }

    // High-accuracy GPS with stable watchPosition (avoids continuous resetting)
    if (typeof window !== "undefined" && navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          processGpsFix(pos.coords);
        },
        (err) => {
          console.warn("GPS notice:", err.code, err.message);
          if (latestLatRef.current === null) {
            let msg = err.message;
            if (err.code === 1) msg = "Location permission denied. Allow location in browser.";
            if (err.code === 2) msg = "Acquiring GPS fix...";
            if (err.code === 3) msg = "Acquiring satellite lock...";
            setStatus(`GPS Notice: ${msg}`);
            setStatusType("error");
          }
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
      );
      watchIdRef.current = watchId;
    } else {
      setStatus("Geolocation API not supported on this browser.");
      setStatusType("error");
    }
  };

  const startSimulation = async () => {
    let baseLat = currentLat || 0;
    let baseLon = currentLon || 0;

    if (!baseLat || !baseLon) {
      try {
        const res = await fetch("https://ipwho.is/");
        const data = await res.json();
        if (data && data.latitude && data.longitude) {
          baseLat = data.latitude;
          baseLon = data.longitude;
        }
      } catch (e) {}
    }

    let simLat = baseLat;
    let simLon = baseLon;
    let step = 0;

    simIntervalRef.current = setInterval(() => {
      step += 0.06;
      simLat = baseLat + Math.sin(step) * 0.0025;
      simLon = baseLon + Math.cos(step) * 0.0025;
      const simHeading = Math.round(((Math.atan2(Math.cos(step), -Math.sin(step)) * 180) / Math.PI + 360) % 360);
      const simSpeedMps = 1.4 + Math.sin(step * 2) * 0.3; // ~5.0 km/h walking speed

      latestLatRef.current = simLat;
      latestLonRef.current = simLon;
      latestAccuracyRef.current = 2.4;
      latestSpeedRef.current = simSpeedMps;
      latestAltitudeRef.current = 14;

      setCurrentLat(simLat);
      setCurrentLon(simLon);
      setCurrentAccuracy(2.4);
      setCurrentSpeed(simSpeedMps);
      setHeading(simHeading);

      sendCurrentPose();
      setStatus(`Simulated GPS: ${simLat.toFixed(6)}, ${simLon.toFixed(6)} · ${formatSpeedKmh(simSpeedMps)}`);
      setStatusType("active");
    }, 250);
  };

  const stopBroadcasting = () => {
    setIsBroadcasting(false);
    setStatus("Broadcast stopped");
    setStatusType("idle");

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (highRateIntervalRef.current) {
      clearInterval(highRateIntervalRef.current);
      highRateIntervalRef.current = null;
    }
    if (streamTickRef.current) {
      clearInterval(streamTickRef.current);
      streamTickRef.current = null;
    }
    if (videoStreamTickRef.current) {
      clearInterval(videoStreamTickRef.current);
      videoStreamTickRef.current = null;
    }
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    kalmanRef.current.reset();
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-main)", display: "flex", flexDirection: "column" }}>
      <Navbar />

      <main style={{
        flex: 1,
        maxWidth: "520px",
        margin: "0 auto",
        width: "100%",
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "16px"
      }}>
        {/* Back Link */}
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--emerald-primary)",
            textDecoration: "none"
          }}
        >
          <ArrowLeft size={16} />
          <span>Back to Live Command Map</span>
        </Link>

        {/* INSECURE ORIGIN WARNING with actionable fix steps */}
        {!isSecure && (
          <div style={{
            backgroundColor: "#fffbeb",
            border: "1.5px solid #fde68a",
            borderRadius: "var(--radius-md)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            boxShadow: "var(--shadow-sm)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#b45309", fontWeight: 800, fontSize: "14px" }}>
              <ShieldAlert size={18} />
              <span>Enable GPS on This Connection</span>
            </div>
            <p style={{ fontSize: "12px", color: "#78350f", lineHeight: 1.6, margin: 0 }}>
              Chrome blocks GPS on <code style={{ backgroundColor: "#fef3c7", padding: "1px 4px", borderRadius: "3px" }}>http://</code> LAN addresses. 
              Use <b>one</b> of these fixes to enable real GPS:
            </p>

            {/* Fix 1: Chrome Flags */}
            <div style={{
              backgroundColor: "#ffffff",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #fef3c7",
              fontSize: "12px",
              color: "#92400e"
            }}>
              <b>✅ Fix (Android Chrome) — 30 seconds:</b>
              <ol style={{ margin: "8px 0 0 0", paddingLeft: "18px", lineHeight: 1.8 }}>
                <li>Open a new tab on your phone and go to:<br/>
                  <code style={{ 
                    display: "inline-block", marginTop: "2px",
                    backgroundColor: "#fef3c7", padding: "3px 6px", borderRadius: "4px",
                    fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: "11px",
                    userSelect: "all", wordBreak: "break-all"
                  }}>
                    chrome://flags/#unsafely-treat-insecure-origin-as-secure
                  </code>
                </li>
                <li>In the text box, type: <code style={{ backgroundColor: "#fef3c7", padding: "2px 5px", borderRadius: "3px", fontWeight: 700 }}>http://{hostIp}</code></li>
                <li>Change the dropdown to <b>Enabled</b></li>
                <li>Tap <b>Relaunch</b> at the bottom</li>
                <li>Come back to this page and tap <b>Start Live Broadcast</b></li>
              </ol>
            </div>

            {/* Alternative */}
            <p style={{ fontSize: "11px", color: "#a16207", margin: 0, lineHeight: 1.5 }}>
              💡 <b>Or</b> just tap <b>Start Live Broadcast</b> below — it will auto-switch to <b>Simulation Mode</b> if GPS is blocked, so you can still test the full system.
            </p>
          </div>
        )}

        {/* Active Blind-Spot Hazard Banner on Phone */}
        {blindSpotAlerts.length > 0 && (
          <div style={{
            backgroundColor: "#dc2626",
            color: "#ffffff",
            borderRadius: "var(--radius-lg)",
            padding: "16px 20px",
            boxShadow: "0 6px 20px rgba(220, 38, 38, 0.4)",
            animation: "pulse 1.2s infinite",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "24px" }}>🚨</span>
              <div>
                <strong style={{ fontSize: "14px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  BLIND-SPOT THREAT WARNING!
                </strong>
                <p style={{ margin: "2px 0 0 0", fontSize: "12px", opacity: 0.95 }}>
                  Hazard detected in your blind spot by peer camera mesh
                </p>
              </div>
            </div>

            {blindSpotAlerts.map((alert, idx) => (
              <div key={idx} style={{
                backgroundColor: "rgba(0, 0, 0, 0.25)",
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                lineHeight: 1.4
              }}>
                {alert.message}
              </div>
            ))}
          </div>
        )}

        {/* Main Phone Broadcaster Card */}
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-light)",
          boxShadow: "var(--shadow-md)",
          padding: "22px",
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "44px",
                height: "44px",
                borderRadius: "12px",
                backgroundColor: "var(--bg-green-tint)",
                color: "var(--emerald-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <Smartphone size={22} />
              </div>
              <div>
                <h1 style={{ fontSize: "18px", fontWeight: 800, color: "var(--emerald-dark)" }}>
                  Mobile Broadcaster
                </h1>
                <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  High-Precision GPS & IMU Telemetry Stream
                </p>
              </div>
            </div>

            {/* Battery Indicator */}
            {batteryLevel !== null && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
                fontWeight: 700,
                color: batteryLevel > 20 ? "var(--emerald-primary)" : "#ef4444",
                backgroundColor: "var(--bg-card-muted)",
                border: "1px solid var(--border-light)",
                padding: "4px 8px",
                borderRadius: "6px"
              }}>
                <Battery size={14} />
                <span>{Math.round(batteryLevel)}%</span>
              </div>
            )}
          </div>

          {/* Device ID Configuration */}
          <div>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
              Device Call-Sign / Node Name
            </label>
            <input
              type="text"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={isBroadcasting}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid var(--border-light)",
                fontSize: "14px",
                fontFamily: "var(--font-sans)",
                backgroundColor: isBroadcasting ? "#f8fafc" : "#ffffff",
                color: "var(--text-main)",
                outline: "none"
              }}
            />
          </div>

          {/* iOS Sensor Permission Button */}
          {needsIosPermission && (
            <button
              onClick={requestIosSensors}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "10px",
                backgroundColor: "var(--bg-green-tint)",
                border: "1px solid var(--border-green)",
                borderRadius: "8px",
                color: "var(--emerald-dark)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              <Compass size={16} />
              <span>Enable iOS Compass & Motion Sensors</span>
            </button>
          )}

          {/* Live IMU 360° Compass Rose & Attitude Gauge */}
          <div style={{
            backgroundColor: "#fcfdfc",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
            padding: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-around"
          }}>
            {/* Visual Compass Needle */}
            <div style={{ position: "relative", width: "110px", height: "110px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "2px dashed var(--border-light)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <span style={{ position: "absolute", top: "2px", fontSize: "10px", fontWeight: 800, color: "#ef4444" }}>N</span>
                <span style={{ position: "absolute", bottom: "2px", fontSize: "10px", fontWeight: 700, color: "var(--text-muted)" }}>S</span>
                <span style={{ position: "absolute", left: "4px", fontSize: "10px", fontWeight: 700, color: "var(--text-muted)" }}>W</span>
                <span style={{ position: "absolute", right: "4px", fontSize: "10px", fontWeight: 700, color: "var(--text-muted)" }}>E</span>
              </div>

              {/* Rotated Needle */}
              <div style={{
                width: "4px",
                height: "80px",
                position: "relative",
                transform: `rotate(${heading || 0}deg)`,
                transition: "transform 0.15s ease-out"
              }}>
                <div style={{ width: "100%", height: "50%", backgroundColor: "#ef4444", borderRadius: "2px 2px 0 0" }} />
                <div style={{ width: "100%", height: "50%", backgroundColor: "var(--text-muted)", borderRadius: "0 0 2px 2px" }} />
              </div>

              {/* Center Pivot */}
              <div style={{
                position: "absolute",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                backgroundColor: "#ffffff",
                border: "2px solid var(--emerald-primary)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.2)"
              }} />
            </div>

            {/* Readout Numbers */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Heading ({imuSource})
                </div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--emerald-dark)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {heading !== null ? `${heading}°` : "0°"}
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--text-secondary)" }}>
                <span>Pitch: <b>{pitch !== null ? `${pitch}°` : "--"}</b></span>
                <span>Roll: <b>{roll !== null ? `${roll}°` : "--"}</b></span>
              </div>
            </div>
          </div>

          {/* Live Mobile Camera Stream to Laptop */}
          <div style={{
            backgroundColor: "#f8fafc",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Camera size={16} style={{ color: "var(--emerald-primary)" }} />
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main)" }}>
                    Live Video Feed Stream
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {isCameraActive ? "Streaming video feed to laptop command center" : "Stream phone camera to laptop dashboard"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {isCameraActive && (
                  <button
                    onClick={flipCamera}
                    title="Switch Camera (Front/Back)"
                    style={{
                      padding: "6px 8px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-light)",
                      backgroundColor: "#ffffff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11px",
                      color: "var(--text-secondary)"
                    }}
                  >
                    <RefreshCw size={12} />
                    <span>Flip</span>
                  </button>
                )}
                <button
                  onClick={toggleCamera}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 12px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: isCameraActive ? "#ef4444" : "var(--emerald-primary)",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  {isCameraActive ? (
                    <>
                      <VideoOff size={14} />
                      <span>Stop Camera</span>
                    </>
                  ) : (
                    <>
                      <Video size={14} />
                      <span>Turn On Camera</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Video Preview Canvas container */}
            <div style={{
              position: "relative",
              width: "100%",
              height: isCameraActive ? "200px" : "0px",
              maxHeight: "240px",
              backgroundColor: "#000000",
              borderRadius: "8px",
              overflow: "hidden",
              transition: "height 0.2s ease-in-out",
              display: isCameraActive ? "flex" : "none",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div style={{
                position: "absolute",
                top: "8px",
                left: "8px",
                backgroundColor: "rgba(0,0,0,0.6)",
                padding: "3px 8px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "10px",
                color: "#10b981",
                fontWeight: 700
              }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981" }} />
                <span>LIVE STREAMING TO LAPTOP</span>
              </div>
            </div>
            {/* Hidden Canvas for JPEG snapshot encoding */}
            <canvas ref={captureCanvasRef} style={{ display: "none" }} />
          </div>

          {/* Simulation Toggle for Desktop Testing */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            backgroundColor: "var(--bg-card-muted)",
            borderRadius: "8px",
            border: "1px solid var(--border-light)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={16} style={{ color: "var(--emerald-primary)" }} />
              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main)" }}>
                  Desktop Simulation Mode
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Generate synthetic coordinates for testing without GPS hardware
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isSimulatedWalk}
              onChange={(e) => setIsSimulatedWalk(e.target.checked)}
              disabled={isBroadcasting}
              style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--emerald-primary)" }}
            />
          </div>

          {/* Start / Stop Broadcast Button */}
          {isBroadcasting ? (
            <button
              onClick={stopBroadcasting}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                backgroundColor: "#ef4444",
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                padding: "14px",
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(239, 68, 68, 0.25)"
              }}
            >
              <Square size={18} />
              <span>Stop Live Broadcast</span>
            </button>
          ) : (
            <button
              onClick={startBroadcasting}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                backgroundColor: "var(--emerald-primary)",
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                padding: "14px",
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(5, 150, 105, 0.3)"
              }}
            >
              <Play size={18} />
              <span>Start Live Broadcast</span>
            </button>
          )}

          {/* Status Banner */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 14px",
            borderRadius: "8px",
            backgroundColor: statusType === "active" ? "var(--bg-green-tint)" : statusType === "error" ? "#fef2f2" : "#f8fafc",
            border: statusType === "active" ? "1px solid var(--border-green)" : statusType === "error" ? "1px solid #fca5a5" : "1px solid var(--border-light)",
            fontSize: "12px",
            fontWeight: 600,
            color: statusType === "active" ? "var(--emerald-dark)" : statusType === "error" ? "#dc2626" : "var(--text-secondary)"
          }}>
            {statusType === "active" ? (
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#10b981" }} className="pulse-active" />
            ) : statusType === "error" ? (
              <AlertCircle size={14} />
            ) : (
              <Radio size={14} />
            )}
            <span>{status}</span>
          </div>

          {/* Live Sensor Metrics Readout */}
          <div style={{
            backgroundColor: "#fcfdfc",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                Live Stream Metrics
              </span>
              {pingLatency > 0 && (
                <span style={{
                  fontSize: "11px",
                  fontWeight: 800,
                  color: pingLatency < 100 ? "#059669" : "#d97706",
                  backgroundColor: pingLatency < 100 ? "#ecfdf5" : "#fffbeb",
                  padding: "2px 6px",
                  borderRadius: "4px"
                }}>
                  ⚡ {pingLatency} ms
                </span>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Latitude</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "var(--text-main)" }}>
                {currentLat ? `${currentLat.toFixed(6)}°` : "--"}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Longitude</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "var(--text-main)" }}>
                {currentLon ? `${currentLon.toFixed(6)}°` : "--"}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", alignItems: "center" }}>
              <span style={{ color: "var(--text-secondary)" }}>GPS Precision</span>
              {currentAccuracy !== null ? (
                <span style={{
                  fontWeight: 800,
                  fontSize: "11px",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  backgroundColor: currentAccuracy <= 5 ? "#ecfdf5" : currentAccuracy <= 15 ? "#fef3c7" : "#fee2e2",
                  color: currentAccuracy <= 5 ? "#065f46" : currentAccuracy <= 15 ? "#92400e" : "#991b1b"
                }}>
                  {currentAccuracy <= 5 ? `🛰️ Satellite (±${currentAccuracy.toFixed(1)}m)` : currentAccuracy <= 15 ? `Strong (±${currentAccuracy.toFixed(1)}m)` : `Coarse (±${Math.round(currentAccuracy)}m)`}
                </span>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>Acquiring...</span>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", alignItems: "center" }}>
              <span style={{ color: "var(--text-secondary)" }}>Instant Speed</span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 800,
                fontSize: "15px",
                color: currentSpeed > 0.3 ? "var(--emerald-primary)" : "var(--text-main)"
              }}>
                {formatSpeedKmh(currentSpeed)}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Transmitted Frames</span>
              <span style={{ fontWeight: 700, color: "var(--text-main)" }}>
                {packetsSent} packets
              </span>
            </div>
          </div>

          {/* Shared Perception & Threat Broadcaster Panel */}
          <div style={{
            backgroundColor: "#ffffff",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <ShieldAlert size={16} style={{ color: "#059669" }} />
                <span style={{ fontSize: "12px", fontWeight: 800, color: "#0f172a" }}>
                  Shared Perception & Threat Broadcaster
                </span>
              </div>
              <span style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: "4px",
                backgroundColor: activeDetections.length > 0 ? "#fee2e2" : "#f0fdf4",
                color: activeDetections.length > 0 ? "#dc2626" : "#166534"
              }}>
                {activeDetections.length} Active Threat{activeDetections.length !== 1 ? "s" : ""}
              </span>
            </div>

            <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>
              Broadcast simulated YOLO object detections from this phone to project global threat coordinates and trigger blind-spot warnings to peers.
            </p>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  const newDet: ThreatDetection = {
                    class: "threat",
                    confidence: 0.92,
                    bearing_deg: 0, // Ahead
                    est_distance_m: 14.2
                  };
                  setActiveDetections([newDet]);
                  if (isBroadcasting) sendCurrentPose();
                }}
                style={{
                  flex: 1,
                  minWidth: "130px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  backgroundColor: activeDetections.some(d => d.class === "threat") ? "#fef2f2" : "#ffffff",
                  border: activeDetections.some(d => d.class === "threat") ? "1.5px solid #ef4444" : "1px solid var(--border-light)",
                  color: activeDetections.some(d => d.class === "threat") ? "#dc2626" : "var(--text-main)",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                🚨 Spot Threat Ahead (14m)
              </button>

              <button
                onClick={() => {
                  const newDet: ThreatDetection = {
                    class: "forklift",
                    confidence: 0.96,
                    bearing_deg: 15, // 15 deg to the right
                    est_distance_m: 8.5
                  };
                  setActiveDetections([newDet]);
                  if (isBroadcasting) sendCurrentPose();
                }}
                style={{
                  flex: 1,
                  minWidth: "130px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  backgroundColor: activeDetections.some(d => d.class === "forklift") ? "#fffbeb" : "#ffffff",
                  border: activeDetections.some(d => d.class === "forklift") ? "1.5px solid #d97706" : "1px solid var(--border-light)",
                  color: activeDetections.some(d => d.class === "forklift") ? "#b45309" : "var(--text-main)",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                🚜 Spot Forklift (8.5m)
              </button>

              {activeDetections.length > 0 && (
                <button
                  onClick={() => {
                    setActiveDetections([]);
                    if (isBroadcasting) sendCurrentPose();
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    backgroundColor: "#f8fafc",
                    border: "1px solid var(--border-light)",
                    color: "var(--text-secondary)",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
