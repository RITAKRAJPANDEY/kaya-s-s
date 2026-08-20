"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import IncidentAnalysisModal from "@/components/IncidentAnalysisModal";
import { 
  Menu, 
  Map, 
  Video, 
  Activity, 
  FileText,
  Smartphone,
  Layers,
  ChevronRight,
  Shield
} from "lucide-react";

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
  const pathname = usePathname();

  const navItems = [
    { name: "Geofence Map", icon: <Map size={19} />, href: "/geofence" },
    { name: "Live Vision Feed", icon: <Video size={19} />, href: "/vision" },
    { name: "SLAM Tracking", icon: <Activity size={19} />, href: "/slam" }, 
    { name: "Safety Reports", icon: <FileText size={19} />, href: "/reports" },
    { name: "Phone Broadcaster", icon: <Smartphone size={19} />, href: "/phone" },
  ];

  return (
    <aside 
      style={{
        backgroundColor: "#ffffff",
        borderRight: "1px solid var(--border-light)",
        transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
        flexShrink: 0,
        width: isOpen ? "240px" : "68px",
        height: "100vh",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)"
      }}
    >
      {/* Sidebar Header / Logo */}
      <div style={{
        height: "64px",
        display: "flex",
        alignItems: "center",
        justifyContent: isOpen ? "space-between" : "center",
        padding: "0 16px",
        borderBottom: "1px solid var(--border-light)",
        flexShrink: 0
      }}>
        {isOpen && (
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
            <div style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #059669 0%, #0d9488 100%)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(5, 150, 105, 0.3)"
            }}>
              <Layers size={16} />
            </div>
            <span style={{
              fontWeight: 800,
              fontSize: "15px",
              letterSpacing: "0.05em",
              color: "#0f172a"
            }}>
              KAYA<span style={{ color: "var(--emerald-primary)" }}>·AI</span>
            </span>
          </Link>
        )}
        <button 
          onClick={() => setIsOpen(!isOpen)} 
          title={isOpen ? "Collapse Menu" : "Expand Menu"}
          style={{
            padding: "8px",
            borderRadius: "8px",
            background: "none",
            border: "1px solid transparent",
            color: "var(--text-secondary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s ease"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-card-muted)";
            e.currentTarget.style.borderColor = "var(--border-light)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.borderColor = "transparent";
          }}
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Navigation Links */}
      <nav style={{
        flex: 1,
        padding: "16px 10px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        overflowY: "auto"
      }}>
        {navItems.map((item, index) => {
          const isActive = pathname === item.href || (item.href === "/geofence" && pathname === "/");
          
          return (
            <Link 
              key={index}
              href={item.href}
              title={!isOpen ? item.name : ""}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 12px",
                borderRadius: "10px",
                textDecoration: "none",
                transition: "all 0.15s ease",
                backgroundColor: isActive ? "#f0fdf4" : "transparent",
                color: isActive ? "#065f46" : "#475569",
                border: isActive ? "1px solid #bbf7d0" : "1px solid transparent",
                fontWeight: isActive ? 700 : 500,
                fontSize: "13px",
                boxShadow: isActive ? "0 2px 6px rgba(5, 150, 105, 0.08)" : "none"
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = "var(--bg-card-muted)";
                  e.currentTarget.style.color = "#0f172a";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#475569";
                }
              }}
            >
              <span style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isActive ? "var(--emerald-primary)" : "inherit",
                margin: !isOpen ? "0 auto" : "0"
              }}>
                {item.icon}
              </span>
              {isOpen && (
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.name}
                </span>
              )}
            </Link>
          );
        })}

        {/* Real Incident Case Study Modal Button */}
        <button
          onClick={() => setIsIncidentModalOpen(true)}
          title={!isOpen ? "Real Incident Case Study" : ""}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "10px 12px",
            borderRadius: "10px",
            backgroundColor: "#fff1f2",
            color: "#e11d48",
            border: "1px solid #fecdd3",
            fontWeight: 800,
            fontSize: "13px",
            cursor: "pointer",
            marginTop: "6px",
            transition: "all 0.15s ease",
            textAlign: "left"
          }}
        >
          <span style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#e11d48",
            margin: !isOpen ? "0 auto" : "0",
            fontSize: "16px"
          }}>
            🚨
          </span>
          {isOpen && (
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Incident Case Study
            </span>
          )}
        </button>
      </nav>

      {/* Real Incident Analysis Video & Spatial Reconstruction Modal */}
      <IncidentAnalysisModal
        isOpen={isIncidentModalOpen}
        onClose={() => setIsIncidentModalOpen(false)}
      />

      {/* Footer / Status Indicator */}
      <div style={{
        padding: "12px 10px",
        borderTop: "1px solid var(--border-light)",
        flexShrink: 0
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "8px 10px",
          borderRadius: "8px",
          backgroundColor: "#f8fafc",
          border: "1px solid var(--border-light)"
        }}>
          <div style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: "var(--emerald-primary)",
            flexShrink: 0,
            margin: !isOpen ? "0 auto" : "0"
          }} className="pulse-active" />
          {isOpen && (
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#0f172a" }}>System Online</span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Sub-second SSE Active</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
