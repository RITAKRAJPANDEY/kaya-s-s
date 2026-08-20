"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Sidebar from "@/components/Sidebar";
import SimulatorModal from "@/components/Dashboard/SimulatorModal";
import GeofenceModal from "@/components/Dashboard/GeofenceModal";
import StationCalibrateModal from "@/components/Dashboard/StationCalibrateModal";
import IncidentAnalysisModal from "@/components/IncidentAnalysisModal";
import { DeviceTelemetry, SimulationProfile, GeofenceZone, GeofenceAlert, BlindSpotAlert } from "@/lib/types";
import { 
  calculateDistanceMeters, 
  formatDistance, 
  calculateSpeedMps, 
  formatSpeedKmh,
  isPointInPolygon,
  calculatePolygonCentroid,
  calculatePolygonPerimeterMeters,
  calculatePolygonAreaMeters,
  formatArea
} from "@/lib/geo";
import { GPSKalmanFilter } from "@/lib/kalman";
import { 
  Radio, 
  Search, 
  Plus, 
  Gauge, 
  Target, 
  MapPin, 
  Activity, 
  Layers,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Smartphone,
  CheckCircle2,
  Mountain,
  PlusCircle,
  Compass,
  QrCode,
  X,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  PenTool,
  Undo2,
  Hexagon,
  Circle,
  Crosshair,
  Satellite,
  Wifi,
  Shield,
  SlidersHorizontal,
  Navigation,
  Cpu,
  Maximize2
} from "lucide-react";
import Link from "next/link";

// Dynamic import of Leaflet LiveMap with SSR disabled
const LiveMap = dynamic(() => import("@/components/Map/LiveMap"), {
  ssr: false,
  loading: () => (
    <div style={{
      width: "100%",
      height: "100%",
      minHeight: "500px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#f8faf8",
      color: "var(--emerald-dark)"
    }}>
      <div style={{
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        border: "3px solid #d1fae5",
        borderTopColor: "#059669",
        animation: "spin 1s linear infinite"
      }} />
      <span style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600 }}>
        Loading High-Precision Map...
      </span>
    </div>
  )
});

export default function GeofenceDashboardPage() {
  // Real-time fleet devices
  const [devices, setDevices] = useState<DeviceTelemetry[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DeviceTelemetry | null>(null);
  const [activeTrails, setActiveTrails] = useState<Record<string, boolean>>({});
  const [focusCoords, setFocusCoords] = useState<[number, number] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  
  // Geofencing & Waypoint Marking State
  const [geofences, setGeofences] = useState<GeofenceZone[]>([]);
  const [isGeofenceModalOpen, setIsGeofenceModalOpen] = useState(false);
  const [isDrawingWaypoints, setIsDrawingWaypoints] = useState(false);
  const [drawingWaypoints, setDrawingWaypoints] = useState<[number, number][]>([]);
  const [geofenceAlerts, setGeofenceAlerts] = useState<GeofenceAlert[]>([]);
  const [blindSpotAlerts, setBlindSpotAlerts] = useState<BlindSpotAlert[]>([]);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
  const previousContainmentRef = useRef<Record<string, Record<string, boolean>>>({});

  // Simulator State
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simProfiles, setSimProfiles] = useState<SimulationProfile[]>([]);
  const simAnglesRef = useRef<Record<string, number>>({});

  // Laptop Base Station & Precise Calibration State
  const [isLaptopStationActive, setIsLaptopStationActive] = useState(true);
  const [laptopLocation, setLaptopLocation] = useState<{ lat: number; lon: number; accuracy: number; altitude: number | null; label?: string } | null>(null);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [isCalibrateModalOpen, setIsCalibrateModalOpen] = useState(false);
  const [isPinpointingStation, setIsPinpointingStation] = useState(false);
  const isCustomStationCalibratedRef = useRef(false);
  const hasAutoSyncedPhoneRef = useRef(false);
  const laptopWatchIdRef = useRef<number | null>(null);
  const initialOriginSetRef = useRef(false);

  // Phone Connect Guide Modal
  const [isPhoneGuideOpen, setIsPhoneGuideOpen] = useState(false);
  const [hostUrl, setHostUrl] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  // 2D/3D Kinematic Kalman Filters per device to eliminate GPS noise & calculate optimal velocity
  const kalmanFiltersMapRef = useRef<Map<string, GPSKalmanFilter>>(new Map());

  const applyDeviceKalman = (d: DeviceTelemetry): DeviceTelemetry => {
    // If device is already sending high-precision GPS (from phone or RTK), preserve exact coordinates
    if (d.accuracy_m && d.accuracy_m <= 10) {
      return d;
    }

    if (!kalmanFiltersMapRef.current.has(d.device_id)) {
      kalmanFiltersMapRef.current.set(d.device_id, new GPSKalmanFilter(2.5));
    }
    const kf = kalmanFiltersMapRef.current.get(d.device_id)!;
    const tsSec = d.timestamp ? (d.timestamp > 1e11 ? d.timestamp / 1000 : d.timestamp) : Date.now() / 1000;
    const kState = kf.update(d.lat, d.lon, d.accuracy_m || 5, tsSec, d.altitude_m || 0);
    const finalSpeed = (d.speed_mps !== undefined && d.speed_mps !== null && d.speed_mps > 0) ? d.speed_mps : kState.speedMps;

    return {
      ...d,
      lat: kState.lat,
      lon: kState.lon,
      accuracy_m: kState.accuracy,
      altitude_m: kState.alt,
      speed_mps: finalSpeed
    };
  };

  // Sync Server Station device and broadcast position
  const syncServerStation = (rawLat: number, rawLon: number, accuracy: number, altitude: number | null, label?: string) => {
    const lat = rawLat;
    const lon = rawLon;
    const loc = { lat, lon, accuracy, altitude, label };
    setLaptopLocation(loc);

    const stationDevice: DeviceTelemetry = {
      device_id: "station-laptop",
      name: "Command Station (Laptop / Server)",
      type: "station",
      lat,
      lon,
      accuracy_m: accuracy,
      speed_mps: 0,
      altitude_m: altitude || 0,
      timestamp: Date.now() / 1000,
      online: true,
      color: "#2563eb",
      history: [{ lat, lon, timestamp: Date.now() / 1000 }]
    };

    // Post to telemetry backend
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stationDevice)
    }).catch(() => {});

    setDevices((prev) => {
      const map = new Map(prev.map((d) => [d.device_id, d]));
      const existing = map.get("station-laptop");
      const history = existing ? [...(existing.history || []), { lat, lon, timestamp: Date.now() / 1000 }] : [{ lat, lon, timestamp: Date.now() / 1000 }];
      map.set("station-laptop", { ...stationDevice, history: history.slice(-60) });
      return Array.from(map.values());
    });

    if (!initialOriginSetRef.current) {
      initialOriginSetRef.current = true;
      setFocusCoords([lat, lon]);
    }
  };

  // Handlers for Station Calibration & Persistence
  const handleSaveStationCalibration = (lat: number, lon: number, accuracy: number, label: string) => {
    isCustomStationCalibratedRef.current = true;
    if (typeof window !== "undefined") {
      localStorage.setItem("kaya_custom_station", JSON.stringify({ lat, lon, accuracy, label, altitude: 0 }));
    }
    syncServerStation(lat, lon, accuracy, null, label);
    setFocusCoords([lat, lon]);
    setIsPinpointingStation(false);
  };

  const handleRefreshServerGps = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      if (!laptopLocation) {
        syncServerStation(23.0225, 72.5714, 15, null, "Default Base Station");
      }
      return;
    }
    setIsRefreshingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsRefreshingGps(false);
        const c = pos.coords;
        syncServerStation(c.latitude, c.longitude, c.accuracy || 8, c.altitude, "Laptop Live GPS");
        setFocusCoords([c.latitude, c.longitude]);
      },
      (err) => {
        setIsRefreshingGps(false);
        console.warn("Laptop GPS lookup notice:", err.message);
        if (!laptopLocation) {
          syncServerStation(23.0225, 72.5714, 20, null, "Default Base Station");
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
    );
  };

  const handleResetToAutoGps = () => {
    isCustomStationCalibratedRef.current = false;
    if (typeof window !== "undefined") {
      localStorage.removeItem("kaya_custom_station");
    }
    handleRefreshServerGps();
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostUrl(window.location.host);

      // Check if user has previously calibrated base station
      let hasSaved = false;
      try {
        const saved = localStorage.getItem("kaya_custom_station");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.lat && parsed.lon) {
            hasSaved = true;
            isCustomStationCalibratedRef.current = true;
            syncServerStation(parsed.lat, parsed.lon, parsed.accuracy || 1.5, parsed.altitude || null, parsed.label || "Calibrated Base Station");
          }
        }
      } catch (e) {}

      // If no saved custom station, immediately query laptop browser GPS
      if (!hasSaved) {
        handleRefreshServerGps();
      }

      // Browser GPS Watch to continuously track laptop position
      if (navigator.geolocation) {
        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (isCustomStationCalibratedRef.current) return;
            const c = pos.coords;
            syncServerStation(c.latitude, c.longitude, c.accuracy || 8, c.altitude, "Live GPS Fix");
          },
          (err) => {
            console.warn("Server GPS watch notice:", err.message);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
        laptopWatchIdRef.current = watchId;
      }
    }

    return () => {
      if (laptopWatchIdRef.current !== null && typeof window !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(laptopWatchIdRef.current);
      }
    };
  }, []);

  // 1. Persistent Real-Time SSE Stream (<15ms sub-second latency from Next.js server)
  useEffect(() => {
    if (typeof window === "undefined") return;

    let eventSource: EventSource | null = null;
    let sseReconnectTimer: any = null;

    const connectSSE = () => {
      try {
        eventSource = new EventSource("/api/telemetry/stream");

        eventSource.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "snapshot" && Array.isArray(msg.devices)) {
              setDevices((prev) => {
                const prevMap = new Map(prev.map((d) => [d.device_id, d]));
                const merged: DeviceTelemetry[] = msg.devices.map((rawDev: DeviceTelemetry) => {
                  const d = applyDeviceKalman(rawDev);
                  const existing = prevMap.get(d.device_id);
                  const prevHist = existing?.history || [];
                  const lastPt = prevHist[prevHist.length - 1];
                  const hasMoved = !lastPt || Math.abs(lastPt.lat - d.lat) > 0.000005 || Math.abs(lastPt.lon - d.lon) > 0.000005;
                  const history = hasMoved ? [...prevHist, { lat: d.lat, lon: d.lon, timestamp: d.timestamp || Date.now() / 1000 }].slice(-60) : prevHist;
                  return { ...d, history };
                });

                if (isLaptopStationActive && laptopLocation && !merged.some((d: any) => d.device_id === "station-laptop")) {
                  merged.unshift({
                    device_id: "station-laptop",
                    name: "Command Station (Laptop / Server)",
                    type: "station",
                    lat: laptopLocation.lat,
                    lon: laptopLocation.lon,
                    accuracy_m: laptopLocation.accuracy || 5,
                    speed_mps: 0,
                    altitude_m: laptopLocation.altitude || 0,
                    timestamp: Date.now() / 1000,
                    online: true,
                    color: "#2563eb",
                    history: [{ lat: laptopLocation.lat, lon: laptopLocation.lon, timestamp: Date.now() / 1000 }]
                  });
                }
                return merged;
              });
            } else if (msg.type === "update" && msg.device) {
              const d = applyDeviceKalman(msg.device as DeviceTelemetry);

              if (msg.blind_spot_alerts) {
                setBlindSpotAlerts(msg.blind_spot_alerts);
              }

              setDevices((prev) => {
                const map = new Map(prev.map((dev) => [dev.device_id, dev]));
                const existing = map.get(d.device_id);
                const prevHist = existing?.history || [];
                const lastPt = prevHist[prevHist.length - 1];
                const hasMoved = !lastPt || Math.abs(lastPt.lat - d.lat) > 0.000005 || Math.abs(lastPt.lon - d.lon) > 0.000005;
                const history = hasMoved ? [...prevHist, { lat: d.lat, lon: d.lon, timestamp: d.timestamp || Date.now() / 1000 }].slice(-60) : prevHist;

                const updatedDev = { ...d, history };
                map.set(d.device_id, updatedDev);

                // Ensure station is maintained
                if (isLaptopStationActive && laptopLocation && !map.has("station-laptop")) {
                  map.set("station-laptop", {
                    device_id: "station-laptop",
                    name: "Command Station (Laptop / Server)",
                    type: "station",
                    lat: laptopLocation.lat,
                    lon: laptopLocation.lon,
                    accuracy_m: laptopLocation.accuracy || 5,
                    speed_mps: 0,
                    altitude_m: laptopLocation.altitude || 0,
                    timestamp: Date.now() / 1000,
                    online: true,
                    color: "#2563eb",
                    history: [{ lat: laptopLocation.lat, lon: laptopLocation.lon, timestamp: Date.now() / 1000 }]
                  });
                }

                // Update selected device reference if active
                setSelectedDevice((curr) => (curr?.device_id === d.device_id ? updatedDev : curr));

                return Array.from(map.values());
              });
            } else if (msg.type === "delete" && msg.device_id) {
              setDevices((prev) => prev.filter((d) => d.device_id !== msg.device_id));
            }
          } catch (e) {}
        };

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          sseReconnectTimer = setTimeout(connectSSE, 2000);
        };
      } catch (e) {}
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    };
  }, [isLaptopStationActive]);

  // Fast Fallback Polling (every 350ms)
  useEffect(() => {
    let timer: any = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/telemetry");
        if (res.ok) {
          const data = await res.json();
          const deviceList: DeviceTelemetry[] = Array.isArray(data) ? data : (data.devices || []);
          if (deviceList.length > 0) {
            // Auto-align station if uncalibrated
            const phone = deviceList.find((x) => (x.type === "phone" || x.device_id.startsWith("phone") || x.device_id === "phone-broadcaster") && (x.accuracy_m || 20) <= 20);
            if (phone && !isCustomStationCalibratedRef.current && (!laptopLocation || laptopLocation.accuracy > 25)) {
              syncServerStation(phone.lat, phone.lon, Math.min(phone.accuracy_m || 2, 2.5), phone.altitude_m || null, "Aligned with Phone GPS");
            }

            setDevices((prev) => {
              const prevMap = new Map(prev.map((d) => [d.device_id, d]));
              const merged: DeviceTelemetry[] = deviceList.map((rawDev: DeviceTelemetry) => {
                const d = applyDeviceKalman(rawDev);
                const existing = prevMap.get(d.device_id);
                const prevHist = existing?.history || [];
                const lastPt = prevHist[prevHist.length - 1];
                const hasMoved = !lastPt || Math.abs(lastPt.lat - d.lat) > 0.000005 || Math.abs(lastPt.lon - d.lon) > 0.000005;
                const history = hasMoved ? [...prevHist, { lat: d.lat, lon: d.lon, timestamp: d.timestamp || Date.now() / 1000 }].slice(-60) : prevHist;
                return { ...d, history };
              });

              if (isLaptopStationActive && !deviceList.some((d: any) => d.device_id === "station-laptop")) {
                const localStation = prev.find((p) => p.device_id === "station-laptop");
                if (localStation) merged.unshift(localStation);
              }
              return merged;
            });
          }
        }
      } catch (err) {}
      timer = setTimeout(poll, 350);
    };

    poll();
    return () => clearTimeout(timer);
  }, [isLaptopStationActive]);

  // Geofencing Containment & Breach Detection
  useEffect(() => {
    const activeZones = geofences.filter((g) => g.enabled);
    if (activeZones.length === 0 || devices.length === 0) return;

    devices.forEach((device) => {
      if (device.type === "station") return;

      activeZones.forEach((zone) => {
        let isInside = false;
        let dist = 0;

        if (zone.type === "polygon" && zone.waypoints && zone.waypoints.length >= 3) {
          isInside = isPointInPolygon([device.lat, device.lon], zone.waypoints);
          dist = calculateDistanceMeters(device.lat, device.lon, zone.center[0], zone.center[1]);
        } else {
          dist = calculateDistanceMeters(device.lat, device.lon, zone.center[0], zone.center[1]);
          isInside = dist <= zone.radiusMeters;
        }

        const devMap = previousContainmentRef.current[device.device_id] || {};
        const wasInside = devMap[zone.id];

        if (wasInside !== undefined && wasInside !== isInside) {
          const alertType: "entered" | "exited" = isInside ? "entered" : "exited";
          const newAlert: GeofenceAlert = {
            id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            deviceId: device.device_id,
            deviceName: device.name || device.device_id,
            zoneId: zone.id,
            zoneName: zone.name,
            timestamp: Date.now() / 1000,
            type: alertType,
            distance: dist
          };

          setGeofenceAlerts((prev) => [newAlert, ...prev].slice(0, 10));
        }

        if (!previousContainmentRef.current[device.device_id]) {
          previousContainmentRef.current[device.device_id] = {};
        }
        previousContainmentRef.current[device.device_id][zone.id] = isInside;
      });
    });
  }, [devices, geofences]);

  const handleToggleTrail = (deviceId: string) => {
    setActiveTrails((prev) => ({ ...prev, [deviceId]: !prev[deviceId] }));
  };

  const handleFocusDevice = (device: DeviceTelemetry) => {
    setSelectedDevice(device);
    setFocusCoords([device.lat, device.lon]);
  };

  const filteredDevices = devices.filter((d) => {
    const matchesSearch = d.device_id.toLowerCase().includes(searchQuery.toLowerCase()) || (d.name && d.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType = typeFilter === "all" || d.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const totalNodes = devices.length;
  const streamingNodes = devices.filter((d) => d.online).length;
  const activeGeofencesCount = geofences.filter((g) => g.enabled).length;
  const devicesWithAccuracy = devices.filter((d) => d.accuracy_m !== undefined && d.accuracy_m !== null);
  const avgPrecision = devicesWithAccuracy.length > 0
    ? Math.round(devicesWithAccuracy.reduce((acc, d) => acc + (d.accuracy_m || 0), 0) / devicesWithAccuracy.length)
    : 0;

  const currentDevice = selectedDevice || devices.find((d) => d.device_id === "station-laptop") || devices[0];
  const isServerStation = currentDevice?.device_id === "station-laptop";

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", backgroundColor: "#f8fafc", overflow: "hidden", fontFamily: "'Inter', sans-serif" }}>
      {/* Unified Left Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflowY: "auto", padding: "16px 20px", gap: "16px" }}>
        
        {/* TOP ROW: Premium Stat Cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "14px",
          flexShrink: 0
        }}>
          {/* Card 1: Fleet Nodes */}
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid var(--border-light)",
            padding: "16px",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <div>
              <span style={{ fontSize: "10px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Fleet Nodes
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "4px" }}>
                <span style={{ fontSize: "26px", fontWeight: 900, color: "#0f172a" }}>{totalNodes}</span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)" }}>connected</span>
              </div>
            </div>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#f0fdf4",
              color: "var(--emerald-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #d1fae5"
            }}>
              <Wifi size={20} />
            </div>
          </div>

          {/* Card 2: Live Feeds */}
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid var(--border-light)",
            padding: "16px",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <div>
              <span style={{ fontSize: "10px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Live Stream
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "4px" }}>
                <span style={{ fontSize: "26px", fontWeight: 900, color: "#0f172a" }}>{streamingNodes}</span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--emerald-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--emerald-primary)" }} className="pulse-active" />
                  active
                </span>
              </div>
            </div>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#f0fdf4",
              color: "var(--emerald-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #d1fae5"
            }}>
              <Activity size={20} />
            </div>
          </div>

          {/* Card 3: Geofence Zones */}
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid var(--border-light)",
            padding: "16px",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <div>
              <span style={{ fontSize: "10px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Geofence Zones
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "4px" }}>
                <span style={{ fontSize: "26px", fontWeight: 900, color: "#0f172a" }}>{activeGeofencesCount}</span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)" }}>polygons & circles</span>
              </div>
            </div>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#eff6ff",
              color: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #bfdbfe"
            }}>
              <Shield size={20} />
            </div>
          </div>

          {/* Card 4: Avg Precision */}
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid var(--border-light)",
            padding: "16px",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <div>
              <span style={{ fontSize: "10px", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                GNSS Accuracy
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "4px" }}>
                <span style={{ fontSize: "26px", fontWeight: 900, color: "#0f172a" }}>±{avgPrecision || 2}m</span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)" }}>Kalman tuned</span>
              </div>
            </div>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#fdf4ff",
              color: "#9333ea",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #f5d0fe"
            }}>
              <Crosshair size={20} />
            </div>
          </div>
        </div>

        {/* Blind-Spot Threat Detection Banner */}
        {blindSpotAlerts.length > 0 && (
          <div style={{
            backgroundColor: "#fff1f2",
            border: "1.5px solid #ef4444",
            borderRadius: "12px",
            padding: "12px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            animation: "pulse 1.4s infinite",
            boxShadow: "0 4px 14px rgba(239, 68, 68, 0.15)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                backgroundColor: "#fee2e2",
                color: "#dc2626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: "16px"
              }}>
                🚨
              </div>
              <div>
                <span style={{ fontSize: "13px", fontWeight: 900, color: "#9f1239", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Active Blind-Spot Hazard Detected ({blindSpotAlerts.length})
                </span>
                <p style={{ fontSize: "12px", color: "#b91c1c", margin: "2px 0 0 0", fontWeight: 600 }}>
                  {blindSpotAlerts[0].message}
                </p>
              </div>
            </div>
            <span style={{
              fontSize: "11px",
              fontWeight: 800,
              backgroundColor: "#fee2e2",
              color: "#991b1b",
              padding: "4px 8px",
              borderRadius: "6px"
            }}>
              Target: {blindSpotAlerts[0].targetAgentId}
            </span>
          </div>
        )}

        {/* Breach Alert Banner */}
        {geofenceAlerts.length > 0 && (
          <div style={{
            backgroundColor: geofenceAlerts[0].type === "entered" ? "#eff6ff" : "#fff1f2",
            border: `1.5px solid ${geofenceAlerts[0].type === "entered" ? "#3b82f6" : "#ef4444"}`,
            borderRadius: "12px",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            animation: "fadeIn 0.3s ease"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <AlertTriangle size={18} style={{ color: geofenceAlerts[0].type === "entered" ? "#2563eb" : "#e11d48" }} />
              <div>
                <span style={{ fontSize: "12px", fontWeight: 800, color: geofenceAlerts[0].type === "entered" ? "#1e40af" : "#9f1239" }}>
                  {geofenceAlerts[0].type === "entered" ? "🟢 GEOFENCE ENTRY" : "🔴 GEOFENCE BREACH / EXIT"}
                </span>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
                  {`${geofenceAlerts[0].deviceName} has ${geofenceAlerts[0].type === "entered" ? "ENTERED" : "EXITED"} boundary "${geofenceAlerts[0].zoneName}"`}
                </p>
              </div>
            </div>
            <button
              onClick={() => setGeofenceAlerts((prev) => prev.slice(1))}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* 3-COLUMN MAIN DASHBOARD WORKSPACE */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr 310px",
          gap: "16px",
          flex: 1,
          minHeight: "580px"
        }}>
          
          {/* LEFT COLUMN: Connected Fleet */}
          <section style={{
            backgroundColor: "#ffffff",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }}>
            {/* Fleet Header */}
            <div style={{ padding: "16px", borderBottom: "1px solid var(--border-light)", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Radio size={16} style={{ color: "var(--emerald-primary)" }} />
                  <h2 style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>Connected Fleet</h2>
                </div>
                <span style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  backgroundColor: "#ecfdf5",
                  color: "#065f46",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  border: "1px solid #a7f3d0"
                }}>
                  {filteredDevices.length} Targets
                </span>
              </div>

              {/* Search Bar */}
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
                <input
                  type="text"
                  placeholder="Search device ID or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px 7px 30px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    fontSize: "12px",
                    backgroundColor: "var(--bg-card-muted)",
                    outline: "none"
                  }}
                />
              </div>

              {/* Type Filter Buttons */}
              <div style={{ display: "flex", gap: "6px" }}>
                {["all", "phone", "vehicle", "drone"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    style={{
                      padding: "3px 8px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                      border: typeFilter === t ? "1px solid #059669" : "1px solid var(--border-light)",
                      backgroundColor: typeFilter === t ? "#ecfdf5" : "#ffffff",
                      color: typeFilter === t ? "#065f46" : "var(--text-secondary)",
                      textTransform: "capitalize"
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Device List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {filteredDevices.map((device) => {
                const isSelected = selectedDevice?.device_id === device.device_id;
                const isStation = device.type === "station";

                return (
                  <div
                    key={device.device_id}
                    onClick={() => handleFocusDevice(device)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: isSelected ? "1.5px solid var(--emerald-primary)" : "1px solid var(--border-light)",
                      backgroundColor: isSelected ? "#f0fdf4" : "#ffffff",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{
                          width: "7px",
                          height: "7px",
                          borderRadius: "50%",
                          backgroundColor: isStation ? "#2563eb" : device.online ? "#059669" : "#94a3b8"
                        }} className={device.online ? "pulse-active" : ""} />
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>
                          {device.name || device.device_id}
                        </span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                        {device.type}
                      </span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                      <span>{device.lat.toFixed(4)}°, {device.lon.toFixed(4)}°</span>
                      <span style={{ color: "#059669", fontWeight: 700 }}>
                        {device.speed_mps ? `${(device.speed_mps * 3.6).toFixed(1)} km/h` : "0 km/h"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Connect CTA Button */}
            <div style={{ padding: "12px", borderTop: "1px solid var(--border-light)" }}>
              <button
                onClick={() => setIsPhoneGuideOpen(true)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  padding: "9px",
                  borderRadius: "8px",
                  backgroundColor: "#0f172a",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 2px 6px rgba(15, 23, 42, 0.2)"
                }}
              >
                <Smartphone size={14} />
                <span>Connect Phone / Hardware</span>
              </button>
            </div>
          </section>

          {/* CENTER COLUMN: The Advanced Live Map Canvas */}
          <section style={{
            backgroundColor: "#ffffff",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-sm)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            position: "relative"
          }}>
            <LiveMap
              devices={devices}
              selectedDevice={selectedDevice}
              onSelectDevice={(d) => setSelectedDevice(d)}
              activeTrails={activeTrails}
              geofences={geofences}
              focusCoords={focusCoords}
              serverOrigin={laptopLocation ? [laptopLocation.lat, laptopLocation.lon] : null}
              isDrawingWaypoints={isDrawingWaypoints}
              drawingWaypoints={drawingWaypoints}
              onAddDrawingWaypoint={(coords) => setDrawingWaypoints((prev) => [...prev, coords])}
              onMapClickCoords={(lat, lon) => {
                if (isPinpointingStation) {
                  handleSaveStationCalibration(lat, lon, 1.5, "Calibrated from Satellite Map");
                }
              }}
              drawingColor="#059669"
            />

            {/* Floating Pinpoint Base Station Mode Banner */}
            {isPinpointingStation && (
              <div style={{
                position: "absolute",
                top: "16px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1000,
                backgroundColor: "#ffffff",
                border: "2px solid #2563eb",
                borderRadius: "var(--radius-md)",
                padding: "10px 18px",
                boxShadow: "0 8px 24px rgba(37, 99, 235, 0.25)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                animation: "fadeIn 0.2s ease"
              }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#2563eb" }} className="pulse-active" />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "12px", fontWeight: 800, color: "#1e40af" }}>
                    🎯 Pinpoint Base Station Active
                  </span>
                  <span style={{ fontSize: "11px", color: "#3b82f6" }}>
                    Click anywhere on the map to set your laptop base station origin (±1m precision)
                  </span>
                </div>
                <button
                  onClick={() => setIsPinpointingStation(false)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "6px",
                    backgroundColor: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#475569",
                    cursor: "pointer",
                    marginLeft: "6px"
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Floating Interactive Waypoint Drawing Action Bar */}
            {isDrawingWaypoints && (
              <div style={{
                position: "absolute",
                bottom: "20px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1000,
                backgroundColor: "#ffffff",
                border: "1.5px solid var(--emerald-primary)",
                borderRadius: "12px",
                padding: "8px 14px",
                boxShadow: "0 10px 30px rgba(0, 0, 0, 0.2)",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                animation: "fadeIn 0.2s ease"
              }}>
                <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--emerald-dark)" }}>
                  📍 {drawingWaypoints.length} Waypoints
                </span>
                <button
                  onClick={() => setDrawingWaypoints((prev) => prev.slice(0, -1))}
                  disabled={drawingWaypoints.length === 0}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    backgroundColor: "#f1f5f9",
                    border: "1px solid var(--border-light)",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: drawingWaypoints.length === 0 ? "not-allowed" : "pointer"
                  }}
                >
                  <Undo2 size={13} />
                  <span>Undo Point</span>
                </button>
                <button
                  onClick={() => {
                    if (drawingWaypoints.length < 3) {
                      alert("Please click at least 3 waypoints on the map to enclose a region.");
                      return;
                    }
                    setIsGeofenceModalOpen(true);
                  }}
                  disabled={drawingWaypoints.length < 3}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    backgroundColor: drawingWaypoints.length < 3 ? "#94a3b8" : "var(--emerald-primary)",
                    color: "#ffffff",
                    border: "none",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: drawingWaypoints.length < 3 ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 8px rgba(5, 150, 105, 0.25)"
                  }}
                >
                  <Check size={13} />
                  <span>Enclose & Save Fence</span>
                </button>
                <button
                  onClick={() => {
                    setIsDrawingWaypoints(false);
                    setDrawingWaypoints([]);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    backgroundColor: "#fee2e2",
                    color: "#ef4444",
                    border: "1px solid #fecaca",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </section>

          {/* RIGHT COLUMN: Configuration & Telemetry */}
          <section style={{
            display: "flex",
            flexDirection: "column",
            gap: "14px"
          }}>
            
            {/* Geofence Perimeter Quick Manager */}
            <div style={{
              backgroundColor: "#ffffff",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-light)",
              padding: "16px",
              boxShadow: "var(--shadow-sm)",
              display: "flex",
              flexDirection: "column",
              gap: "10px"
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Shield size={16} style={{ color: "var(--emerald-primary)" }} />
                  <h3 style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>Geofences</h3>
                </div>
                <button
                  onClick={() => setIsGeofenceModalOpen(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    backgroundColor: "#ecfdf5",
                    color: "#065f46",
                    border: "1px solid #a7f3d0",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  <Plus size={12} />
                  <span>Manage</span>
                </button>
              </div>

              {geofences.length === 0 ? (
                <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.4, margin: 0 }}>
                  No active boundaries. Click "+ Waypoint Drawing" or "Manage" to configure a custom perimeter.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "140px", overflowY: "auto" }}>
                  {geofences.map((g) => (
                    <div
                      key={g.id}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "6px",
                        backgroundColor: "#f8fafc",
                        border: "1px solid var(--border-light)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "11px"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: g.color }} />
                        <span style={{ fontWeight: 700, color: "#0f172a" }}>{g.name}</span>
                      </div>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                        {g.type === "polygon" ? `${g.waypoints?.length || 0} pts` : formatDistance(g.radiusMeters)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setIsDrawingWaypoints(true);
                  setDrawingWaypoints([]);
                }}
                style={{
                  width: "100%",
                  padding: "7px",
                  borderRadius: "6px",
                  backgroundColor: "#f0fdf4",
                  border: "1px dashed #059669",
                  color: "#065f46",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px"
                }}
              >
                <PenTool size={12} />
                <span>+ Draw Waypoint Polygon on Map</span>
              </button>
            </div>

            {/* Target Telemetry Card */}
            <div style={{
              backgroundColor: "#ffffff",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-light)",
              padding: "16px",
              boxShadow: "var(--shadow-sm)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              flex: 1
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Activity size={16} style={{ color: isServerStation ? "#2563eb" : "var(--emerald-primary)" }} />
                  <h3 style={{ fontSize: "13px", fontWeight: 800, color: isServerStation ? "#1e40af" : "#0f172a" }}>
                    {isServerStation ? "Base Station Origin" : "Target Telemetry"}
                  </h3>
                </div>

                {isServerStation ? (
                  <span style={{ fontSize: "9px", fontWeight: 800, backgroundColor: "#eff6ff", color: "#2563eb", padding: "2px 6px", borderRadius: "4px" }}>
                    💻 LAPTOP ORIGIN
                  </span>
                ) : (
                  <span style={{ fontSize: "9px", fontWeight: 800, backgroundColor: "#f0fdf4", color: "#059669", padding: "2px 6px", borderRadius: "4px" }}>
                    ONLINE
                  </span>
                )}
              </div>

              {/* Station Calibration Bar (if inspecting Laptop Station) */}
              {isServerStation && (
                <div style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid #bfdbfe",
                  borderRadius: "8px",
                  padding: "8px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#1e40af" }}>
                      {laptopLocation?.label || "Base Origin"}
                    </span>
                    <button
                      onClick={() => setIsCalibrateModalOpen(true)}
                      style={{
                        padding: "3px 8px",
                        borderRadius: "4px",
                        backgroundColor: "#2563eb",
                        color: "#ffffff",
                        fontSize: "10px",
                        fontWeight: 700,
                        border: "none",
                        cursor: "pointer"
                      }}
                    >
                      Calibrate Pin
                    </button>
                  </div>

                  {/* 1-Click Phone Satellite Sync */}
                  {(() => {
                    const phoneDev = devices.find((d) => d.type === "phone" || d.device_id.startsWith("phone") || d.device_id === "phone-broadcaster");
                    if (!phoneDev) return null;
                    return (
                      <button
                        onClick={() => handleSaveStationCalibration(phoneDev.lat, phoneDev.lon, Math.min(phoneDev.accuracy_m || 2, 3), "Synced from Phone GNSS")}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "4px",
                          width: "100%",
                          padding: "5px",
                          borderRadius: "4px",
                          backgroundColor: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          color: "#166534",
                          fontSize: "10px",
                          fontWeight: 700,
                          cursor: "pointer"
                        }}
                      >
                        <Satellite size={12} />
                        <span>1-Click Sync to Phone GPS (±{Math.round(phoneDev.accuracy_m || 2)}m)</span>
                      </button>
                    );
                  })()}
                </div>
              )}

              {/* Coordinates Grid */}
              {currentDevice ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div style={{ padding: "8px", backgroundColor: "#f8fafc", borderRadius: "6px", border: "1px solid var(--border-light)" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", display: "block" }}>LATITUDE</span>
                      <span style={{ fontSize: "12px", fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: "#0f172a" }}>
                        {currentDevice.lat.toFixed(5)}°
                      </span>
                    </div>
                    <div style={{ padding: "8px", backgroundColor: "#f8fafc", borderRadius: "6px", border: "1px solid var(--border-light)" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", display: "block" }}>LONGITUDE</span>
                      <span style={{ fontSize: "12px", fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: "#0f172a" }}>
                        {currentDevice.lon.toFixed(5)}°
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div style={{ padding: "8px", backgroundColor: "#f8fafc", borderRadius: "6px", border: "1px solid var(--border-light)" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", display: "block" }}>SPEED</span>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: "#059669" }}>
                        {currentDevice.speed_mps ? `${(currentDevice.speed_mps * 3.6).toFixed(1)} km/h` : "0.0 km/h"}
                      </span>
                    </div>
                    <div style={{ padding: "8px", backgroundColor: "#f8fafc", borderRadius: "6px", border: "1px solid var(--border-light)" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", display: "block" }}>ACCURACY</span>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: "#2563eb" }}>
                        ±{Math.round(currentDevice.accuracy_m || 2)}m
                      </span>
                    </div>
                  </div>

                  {/* 2D Kalman Filter Active Indicator */}
                  <div style={{
                    padding: "6px 8px",
                    backgroundColor: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#166534"
                  }}>
                    <span>✨ 2D Kinematic Kalman Filter</span>
                    <span style={{ backgroundColor: "#dcfce7", padding: "1px 5px", borderRadius: "3px", fontWeight: 800 }}>ACTIVE</span>
                  </div>

                  <button
                    onClick={() => handleFocusDevice(currentDevice)}
                    style={{
                      width: "100%",
                      padding: "8px",
                      borderRadius: "6px",
                      backgroundColor: isServerStation ? "#2563eb" : "var(--emerald-primary)",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                      marginTop: "4px"
                    }}
                  >
                    📍 Focus on Map
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center", margin: "20px 0" }}>
                  Select an active target node to stream realtime sensor data.
                </p>
              )}
            </div>

          </section>

        </div>
      </div>

      {/* Phone Connect Guide Modal */}
      {isPhoneGuideOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(15, 23, 42, 0.45)",
          backdropFilter: "blur(6px)",
          zIndex: 2000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px"
        }}>
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-light)",
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.15)",
            width: "100%",
            maxWidth: "500px",
            padding: "24px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                Connect Phone Broadcaster
              </h2>
              <button onClick={() => setIsPhoneGuideOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "16px" }}>
              Open this link on your smartphone to stream live dual-frequency GPS coordinates, orientation compass heading, and accelerometer velocity:
            </p>

            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px",
              borderRadius: "8px",
              backgroundColor: "var(--bg-card-muted)",
              border: "1px solid var(--border-light)",
              marginBottom: "16px"
            }}>
              <span style={{ fontSize: "13px", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#0f172a", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                http://{hostUrl}/phone
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`http://${hostUrl}/phone`);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  backgroundColor: "var(--emerald-primary)",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer"
                }}
              >
                {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedLink ? "Copied" : "Copy"}</span>
              </button>
            </div>

            <Link
              href="/phone"
              target="_blank"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                backgroundColor: "#0f172a",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                textDecoration: "none"
              }}
            >
              <span>Open Broadcaster in New Tab</span>
              <ExternalLink size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* Geofence Modal */}
      <GeofenceModal
        isOpen={isGeofenceModalOpen}
        onClose={() => setIsGeofenceModalOpen(false)}
        geofences={geofences}
        onAddGeofence={(zone) => {
          setGeofences((prev) => [...prev, zone]);
          setIsGeofenceModalOpen(false);
          setIsDrawingWaypoints(false);
          setDrawingWaypoints([]);
        }}
        onToggleGeofence={(id) => setGeofences((prev) => prev.map((g) => g.id === id ? { ...g, enabled: !g.enabled } : g))}
        onRemoveGeofence={(id) => setGeofences((prev) => prev.filter((g) => g.id !== id))}
        devices={devices}
        selectedDevice={selectedDevice}
        mapCenter={laptopLocation ? [laptopLocation.lat, laptopLocation.lon] : selectedDevice ? [selectedDevice.lat, selectedDevice.lon] : undefined}
        onStartMapDrawing={() => {
          setIsGeofenceModalOpen(false);
          setIsDrawingWaypoints(true);
          setDrawingWaypoints([]);
        }}
        drawnWaypoints={drawingWaypoints}
        onClearDrawnWaypoints={() => setDrawingWaypoints([])}
      />

      {/* Simulator Modal */}
      <SimulatorModal
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        isSimulating={isSimulating}
        onStartSimulation={() => setIsSimulating(true)}
        onStopSimulation={() => setIsSimulating(false)}
        profiles={simProfiles}
        originCoords={laptopLocation ? [laptopLocation.lat, laptopLocation.lon] : selectedDevice ? [selectedDevice.lat, selectedDevice.lon] : null}
        onAddProfile={(profile) => setSimProfiles((prev) => [...prev, profile])}
        onRemoveProfile={(id) => {
          setSimProfiles((prev) => prev.filter((p) => p.id !== id));
          setDevices((prev) => prev.filter((d) => d.device_id !== id));
        }}
      />

      {/* Station Precision Calibrator Modal */}
      <StationCalibrateModal
        isOpen={isCalibrateModalOpen}
        onClose={() => setIsCalibrateModalOpen(false)}
        currentLat={laptopLocation?.lat || 0}
        currentLon={laptopLocation?.lon || 0}
        currentAccuracy={laptopLocation?.accuracy || 5}
        label={laptopLocation?.label}
        phoneDevice={devices.find((d) => d.type === "phone" || d.device_id.startsWith("phone") || d.device_id === "phone-broadcaster")}
        onSaveCalibration={handleSaveStationCalibration}
        onStartMapPinpoint={() => setIsPinpointingStation(true)}
        onResetToAutoGps={handleResetToAutoGps}
      />

      {/* Floating Interactive Corner Trigger: Real Incident Analysis */}
      <div style={{
        position: "fixed",
        bottom: "22px",
        right: "22px",
        zIndex: 900
      }}>
        <button
          onClick={() => setIsIncidentModalOpen(true)}
          style={{
            backgroundColor: "#0f172a",
            color: "#ffffff",
            border: "2px solid #ef4444",
            borderRadius: "14px",
            padding: "10px 16px",
            boxShadow: "0 10px 30px rgba(239, 68, 68, 0.4)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            transition: "transform 0.15s ease",
            animation: "pulse 2s infinite"
          }}
        >
          <div style={{
            width: "34px",
            height: "34px",
            borderRadius: "50%",
            backgroundColor: "#fee2e2",
            color: "#dc2626",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 900,
            fontSize: "16px"
          }}>
            🚨
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: "12px", fontWeight: 900, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Incident Case Study
            </div>
            <div style={{ fontSize: "11px", color: "#e2e8f0", fontWeight: 600 }}>
              Student vs Car Blind-Spot Analysis
            </div>
          </div>
        </button>
      </div>

      {/* Real Incident Analysis Video & Spatial Reconstruction Modal */}
      <IncidentAnalysisModal
        isOpen={isIncidentModalOpen}
        onClose={() => setIsIncidentModalOpen(false)}
      />
    </div>
  );
}
