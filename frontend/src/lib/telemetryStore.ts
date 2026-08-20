import { DeviceTelemetry, BlindSpotAlert, ThreatDetection } from "./types";
import { calculateFovPolygon, projectThreatToGlobal, checkBlindSpotThreats, isOutsideFov } from "./geo";

interface StoredThreat {
  threat_id: string;
  source_id: string;
  threat_lat: number;
  threat_lon: number;
  label: string;
  level: string;
  created_at: number;
  expires_at: number;
}

// Global telemetry store and subscriber registry across Next.js requests
const globalStore = globalThis as unknown as {
  telemetryStore?: Record<string, DeviceTelemetry>;
  telemetrySubscribers?: Set<(data: any) => void>;
  activeBlindSpotAlerts?: BlindSpotAlert[];
  threatsStore?: Record<string, StoredThreat>;
};

if (!globalStore.telemetryStore) {
  globalStore.telemetryStore = {};
}
if (!globalStore.telemetrySubscribers) {
  globalStore.telemetrySubscribers = new Set();
}
if (!globalStore.activeBlindSpotAlerts) {
  globalStore.activeBlindSpotAlerts = [];
}
if (!globalStore.threatsStore) {
  globalStore.threatsStore = {};
}

export function broadcastTelemetryUpdate(data: any) {
  if (globalStore.telemetrySubscribers) {
    globalStore.telemetrySubscribers.forEach((cb) => {
      try {
        cb(data);
      } catch (e) {}
    });
  }
}

export function getTelemetryStore(): Record<string, DeviceTelemetry> {
  return globalStore.telemetryStore || {};
}

export function getActiveBlindSpotAlerts(): BlindSpotAlert[] {
  return globalStore.activeBlindSpotAlerts || [];
}

export function purgeExpiredThreats(ttlSeconds = 3.0) {
  const now = Date.now();
  if (globalStore.threatsStore) {
    Object.keys(globalStore.threatsStore).forEach((tid) => {
      if (now > globalStore.threatsStore![tid].expires_at) {
        delete globalStore.threatsStore![tid];
      }
    });
  }
}

export function processTelemetryPacket(rawPayload: any): {
  device: DeviceTelemetry;
  blindSpotAlerts: BlindSpotAlert[];
} {
  const deviceId = rawPayload.agent_id || rawPayload.device_id || "unknown";
  const heading = rawPayload.heading_deg ?? rawPayload.heading ?? 0;
  const hfov = rawPayload.camera_hfov_deg ?? 70;
  const pitch = rawPayload.pitch_deg ?? rawPayload.pitch ?? 0;

  // 1. Calculate Field of View (FOV) polygon
  const fovPolygon = calculateFovPolygon(
    rawPayload.lat,
    rawPayload.lon,
    heading,
    hfov,
    40
  );

  // 2. Project all detections to global coordinates
  const now = Date.now();
  const projectedThreats: ThreatDetection[] = (rawPayload.detections || []).map((det: any) => {
    let gLat = det.globalLat;
    let gLon = det.globalLon;

    if (!gLat || !gLon) {
      const [pLat, pLon] = projectThreatToGlobal(
        rawPayload.lat,
        rawPayload.lon,
        heading,
        det
      );
      gLat = pLat;
      gLon = pLon;
    }

    // Register in 3-second TTL threats store
    const threatKey = `thr:${deviceId}:${det.class || 'threat'}`;
    if (globalStore.threatsStore) {
      globalStore.threatsStore[threatKey] = {
        threat_id: threatKey,
        source_id: deviceId,
        threat_lat: gLat,
        threat_lon: gLon,
        label: det.class || 'threat',
        level: 'danger',
        created_at: now,
        expires_at: now + 3000 // 3 seconds TTL
      };
    }

    return {
      ...det,
      globalLat: gLat,
      globalLon: gLon
    };
  });

  purgeExpiredThreats();

  const existing = globalStore.telemetryStore?.[deviceId];
  const history = existing?.history || [];
  if (rawPayload.lat && rawPayload.lon) {
    history.push({
      lat: rawPayload.lat,
      lon: rawPayload.lon,
      timestamp: rawPayload.timestamp || Date.now(),
      heading,
      speed_mps: rawPayload.speed_mps
    });
    if (history.length > 50) history.shift();
  }

  const devicePayload: DeviceTelemetry = {
    ...rawPayload,
    device_id: deviceId,
    agent_id: deviceId,
    type: rawPayload.type || 'phone',
    heading,
    heading_deg: heading,
    pitch,
    pitch_deg: pitch,
    camera_hfov_deg: hfov,
    fov_polygon: fovPolygon,
    detections: projectedThreats,
    projected_threats: projectedThreats,
    history,
    online: true,
    server_time: Date.now() / 1000
  };

  if (globalStore.telemetryStore) {
    globalStore.telemetryStore[deviceId] = devicePayload;
  }

  // 3. Run FOV Blind-Spot Check (70° FOV cone, 40m max range)
  const activeAgents = Object.values(globalStore.telemetryStore || {});
  const alerts = checkBlindSpotThreats(activeAgents, 40, 70);
  globalStore.activeBlindSpotAlerts = alerts;

  return {
    device: devicePayload,
    blindSpotAlerts: alerts
  };
}

export function setTelemetryDevice(deviceId: string, payload: DeviceTelemetry) {
  if (globalStore.telemetryStore) {
    globalStore.telemetryStore[deviceId] = payload;
  }
}

export function removeTelemetryDevice(deviceId: string) {
  if (globalStore.telemetryStore && globalStore.telemetryStore[deviceId]) {
    delete globalStore.telemetryStore[deviceId];
  }
}

export function clearAllTelemetry() {
  globalStore.telemetryStore = {};
  globalStore.activeBlindSpotAlerts = [];
  globalStore.threatsStore = {};
}

export function addTelemetrySubscriber(cb: (data: any) => void) {
  globalStore.telemetrySubscribers?.add(cb);
  return () => globalStore.telemetrySubscribers?.delete(cb);
}
