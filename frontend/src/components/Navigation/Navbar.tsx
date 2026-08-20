"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Navigation, 
  Smartphone, 
  Layers, 
  Play, 
  Radio, 
  Activity,
  ShieldCheck,
  Laptop,
  QrCode
} from "lucide-react";

interface NavbarProps {
  onlineCount?: number;
  totalDevices?: number;
  onOpenSimulator?: () => void;
  isSimulating?: boolean;
  onOpenGeofences?: () => void;
  geofenceCount?: number;
  onOpenPhoneGuide?: () => void;
  onToggleLaptopStation?: () => void;
  isLaptopStationActive?: boolean;
}

export default function Navbar({ 
  onlineCount = 0, 
  totalDevices = 0, 
  onOpenSimulator,
  isSimulating = false,
  onOpenGeofences,
  geofenceCount = 0,
  onOpenPhoneGuide,
  onToggleLaptopStation,
  isLaptopStationActive = false
}: NavbarProps) {
  const pathname = usePathname();

  return (
    <header style={{
      backgroundColor: "rgba(255, 255, 255, 0.92)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--border-light)",
      position: "sticky",
      top: 0,
      zIndex: 1000,
      padding: "12px 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }}>
      {/* Brand & Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "38px",
            height: "38px",
            borderRadius: "10px",
            background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)"
          }}>
            <Navigation size={20} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "18px", fontWeight: 800, color: "var(--emerald-dark)", letterSpacing: "-0.02em" }}>
                KAYA
              </span>
              <span style={{ 
                fontSize: "11px", 
                fontWeight: 700, 
                backgroundColor: "var(--bg-green-pill)", 
                color: "var(--emerald-primary)", 
                padding: "2px 6px", 
                borderRadius: "6px" 
              }}>
                LIVE TELEMETRY
              </span>
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 500 }}>
              Multi-Device GPS & Geofencing Hub
            </div>
          </div>
        </Link>
      </div>

      {/* Nav Links & Mode Switchers */}
      <nav style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Link 
          href="/" 
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            backgroundColor: (pathname === "/" || pathname === "/geofence") ? "var(--bg-green-tint)" : "transparent",
            color: (pathname === "/" || pathname === "/geofence") ? "var(--emerald-primary)" : "var(--text-secondary)",
            border: (pathname === "/" || pathname === "/geofence") ? "1px solid var(--border-green)" : "1px solid transparent",
            transition: "all 0.2s"
          }}
        >
          <Layers size={16} />
          <span>Dashboard Map</span>
        </Link>

        <Link 
          href="/vision" 
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            backgroundColor: pathname === "/vision" ? "var(--bg-green-tint)" : "transparent",
            color: pathname === "/vision" ? "var(--emerald-primary)" : "var(--text-secondary)",
            border: pathname === "/vision" ? "1px solid var(--border-green)" : "1px solid transparent",
            transition: "all 0.2s"
          }}
        >
          <Activity size={16} />
          <span>Live Vision Feed</span>
        </Link>

        <Link 
          href="/slam" 
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            backgroundColor: pathname === "/slam" ? "var(--bg-green-tint)" : "transparent",
            color: pathname === "/slam" ? "var(--emerald-primary)" : "var(--text-secondary)",
            border: pathname === "/slam" ? "1px solid var(--border-green)" : "1px solid transparent",
            transition: "all 0.2s"
          }}
        >
          <Navigation size={16} />
          <span>SLAM Tracking</span>
        </Link>

        <Link 
          href="/reports" 
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            backgroundColor: pathname === "/reports" ? "var(--bg-green-tint)" : "transparent",
            color: pathname === "/reports" ? "var(--emerald-primary)" : "var(--text-secondary)",
            border: pathname === "/reports" ? "1px solid var(--border-green)" : "1px solid transparent",
            transition: "all 0.2s"
          }}
        >
          <ShieldCheck size={16} />
          <span>Safety Reports</span>
        </Link>

        {onOpenGeofences && (
          <button
            onClick={onOpenGeofences}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: geofenceCount > 0 ? "var(--bg-green-tint)" : "#ffffff",
              color: geofenceCount > 0 ? "var(--emerald-primary)" : "var(--text-secondary)",
              border: geofenceCount > 0 ? "1px solid var(--border-green)" : "1px solid var(--border-light)",
              boxShadow: "var(--shadow-sm)",
              transition: "all 0.2s"
            }}
          >
            <ShieldCheck size={16} style={{ color: "var(--emerald-primary)" }} />
            <span>Geofencing</span>
            {geofenceCount > 0 && (
              <span style={{
                fontSize: "11px",
                fontWeight: 700,
                backgroundColor: "var(--bg-green-pill)",
                color: "var(--emerald-dark)",
                padding: "1px 6px",
                borderRadius: "10px"
              }}>
                {geofenceCount}
              </span>
            )}
          </button>
        )}

        <Link 
          href="/phone" 
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            backgroundColor: pathname === "/phone" ? "var(--bg-green-tint)" : "transparent",
            color: pathname === "/phone" ? "var(--emerald-primary)" : "var(--text-secondary)",
            border: pathname === "/phone" ? "1px solid var(--border-green)" : "1px solid transparent",
            transition: "all 0.2s"
          }}
        >
          <Smartphone size={16} />
          <span>Mobile Broadcaster</span>
        </Link>

        {onToggleLaptopStation && (
          <button
            onClick={onToggleLaptopStation}
            title={isLaptopStationActive ? "Disable Laptop GPS Broadcast" : "Broadcast Laptop's location to map as Base Station"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: isLaptopStationActive ? "#eff6ff" : "#ffffff",
              color: isLaptopStationActive ? "#2563eb" : "var(--text-secondary)",
              border: isLaptopStationActive ? "1.5px solid #60a5fa" : "1px solid var(--border-light)",
              boxShadow: "var(--shadow-sm)",
              transition: "all 0.2s"
            }}
          >
            <Laptop size={15} style={{ color: isLaptopStationActive ? "#2563eb" : "var(--text-muted)" }} />
            <span>Laptop Station</span>
            {isLaptopStationActive && (
              <span style={{ 
                width: "8px", 
                height: "8px", 
                borderRadius: "50%", 
                backgroundColor: "#2563eb" 
              }} className="pulse-active" />
            )}
          </button>
        )}

        {onOpenPhoneGuide && (
          <button
            onClick={onOpenPhoneGuide}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: "var(--bg-green-tint)",
              color: "var(--emerald-dark)",
              border: "1px solid var(--border-green)",
              boxShadow: "var(--shadow-sm)",
              transition: "all 0.2s"
            }}
          >
            <QrCode size={15} style={{ color: "var(--emerald-primary)" }} />
            <span>Connect Phone</span>
          </button>
        )}

        {onOpenSimulator && (
          <button
            onClick={onOpenSimulator}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: isSimulating ? "#f0fdf4" : "#ffffff",
              color: isSimulating ? "#059669" : "var(--text-secondary)",
              border: isSimulating ? "1px solid #34d399" : "1px solid var(--border-light)",
              boxShadow: "var(--shadow-sm)",
              transition: "all 0.2s"
            }}
          >
            <Play size={15} style={{ color: isSimulating ? "#10b981" : "var(--text-muted)" }} />
            <span>Simulator</span>
            {isSimulating && (
              <span style={{ 
                width: "8px", 
                height: "8px", 
                borderRadius: "50%", 
                backgroundColor: "#10b981" 
              }} className="pulse-active" />
            )}
          </button>
        )}
      </nav>

      {/* Live Connection & Device Status Badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "#ffffff",
          border: "1px solid var(--border-light)",
          padding: "6px 14px",
          borderRadius: "var(--radius-full)",
          boxShadow: "var(--shadow-sm)"
        }}>
          <span 
            style={{ 
              width: "8px", 
              height: "8px", 
              borderRadius: "50%", 
              backgroundColor: onlineCount > 0 ? "#10b981" : "#94a3b8" 
            }} 
            className={onlineCount > 0 ? "pulse-active" : ""}
          />
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>
            {onlineCount} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>/ {totalDevices} Online</span>
          </span>
        </div>
      </div>
    </header>
  );
}
