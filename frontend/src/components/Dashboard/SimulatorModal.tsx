"use client";

import React, { useState } from "react";
import { Play, Square, Plus, Trash2, X, RefreshCw, Cpu, Smartphone, Car, Send } from "lucide-react";
import { SimulationProfile } from "@/lib/types";

interface SimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSimulating: boolean;
  onStartSimulation: () => void;
  onStopSimulation: () => void;
  profiles: SimulationProfile[];
  onAddProfile: (profile: SimulationProfile) => void;
  onRemoveProfile: (id: string) => void;
  originCoords?: [number, number] | null;
}

export default function SimulatorModal({
  isOpen,
  onClose,
  isSimulating,
  onStartSimulation,
  onStopSimulation,
  profiles,
  onAddProfile,
  onRemoveProfile,
  originCoords
}: SimulatorModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"phone" | "raspberry-pi" | "vehicle" | "drone">("vehicle");
  const [pattern, setPattern] = useState<"circle" | "patrol" | "linear" | "random">("patrol");
  const [speedKmh, setSpeedKmh] = useState(35);

  if (!isOpen) return null;

  const baseLat = originCoords ? originCoords[0] : 0;
  const baseLon = originCoords ? originCoords[1] : 0;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const id = `sim-${name.toLowerCase().replace(/[^a-z0-9]/g, "-") || Math.floor(Math.random() * 10000)}`;
    const colors = ["#059669", "#10b981", "#047857", "#0d9488", "#16a34a"];
    const color = colors[profiles.length % colors.length];

    onAddProfile({
      id,
      name: name || `Simulated ${type}`,
      type,
      startLat: baseLat + (Math.random() - 0.5) * 0.008,
      startLon: baseLon + (Math.random() - 0.5) * 0.008,
      speedKmh: Number(speedKmh) || 30,
      pattern,
      color
    });
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
        maxWidth: "560px",
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
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--emerald-dark)" }}>
              Telemetry Simulator
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
              Generate virtual moving devices with dynamic headings & GPS coordinates
            </p>
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
          {/* Main Control Action */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px",
            backgroundColor: isSimulating ? "#f0fdf4" : "var(--bg-card-muted)",
            border: isSimulating ? "1.5px solid #34d399" : "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)"
          }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)" }}>
                {isSimulating ? "Simulation is Running" : "Simulation Stopped"}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                {profiles.length} virtual targets active
              </div>
            </div>

            {isSimulating ? (
              <button
                onClick={onStopSimulation}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: "#ef4444",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 18px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                <Square size={16} />
                <span>Stop Engine</span>
              </button>
            ) : (
              <button
                onClick={onStartSimulation}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: "var(--emerald-primary)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 18px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(5, 150, 105, 0.25)"
                }}
              >
                <Play size={16} />
                <span>Start Simulation</span>
              </button>
            )}
          </div>

          {/* Active Simulation Profiles List */}
          <div>
            <label style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>
              Active Virtual Devices ({profiles.length})
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {profiles.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    backgroundColor: "#ffffff",
                    border: "1px solid var(--border-light)",
                    borderRadius: "8px"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "6px",
                      backgroundColor: "var(--bg-green-pill)",
                      color: "var(--emerald-primary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}>
                      {p.type === "raspberry-pi" ? <Cpu size={16} /> : p.type === "vehicle" ? <Car size={16} /> : p.type === "drone" ? <Send size={16} /> : <Smartphone size={16} />}
                    </div>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-main)" }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        {p.pattern} pattern · {p.speedKmh} km/h
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => onRemoveProfile(p.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      padding: "4px"
                    }}
                    title="Remove device"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Form to Add New Virtual Target */}
          <form onSubmit={handleAdd} style={{
            backgroundColor: "var(--bg-card-muted)",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-md)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--emerald-dark)" }}>
              + Add Virtual Device
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                  Device Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Patrol Drone 01"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    fontSize: "13px",
                    backgroundColor: "#ffffff"
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                  Device Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    fontSize: "13px",
                    backgroundColor: "#ffffff"
                  }}
                >
                  <option value="vehicle">Delivery Vehicle</option>
                  <option value="raspberry-pi">Raspberry Pi Edge</option>
                  <option value="drone">Autonomous Drone</option>
                  <option value="phone">Field Agent Phone</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                  Movement Pattern
                </label>
                <select
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value as any)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    fontSize: "13px",
                    backgroundColor: "#ffffff"
                  }}
                >
                  <option value="patrol">Perimeter Patrol (Square)</option>
                  <option value="circle">Orbital Sweep (Circle)</option>
                  <option value="linear">Transit Line (Back & Forth)</option>
                  <option value="random">Dynamic Urban Roaming</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                  Speed (km/h)
                </label>
                <input
                  type="number"
                  min="5"
                  max="160"
                  value={speedKmh}
                  onChange={(e) => setSpeedKmh(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    fontSize: "13px",
                    backgroundColor: "#ffffff"
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "6px",
                backgroundColor: "#ffffff",
                border: "1px solid var(--border-green)",
                color: "var(--emerald-primary)",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                marginTop: "4px"
              }}
            >
              <Plus size={16} />
              <span>Add Device</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
