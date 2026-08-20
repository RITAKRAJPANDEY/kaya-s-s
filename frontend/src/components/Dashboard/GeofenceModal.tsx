"use client";

import React, { useState } from "react";
import { GeofenceZone, DeviceTelemetry, GeofenceType } from "@/lib/types";
import { 
  calculateDistanceMeters, 
  formatDistance, 
  isPointInPolygon, 
  calculatePolygonCentroid, 
  calculatePolygonPerimeterMeters, 
  calculatePolygonAreaMeters, 
  formatArea 
} from "@/lib/geo";
import { 
  ShieldCheck, 
  Plus, 
  Trash2, 
  X, 
  MapPin, 
  Bell, 
  Check, 
  Target, 
  AlertTriangle,
  Eye,
  EyeOff,
  Circle,
  Hexagon,
  PenTool,
  RotateCcw
} from "lucide-react";

interface GeofenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  geofences: GeofenceZone[];
  onAddGeofence: (zone: GeofenceZone) => void;
  onToggleGeofence: (id: string) => void;
  onRemoveGeofence: (id: string) => void;
  devices: DeviceTelemetry[];
  selectedDevice: DeviceTelemetry | null;
  mapCenter?: [number, number];
  onStartMapDrawing?: () => void;
  drawnWaypoints?: [number, number][];
  onClearDrawnWaypoints?: () => void;
}

const COLOR_PRESETS = [
  { name: "Emerald", value: "#059669" },
  { name: "Mint", value: "#10b981" },
  { name: "Forest", value: "#064e3b" },
  { name: "Amber", value: "#d97706" },
  { name: "Rose", value: "#e11d48" },
  { name: "Indigo", value: "#4f46e5" },
];

export default function GeofenceModal({
  isOpen,
  onClose,
  geofences,
  onAddGeofence,
  onToggleGeofence,
  onRemoveGeofence,
  devices,
  selectedDevice,
  mapCenter,
  onStartMapDrawing,
  drawnWaypoints = [],
  onClearDrawnWaypoints
}: GeofenceModalProps) {
  const defaultLat = mapCenter ? mapCenter[0].toFixed(6) : "0.000000";
  const defaultLon = mapCenter ? mapCenter[1].toFixed(6) : "0.000000";
  const [fenceType, setFenceType] = useState<GeofenceType>("circle");
  const [name, setName] = useState("");
  const [lat, setLat] = useState<string>(defaultLat);
  const [lon, setLon] = useState<string>(defaultLon);
  const [radius, setRadius] = useState<number>(300);
  const [waypoints, setWaypoints] = useState<[number, number][]>([]);
  const [alertOnExit, setAlertOnExit] = useState(true);
  const [alertOnEnter, setAlertOnEnter] = useState(true);
  const [selectedColor, setSelectedColor] = useState("#059669");

  // Keep coords synced with mapCenter if opened
  React.useEffect(() => {
    if (mapCenter && (!lat || lat === "0.000000")) {
      setLat(mapCenter[0].toFixed(6));
      setLon(mapCenter[1].toFixed(6));
    }
  }, [mapCenter, isOpen]);

  // If waypoints were drawn interactively on map, sync them into modal state
  React.useEffect(() => {
    if (drawnWaypoints && drawnWaypoints.length > 0) {
      setWaypoints(drawnWaypoints);
      setFenceType("polygon");
    }
  }, [drawnWaypoints]);

  if (!isOpen) return null;

  const handleUseDeviceLocation = () => {
    if (selectedDevice) {
      setLat(selectedDevice.lat.toFixed(6));
      setLon(selectedDevice.lon.toFixed(6));
    } else if (devices.length > 0) {
      setLat(devices[0].lat.toFixed(6));
      setLon(devices[0].lon.toFixed(6));
    }
  };

  const handleUseMapCenter = () => {
    if (mapCenter) {
      setLat(mapCenter[0].toFixed(6));
      setLon(mapCenter[1].toFixed(6));
    }
  };

  // Add waypoint to manual list
  const handleAddWaypoint = () => {
    const baseLat = parseFloat(lat) || mapCenter?.[0] || 0;
    const baseLon = parseFloat(lon) || mapCenter?.[1] || 0;
    const offset = (waypoints.length + 1) * 0.0015;
    setWaypoints((prev) => [...prev, [baseLat + offset, baseLon + offset]]);
  };

  const handleUpdateWaypoint = (index: number, newLat: number, newLon: number) => {
    setWaypoints((prev) => {
      const next = [...prev];
      next[index] = [newLat, newLon];
      return next;
    });
  };

  const handleRemoveWaypoint = (index: number) => {
    setWaypoints((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (fenceType === "polygon") {
      if (waypoints.length < 3) {
        alert("A waypoint geofence requires at least 3 waypoints to form an enclosed perimeter.");
        return;
      }

      const centroid = calculatePolygonCentroid(waypoints);
      const newZone: GeofenceZone = {
        id: `zone-poly-${Date.now()}`,
        name: name.trim() || `Waypoint Zone ${geofences.length + 1}`,
        type: "polygon",
        center: centroid,
        radiusMeters: 0,
        waypoints,
        alertOnEnter,
        alertOnExit,
        color: selectedColor,
        enabled: true
      };

      onAddGeofence(newZone);
      setName("");
      setWaypoints([]);
      if (onClearDrawnWaypoints) onClearDrawnWaypoints();
      return;
    }

    // Circular fence
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    if (isNaN(latNum) || isNaN(lonNum)) {
      alert("Please enter valid decimal coordinates for latitude and longitude.");
      return;
    }
    if (radius <= 0) {
      alert("Radius must be greater than 0 meters.");
      return;
    }

    const newZone: GeofenceZone = {
      id: `zone-${Date.now()}`,
      name: name.trim() || `Geofence ${geofences.length + 1}`,
      type: "circle",
      center: [latNum, lonNum],
      radiusMeters: radius,
      alertOnEnter,
      alertOnExit,
      color: selectedColor,
      enabled: true
    };

    onAddGeofence(newZone);
    setName("");
  };

  return (
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
        boxShadow: "0 20px 40px rgba(6, 78, 59, 0.15)",
        width: "100%",
        maxWidth: "620px",
        maxHeight: "90vh",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Modal Header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--border-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              backgroundColor: "var(--bg-green-tint)",
              color: "var(--emerald-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: "17px", fontWeight: 800, color: "var(--emerald-dark)" }}>
                Geofence Perimeter Manager
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "1px" }}>
                Define coordinates and radius thresholds with automatic breach detection
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: "4px"
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
          
          {/* Active Geofences List */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <label style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-secondary)" }}>
                Configured Geofences ({geofences.length})
              </label>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {geofences.map((zone) => {
                // Calculate device containment stats (Circle vs Polygon)
                const isPoly = zone.type === "polygon" && zone.waypoints && zone.waypoints.length >= 3;
                const devicesInside = devices.filter((d) => {
                  if (isPoly && zone.waypoints) {
                    return isPointInPolygon([d.lat, d.lon], zone.waypoints);
                  }
                  const dist = calculateDistanceMeters(d.lat, d.lon, zone.center[0], zone.center[1]);
                  return dist <= zone.radiusMeters;
                });

                const perimeter = isPoly && zone.waypoints ? calculatePolygonPerimeterMeters(zone.waypoints) : 0;
                const area = isPoly && zone.waypoints ? calculatePolygonAreaMeters(zone.waypoints) : 0;

                return (
                  <div
                    key={zone.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 14px",
                      backgroundColor: zone.enabled ? "#ffffff" : "#f8fafc",
                      border: `1.5px solid ${zone.enabled ? zone.color : "var(--border-light)"}`,
                      borderRadius: "10px",
                      opacity: zone.enabled ? 1 : 0.65,
                      transition: "all 0.2s"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{
                        width: "12px",
                        height: "12px",
                        borderRadius: "50%",
                        backgroundColor: zone.color
                      }} />
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span>{zone.name}</span>
                          <span style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor: "var(--bg-green-tint)",
                            color: "var(--emerald-dark)"
                          }}>
                            {isPoly && zone.waypoints ? `📍 ${zone.waypoints.length} Waypoints · ${formatDistance(perimeter)}` : `🔵 ${formatDistance(zone.radiusMeters)} radius`}
                          </span>
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", fontFamily: "'JetBrains Mono', monospace" }}>
                          {zone.center[0].toFixed(5)}°, {zone.center[1].toFixed(5)}°
                          {isPoly && area > 0 && ` (${formatArea(area)})`}
                          {devices.length > 0 && (
                            <span style={{ marginLeft: "8px", fontWeight: 600, color: devicesInside.length > 0 ? "var(--emerald-primary)" : "var(--text-muted)" }}>
                              · {devicesInside.length} of {devices.length} devices inside
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        onClick={() => onToggleGeofence(zone.id)}
                        title={zone.enabled ? "Disable Geofence" : "Enable Geofence"}
                        style={{
                          background: "none",
                          border: "1px solid var(--border-light)",
                          borderRadius: "6px",
                          padding: "5px 8px",
                          cursor: "pointer",
                          color: zone.enabled ? "var(--emerald-primary)" : "var(--text-muted)",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "11px",
                          fontWeight: 600
                        }}
                      >
                        {zone.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                        <span>{zone.enabled ? "Active" : "Muted"}</span>
                      </button>

                      <button
                        onClick={() => onRemoveGeofence(zone.id)}
                        title="Delete Geofence"
                        style={{
                          background: "none",
                          border: "none",
                          color: "#94a3b8",
                          cursor: "pointer",
                          padding: "6px"
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {geofences.length === 0 && (
                <div style={{
                  textAlign: "center",
                  padding: "20px",
                  border: "1px dashed var(--border-light)",
                  borderRadius: "8px",
                  color: "var(--text-muted)",
                  fontSize: "12px"
                }}>
                  No geofences defined yet. Use the form below to create a circle or waypoint polygon boundary.
                </div>
              )}
            </div>
          </div>

          {/* Form to Create New Geofence */}
          <form onSubmit={handleSubmit} style={{
            backgroundColor: "var(--bg-card-muted)",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            gap: "14px"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--emerald-dark)", display: "flex", alignItems: "center", gap: "6px" }}>
                <Plus size={16} />
                <span>Create New Geofence</span>
              </div>

              {/* Mode Selector Tabs */}
              <div style={{ display: "flex", gap: "4px", backgroundColor: "#ffffff", padding: "3px", borderRadius: "8px", border: "1px solid var(--border-light)" }}>
                <button
                  type="button"
                  onClick={() => setFenceType("circle")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    backgroundColor: fenceType === "circle" ? "var(--bg-green-tint)" : "transparent",
                    color: fenceType === "circle" ? "var(--emerald-primary)" : "var(--text-secondary)"
                  }}
                >
                  <Circle size={13} />
                  <span>Circle Fence</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFenceType("polygon")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    backgroundColor: fenceType === "polygon" ? "var(--bg-green-tint)" : "transparent",
                    color: fenceType === "polygon" ? "var(--emerald-primary)" : "var(--text-secondary)"
                  }}
                >
                  <Hexagon size={13} />
                  <span>Waypoint Polygon</span>
                </button>
              </div>
            </div>

            {/* Zone Name */}
            <div>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                Zone Label / Identifier
              </label>
              <input
                type="text"
                placeholder={fenceType === "circle" ? "e.g. Field Operations Base, Sector Alpha" : "e.g. Flight Test Perimeter, Perimeter Alpha"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-light)",
                  fontSize: "13px",
                  backgroundColor: "#ffffff",
                  outline: "none"
                }}
              />
            </div>

            {/* CIRCLE MODE INPUTS */}
            {fenceType === "circle" ? (
              <>
                {/* Latitude & Longitude Coordinates */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                      Center Latitude (decimal °)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 18.520430"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-light)",
                        fontSize: "13px",
                        fontFamily: "'JetBrains Mono', monospace",
                        backgroundColor: "#ffffff",
                        outline: "none"
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                      Center Longitude (decimal °)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 73.856743"
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-light)",
                        fontSize: "13px",
                        fontFamily: "'JetBrains Mono', monospace",
                        backgroundColor: "#ffffff",
                        outline: "none"
                      }}
                    />
                  </div>
                </div>

                {/* Coordinate Fill Shortcuts */}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={handleUseMapCenter}
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "5px 10px",
                      borderRadius: "6px",
                      backgroundColor: "#ffffff",
                      border: "1px solid var(--border-light)",
                      color: "var(--text-secondary)",
                      cursor: "pointer"
                    }}
                  >
                    📍 Use Map Center
                  </button>

                  <button
                    type="button"
                    onClick={handleUseDeviceLocation}
                    disabled={devices.length === 0}
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "5px 10px",
                      borderRadius: "6px",
                      backgroundColor: "#ffffff",
                      border: "1px solid var(--border-light)",
                      color: devices.length > 0 ? "var(--emerald-primary)" : "var(--text-muted)",
                      cursor: devices.length > 0 ? "pointer" : "not-allowed"
                    }}
                  >
                    🎯 Use Device Position
                  </button>
                </div>

                {/* Radius Slider & Input */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)" }}>
                      Zone Radius: <span style={{ color: "var(--emerald-primary)", fontWeight: 800 }}>{formatDistance(radius)}</span>
                    </label>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>50m to 10,000m</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input
                      type="range"
                      min="50"
                      max="5000"
                      step="50"
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      style={{ flex: 1, accentColor: "var(--emerald-primary)", cursor: "pointer" }}
                    />
                    <input
                      type="number"
                      min="10"
                      max="100000"
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      style={{
                        width: "80px",
                        padding: "6px 8px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-light)",
                        fontSize: "12px",
                        backgroundColor: "#ffffff",
                        textAlign: "right"
                      }}
                    />
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>meters</span>
                  </div>
                </div>
              </>
            ) : (
              /* WAYPOINT POLYGON MODE INPUTS */
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {/* Interactive Drawing Launcher Button */}
                <div style={{
                  padding: "12px",
                  borderRadius: "8px",
                  backgroundColor: "var(--bg-green-tint)",
                  border: "1px solid #a7f3d0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--emerald-dark)", display: "flex", alignItems: "center", gap: "6px" }}>
                      <PenTool size={14} />
                      <span>Interactive Live Map Marker</span>
                    </div>
                    <p style={{ fontSize: "11px", color: "var(--emerald-dark)", marginTop: "2px" }}>
                      Click points directly on the Leaflet map to draw your enclosed waypoint region.
                    </p>
                  </div>
                  {onStartMapDrawing && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onStartMapDrawing();
                      }}
                      style={{
                        padding: "7px 12px",
                        borderRadius: "6px",
                        border: "none",
                        backgroundColor: "var(--emerald-primary)",
                        color: "#ffffff",
                        fontWeight: 700,
                        fontSize: "11px",
                        cursor: "pointer",
                        boxShadow: "0 2px 8px rgba(5, 150, 105, 0.25)"
                      }}
                    >
                      📍 Start Drawing on Map
                    </button>
                  )}
                </div>

                {/* Waypoint Coordinates List Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)" }}>
                    Waypoints ({waypoints.length} points)
                  </label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      onClick={handleAddWaypoint}
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "4px 8px",
                        borderRadius: "6px",
                        backgroundColor: "#ffffff",
                        border: "1px solid var(--border-light)",
                        color: "var(--emerald-primary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                      }}
                    >
                      <Plus size={12} />
                      <span>Add Point</span>
                    </button>
                    {waypoints.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setWaypoints([]);
                          if (onClearDrawnWaypoints) onClearDrawnWaypoints();
                        }}
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "4px 8px",
                          borderRadius: "6px",
                          backgroundColor: "#ffffff",
                          border: "1px solid var(--border-light)",
                          color: "#ef4444",
                          cursor: "pointer"
                        }}
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {/* Waypoint Entries */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "160px", overflowY: "auto" }}>
                  {waypoints.map((wp, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        backgroundColor: "#ffffff",
                        padding: "6px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-light)"
                      }}
                    >
                      <span style={{
                        fontSize: "10px",
                        fontWeight: 800,
                        backgroundColor: "var(--bg-green-tint)",
                        color: "var(--emerald-dark)",
                        padding: "2px 6px",
                        borderRadius: "4px"
                      }}>
                        W{idx + 1}
                      </span>
                      <input
                        type="number"
                        step="0.000001"
                        value={wp[0]}
                        onChange={(e) => handleUpdateWaypoint(idx, parseFloat(e.target.value) || 0, wp[1])}
                        placeholder="Latitude"
                        style={{
                          flex: 1,
                          padding: "4px 8px",
                          fontSize: "11px",
                          fontFamily: "'JetBrains Mono', monospace",
                          border: "1px solid var(--border-light)",
                          borderRadius: "4px"
                        }}
                      />
                      <input
                        type="number"
                        step="0.000001"
                        value={wp[1]}
                        onChange={(e) => handleUpdateWaypoint(idx, wp[0], parseFloat(e.target.value) || 0)}
                        placeholder="Longitude"
                        style={{
                          flex: 1,
                          padding: "4px 8px",
                          fontSize: "11px",
                          fontFamily: "'JetBrains Mono', monospace",
                          border: "1px solid var(--border-light)",
                          borderRadius: "4px"
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveWaypoint(idx)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#94a3b8",
                          cursor: "pointer",
                          padding: "2px"
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}

                  {waypoints.length === 0 && (
                    <div style={{
                      textAlign: "center",
                      padding: "16px",
                      border: "1px dashed var(--border-light)",
                      borderRadius: "6px",
                      color: "var(--text-muted)",
                      fontSize: "11px"
                    }}>
                      No waypoints placed. Click <b>"Start Drawing on Map"</b> or <b>"Add Point"</b> to define perimeter coordinates.
                    </div>
                  )}
                </div>

                {/* Waypoint Region Metrics Summary */}
                {waypoints.length >= 3 && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "8px",
                    backgroundColor: "#ffffff",
                    padding: "10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    fontSize: "11px"
                  }}>
                    <div>
                      <span style={{ color: "var(--text-secondary)", display: "block" }}>Enclosed Perimeter</span>
                      <span style={{ fontWeight: 800, color: "var(--emerald-dark)", fontSize: "12px" }}>
                        {formatDistance(calculatePolygonPerimeterMeters(waypoints))}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)", display: "block" }}>Approx. Land Area</span>
                      <span style={{ fontWeight: 800, color: "var(--emerald-primary)", fontSize: "12px" }}>
                        {formatArea(calculatePolygonAreaMeters(waypoints))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Color Palette Selection */}
            <div>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
                Perimeter Color
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setSelectedColor(c.value)}
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "50%",
                      backgroundColor: c.value,
                      border: selectedColor === c.value ? "2.5px solid #0f172a" : "2px solid #ffffff",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    {selectedColor === c.value && <Check size={14} color="#ffffff" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Alert Flags */}
            <div style={{ display: "flex", gap: "16px", paddingTop: "4px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={alertOnExit}
                  onChange={(e) => setAlertOnExit(e.target.checked)}
                  style={{ accentColor: "var(--emerald-primary)" }}
                />
                <span>Alert when device EXITS perimeter</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={alertOnEnter}
                  onChange={(e) => setAlertOnEnter(e.target.checked)}
                  style={{ accentColor: "var(--emerald-primary)" }}
                />
                <span>Alert when device ENTERS perimeter</span>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={fenceType === "polygon" && waypoints.length < 3}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "10px 16px",
                borderRadius: "8px",
                backgroundColor: fenceType === "polygon" && waypoints.length < 3 ? "#94a3b8" : "var(--emerald-primary)",
                border: "none",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: fenceType === "polygon" && waypoints.length < 3 ? "not-allowed" : "pointer",
                boxShadow: "0 4px 12px rgba(5, 150, 105, 0.25)",
                marginTop: "6px"
              }}
            >
              <Plus size={16} />
              <span>{fenceType === "polygon" ? `Save Waypoint Geofence (${waypoints.length} points)` : "Add Circular Geofence to Map"}</span>
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
