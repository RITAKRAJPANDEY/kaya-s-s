"use client";

import React, { useState } from "react";
import { DeviceTelemetry } from "@/lib/types";
import { 
  Laptop, 
  Smartphone, 
  MapPin, 
  Crosshair, 
  X, 
  Check, 
  RefreshCw, 
  Satellite, 
  Compass, 
  SlidersHorizontal,
  RotateCcw
} from "lucide-react";

interface StationCalibrateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLat: number;
  currentLon: number;
  currentAccuracy: number;
  label?: string;
  phoneDevice?: DeviceTelemetry | null;
  onSaveCalibration: (lat: number, lon: number, accuracy: number, label: string) => void;
  onStartMapPinpoint: () => void;
  onResetToAutoGps: () => void;
}

export default function StationCalibrateModal({
  isOpen,
  onClose,
  currentLat,
  currentLon,
  currentAccuracy,
  label,
  phoneDevice,
  onSaveCalibration,
  onStartMapPinpoint,
  onResetToAutoGps
}: StationCalibrateModalProps) {
  const [latInput, setLatInput] = useState(currentLat ? currentLat.toFixed(6) : "0.000000");
  const [lonInput, setLonInput] = useState(currentLon ? currentLon.toFixed(6) : "0.000000");
  const [stationName, setStationName] = useState(label || "Base Command Station");

  React.useEffect(() => {
    if (currentLat && currentLon) {
      setLatInput(currentLat.toFixed(6));
      setLonInput(currentLon.toFixed(6));
    }
  }, [currentLat, currentLon, isOpen]);

  if (!isOpen) return null;

  const handleSyncFromPhone = () => {
    if (!phoneDevice) return;
    onSaveCalibration(phoneDevice.lat, phoneDevice.lon, Math.min(phoneDevice.accuracy_m || 2, 3), "Calibrated from Phone GNSS");
    onClose();
  };

  const handleManualSave = (e: React.FormEvent) => {
    e.preventDefault();
    const latNum = parseFloat(latInput);
    const lonNum = parseFloat(lonInput);
    if (isNaN(latNum) || isNaN(lonNum)) {
      alert("Please enter valid decimal coordinates (e.g. 18.520430, 73.856743).");
      return;
    }
    onSaveCalibration(latNum, lonNum, 1.5, stationName.trim() || "Calibrated Base Station");
    onClose();
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(15, 23, 42, 0.45)",
      backdropFilter: "blur(6px)",
      zIndex: 2100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px"
    }}>
      <div style={{
        backgroundColor: "#ffffff",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-light)",
        boxShadow: "0 20px 40px rgba(37, 99, 235, 0.18)",
        width: "100%",
        maxWidth: "540px",
        maxHeight: "90vh",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--border-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "38px",
              height: "38px",
              borderRadius: "10px",
              backgroundColor: "#eff6ff",
              color: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <Laptop size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 800, color: "#1e40af" }}>
                Calibrate Laptop Base Station
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "1px" }}>
                Laptops lack built-in GPS chips. Use phone sync or manual pin for ±1m accuracy.
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
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "18px" }}>
          
          {/* Quick Option 1: Sync from Phone GPS */}
          <div style={{
            backgroundColor: "#f0fdf4",
            border: "1.5px solid #a7f3d0",
            borderRadius: "10px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Smartphone size={18} style={{ color: "var(--emerald-primary)" }} />
                <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--emerald-dark)" }}>
                  Option A: Sync from Phone Satellite GPS (Recommended)
                </span>
              </div>
              <span style={{ fontSize: "10px", fontWeight: 800, backgroundColor: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: "4px" }}>
                ±1.5m SATELLITE FIX
              </span>
            </div>

            <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
              {phoneDevice ? (
                <span>
                  Connected Phone (<b>{phoneDevice.name || phoneDevice.device_id}</b>) has active GPS: <code style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{phoneDevice.lat.toFixed(5)}°, {phoneDevice.lon.toFixed(5)}°</code>
                </span>
              ) : (
                <span>
                  Open the broadcaster on your phone (<code>/phone</code>) to automatically copy your phone's true GNSS satellite lock.
                </span>
              )}
            </p>

            <button
              onClick={handleSyncFromPhone}
              disabled={!phoneDevice}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "9px 14px",
                borderRadius: "8px",
                backgroundColor: phoneDevice ? "var(--emerald-primary)" : "#cbd5e1",
                border: "none",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 700,
                cursor: phoneDevice ? "pointer" : "not-allowed",
                boxShadow: phoneDevice ? "0 4px 12px rgba(5, 150, 105, 0.25)" : "none"
              }}
            >
              <Satellite size={15} />
              <span>{phoneDevice ? "Set Base Station to Phone's GPS Location" : "Waiting for Phone Connection..."}</span>
            </button>
          </div>

          {/* Quick Option 2: Interactive Map Pin Clicker */}
          <div style={{
            backgroundColor: "#eff6ff",
            border: "1.5px solid #bfdbfe",
            borderRadius: "10px",
            padding: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 800, color: "#1e40af", display: "flex", alignItems: "center", gap: "6px" }}>
                <Crosshair size={16} />
                <span>Option B: Click Exact Location on Map</span>
              </div>
              <p style={{ fontSize: "12px", color: "#3b82f6", marginTop: "2px" }}>
                Click anywhere on the satellite view to drop your station pin directly onto your building.
              </p>
            </div>
            <button
              onClick={() => {
                onClose();
                onStartMapPinpoint();
              }}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                backgroundColor: "#2563eb",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(37, 99, 235, 0.25)",
                whiteSpace: "nowrap"
              }}
            >
              📍 Pinpoint on Map
            </button>
          </div>

          {/* Quick Option 3: Manual Exact Coordinate Entry */}
          <form onSubmit={handleManualSave} style={{
            backgroundColor: "var(--bg-card-muted)",
            border: "1px solid var(--border-light)",
            borderRadius: "10px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}>
            <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "6px" }}>
              <SlidersHorizontal size={16} />
              <span>Option C: Enter Exact Decimal Coordinates</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                  Latitude (decimal °)
                </label>
                <input
                  type="text"
                  value={latInput}
                  onChange={(e) => setLatInput(e.target.value)}
                  placeholder="e.g. 18.520430"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    fontSize: "12px",
                    fontFamily: "'JetBrains Mono', monospace",
                    backgroundColor: "#ffffff"
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                  Longitude (decimal °)
                </label>
                <input
                  type="text"
                  value={lonInput}
                  onChange={(e) => setLonInput(e.target.value)}
                  placeholder="e.g. 73.856743"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    fontSize: "12px",
                    fontFamily: "'JetBrains Mono', monospace",
                    backgroundColor: "#ffffff"
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
                Station Label / Notes
              </label>
              <input
                type="text"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                placeholder="e.g. Home Base Station, Office Command"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-light)",
                  fontSize: "12px",
                  backgroundColor: "#ffffff"
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
              <button
                type="button"
                onClick={() => {
                  onResetToAutoGps();
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "none",
                  border: "none",
                  color: "#ef4444",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                <RotateCcw size={12} />
                <span>Reset to Auto Browser GPS</span>
              </button>

              <button
                type="submit"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(37, 99, 235, 0.25)"
                }}
              >
                <Check size={14} />
                <span>Save Exact Position</span>
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>
  );
}
