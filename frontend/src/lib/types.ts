export type DeviceType = 'phone' | 'raspberry-pi' | 'vehicle' | 'drone' | 'sensor' | 'station';

export interface LocationPoint {
  lat: number;
  lon: number;
  timestamp: number;
  speed_mps?: number | null;
  altitude_m?: number | null;
  heading?: number | null;
}

export interface ThreatDetection {
  class: string;
  bbox?: [number, number, number, number]; // [x, y, w, h]
  confidence: number;
  bearing_deg: number; // absolute bearing (or relative to agent heading)
  est_distance_m: number;
  globalLat?: number;
  globalLon?: number;
}

export interface BlindSpotAlert {
  id: string;
  targetAgentId: string; // The agent in danger who cannot see the threat
  sourceAgentId: string; // The agent that detected the threat
  threatClass: string;
  threatLat: number;
  threatLon: number;
  distanceToTargetM: number;
  bearingFromTargetDeg: number;
  relativePosition: 'behind' | 'left_flank' | 'right_flank' | 'obscured';
  message: string;
  timestamp: number;
}

export interface DeviceTelemetry {
  device_id: string;
  agent_id?: string;
  name?: string;
  type: DeviceType;
  lat: number;
  lon: number;
  heading?: number | null;
  heading_deg?: number | null;
  pitch?: number | null;
  pitch_deg?: number | null;
  roll?: number | null;
  camera_hfov_deg?: number | null; // e.g. 68 degrees
  accuracy_m?: number | null;
  speed_mps?: number | null;
  altitude_m?: number | null;
  battery?: number | null;
  timestamp: number;
  server_time?: number;
  online: boolean;
  color?: string;
  history?: LocationPoint[];
  detections?: ThreatDetection[];
  fov_polygon?: [number, number][]; // Computed FOV vision cone polygon
  projected_threats?: ThreatDetection[];
  blind_spot_alerts?: BlindSpotAlert[];
  camera_frame_base64?: string; // Live JPEG frame snapshot from phone camera
}

export interface SimulationProfile {
  id: string;
  name: string;
  type: DeviceType;
  startLat: number;
  startLon: number;
  speedKmh: number;
  pattern: 'circle' | 'patrol' | 'linear' | 'random';
  color: string;
}

export type GeofenceType = 'circle' | 'polygon';

export interface GeofenceZone {
  id: string;
  name: string;
  type?: GeofenceType; // 'circle' | 'polygon'
  center: [number, number]; // [lat, lon]
  radiusMeters: number;
  waypoints?: [number, number][]; // [lat, lon] array for multi-waypoint perimeter
  alertOnEnter: boolean;
  alertOnExit: boolean;
  color: string;
  enabled: boolean;
}

export interface GeofenceAlert {
  id: string;
  deviceId: string;
  deviceName: string;
  zoneId: string;
  zoneName: string;
  type: 'entered' | 'exited';
  distance: number;
  timestamp: number;
}
