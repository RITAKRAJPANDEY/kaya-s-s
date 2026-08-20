"use client";

import React, { useEffect, useRef } from "react";
import { DeviceTelemetry, GeofenceZone } from "@/lib/types";
import { Maximize2, ShieldCheck, MapPin } from "lucide-react";
import { calculatePolygonPerimeterMeters, formatDistance } from "@/lib/geo";

interface LiveMapProps {
  devices: DeviceTelemetry[];
  selectedDevice: DeviceTelemetry | null;
  onSelectDevice: (device: DeviceTelemetry) => void;
  activeTrails: Record<string, boolean>;
  geofences?: GeofenceZone[];
  focusCoords?: [number, number] | null;
  onMapClickCoords?: (lat: number, lon: number) => void;
  serverOrigin?: [number, number] | null;
  isDrawingWaypoints?: boolean;
  drawingWaypoints?: [number, number][];
  onAddDrawingWaypoint?: (coords: [number, number]) => void;
  drawingColor?: string;
}

export default function LiveMap({
  devices,
  selectedDevice,
  onSelectDevice,
  activeTrails,
  geofences = [],
  focusCoords,
  onMapClickCoords,
  serverOrigin,
  isDrawingWaypoints = false,
  drawingWaypoints = [],
  onAddDrawingWaypoint,
  drawingColor = "#059669"
}: LiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const circlesRef = useRef<Record<string, any>>({});
  const polylinesRef = useRef<Record<string, any>>({});
  const fovLayersRef = useRef<any[]>([]);
  const threatLayersRef = useRef<any[]>([]);
  const blindSpotLayersRef = useRef<any[]>([]);
  const geofenceLayersRef = useRef<any[]>([]);
  const drawingLayersRef = useRef<any[]>([]);
  const userInteractedRef = useRef<boolean>(false);
  const initialCenterSetRef = useRef<boolean>(false);
  const [mapStyle, setMapStyle] = React.useState<"light" | "osm" | "satellite">("light");
  const tileLayerRef = useRef<any>(null);

  // Callback Refs to keep single-mount map stable without blinking/re-rendering loops
  const isDrawingWaypointsRef = useRef(isDrawingWaypoints);
  const onAddDrawingWaypointRef = useRef(onAddDrawingWaypoint);
  const onMapClickCoordsRef = useRef(onMapClickCoords);
  const onSelectDeviceRef = useRef(onSelectDevice);

  useEffect(() => { isDrawingWaypointsRef.current = isDrawingWaypoints; }, [isDrawingWaypoints]);
  useEffect(() => { onAddDrawingWaypointRef.current = onAddDrawingWaypoint; }, [onAddDrawingWaypoint]);
  useEffect(() => { onMapClickCoordsRef.current = onMapClickCoords; }, [onMapClickCoords]);
  useEffect(() => { onSelectDeviceRef.current = onSelectDevice; }, [onSelectDevice]);

  // Initialize Leaflet map (Runs ONCE on mount)
  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current) return;

    let L: any;
    let isCancelled = false;

    const init = async () => {
      L = await import("leaflet");

      if (isCancelled || mapRef.current) return;

      const initCenter: [number, number] = serverOrigin || (devices.length > 0 ? [devices[0].lat, devices[0].lon] : [20.5937, 78.9629]);
      const initZoom = serverOrigin || devices.length > 0 ? 16 : 4;

      const map = L.map(mapContainerRef.current, {
        center: initCenter,
        zoom: initZoom,
        zoomControl: false,
        attributionControl: false
      });

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const getTileUrl = (style: string) => {
        if (style === "satellite") {
          return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
        }
        if (style === "osm") {
          return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
        }
        return "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
      };

      tileLayerRef.current = L.tileLayer(getTileUrl(mapStyle), {
        maxZoom: 20,
        subdomains: "abcd"
      }).addTo(map);

      map.on("dragstart zoomstart", () => {
        userInteractedRef.current = true;
      });

      map.on("click", (e: any) => {
        if (isDrawingWaypointsRef.current && onAddDrawingWaypointRef.current) {
          onAddDrawingWaypointRef.current([e.latlng.lat, e.latlng.lng]);
        } else if (onMapClickCoordsRef.current) {
          onMapClickCoordsRef.current(e.latlng.lat, e.latlng.lng);
        }
      });

      mapRef.current = map;
    };

    init();

    return () => {
      isCancelled = true;
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch (e) {}
        mapRef.current = null;
      }
    };
  }, []);

  // Change tile provider
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    import("leaflet").then((L) => {
      if (tileLayerRef.current) {
        mapRef.current.removeLayer(tileLayerRef.current);
      }
      let url = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
      if (mapStyle === "satellite") {
        url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      } else if (mapStyle === "osm") {
        url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      }
      tileLayerRef.current = L.tileLayer(url, { maxZoom: 20, subdomains: "abcd" }).addTo(mapRef.current);
    });
  }, [mapStyle]);

  // Focus coordinates effect
  useEffect(() => {
    if (mapRef.current && focusCoords) {
      mapRef.current.flyTo(focusCoords, 17, { duration: 1.2 });
    }
  }, [focusCoords]);

  // Set initial center on server origin when resolved
  useEffect(() => {
    if (mapRef.current && serverOrigin && !initialCenterSetRef.current) {
      initialCenterSetRef.current = true;
      mapRef.current.flyTo(serverOrigin, 16, { duration: 1.0 });
    }
  }, [serverOrigin?.[0], serverOrigin?.[1]]);

  // Selected device focus effect
  useEffect(() => {
    if (mapRef.current && selectedDevice) {
      const zoom = mapRef.current.getZoom() ? Math.max(mapRef.current.getZoom(), 16) : 16;
      mapRef.current.flyTo([selectedDevice.lat, selectedDevice.lon], zoom, { duration: 1.0 });
    }
  }, [selectedDevice?.device_id]);

  // Update devices, markers, accuracy circles & trails
  useEffect(() => {
    if (!mapRef.current) return;

    import("leaflet").then((L) => {
      const map = mapRef.current;
      const currentIds = new Set(devices.map((d) => d.device_id));

      // Remove stale markers
      Object.keys(markersRef.current).forEach((id) => {
        if (!currentIds.has(id)) {
          if (markersRef.current[id]) map.removeLayer(markersRef.current[id]);
          if (circlesRef.current[id]) map.removeLayer(circlesRef.current[id]);
          if (polylinesRef.current[id]) map.removeLayer(polylinesRef.current[id]);
          delete markersRef.current[id];
          delete circlesRef.current[id];
          delete polylinesRef.current[id];
        }
      });

      // Auto-center map on active device if initial center not set
      if (!initialCenterSetRef.current && !userInteractedRef.current && devices.length > 0) {
        const primary = devices.find((d) => d.type === "phone" || d.device_id.startsWith("phone") || d.device_id === "phone-broadcaster") || devices[0];
        if (primary && primary.lat && primary.lon) {
          initialCenterSetRef.current = true;
          map.setView([primary.lat, primary.lon], 17);
        }
      }

      devices.forEach((device) => {
        const pos: [number, number] = [device.lat, device.lon];
        const isStation = device.type === "station";
        const color = device.color || (isStation ? "#2563eb" : device.online ? "#059669" : "#64748b");
        const speedKmh = device.speed_mps ? (device.speed_mps * 3.6).toFixed(1) : "0.0";
        const hasHeading = device.heading !== undefined && device.heading !== null;
        const headingDeg = device.heading || 0;

        // Modern Minimalist Directional & Beacon Marker
        const iconHtml = `
          <div class="device-marker-wrapper" style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
            ${hasHeading ? `
              <!-- Heading Field-of-View Cone -->
              <div style="
                position: absolute;
                width: 50px;
                height: 50px;
                transform: rotate(${headingDeg}deg);
                pointer-events: none;
                z-index: 1;
              ">
                <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; overflow: visible; opacity: 0.35;">
                  <defs>
                    <linearGradient id="coneGrad-${device.device_id}" x1="50%" y1="50%" x2="50%" y2="0%">
                      <stop offset="0%" stop-color="${color}" stop-opacity="0.8"/>
                      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
                    </linearGradient>
                  </defs>
                  <polygon points="50,50 20,0 80,0" fill="url(#coneGrad-${device.device_id})"/>
                </svg>
              </div>
            ` : `
              <!-- Outer Glow Radar Beacon -->
              <div style="
                position: absolute;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: ${color};
                opacity: 0.2;
              " class="${device.online ? 'pulse-active' : ''}"></div>
            `}
            
            <!-- Center Node / Directional Arrow -->
            <div style="
              position: relative;
              width: ${hasHeading ? '24px' : '18px'};
              height: ${hasHeading ? '24px' : '18px'};
              border-radius: 50%;
              background: #ffffff;
              border: 2.5px solid ${color};
              box-shadow: 0 2px 8px rgba(0,0,0,0.18);
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 2;
              ${hasHeading ? `transform: rotate(${headingDeg}deg); transition: transform 0.2s ease-out;` : ''}
            ">
              ${hasHeading ? `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="${color}" stroke="${color}" stroke-width="1">
                  <polygon points="12 2 19 21 12 17 5 21 12 2"/>
                </svg>
              ` : isStation ? `
                <div style="width: 8px; height: 8px; border-radius: 2px; background: ${color};"></div>
              ` : `
                <div style="width: 6px; height: 6px; border-radius: 50%; background: ${color};"></div>
              `}
            </div>
            
            <!-- Device Label Pill -->
            <div style="
              position: absolute;
              bottom: -18px;
              left: 50%;
              transform: translateX(-50%);
              background: rgba(255, 255, 255, 0.96);
              border: 1px solid ${isStation ? '#bfdbfe' : '#e5ede6'};
              color: ${isStation ? '#1e40af' : '#064e3b'};
              font-size: 10px;
              font-weight: 700;
              padding: 1px 6px;
              border-radius: 6px;
              white-space: nowrap;
              box-shadow: 0 2px 5px rgba(0,0,0,0.08);
              pointer-events: none;
              z-index: 3;
            ">
              ${device.name || device.device_id} ${hasHeading ? `(${headingDeg}°)` : ''}
            </div>
          </div>
        `;

        const customIcon = L.divIcon({
          html: iconHtml,
          className: "custom-leaflet-device",
          iconSize: [44, 44],
          iconAnchor: [22, 22],
          popupAnchor: [0, -22]
        });

        // Upsert Marker
        if (!markersRef.current[device.device_id]) {
          const marker = L.marker(pos, { icon: customIcon }).addTo(map);
          marker.on("click", () => {
            if (onSelectDeviceRef.current) {
              onSelectDeviceRef.current(device);
            }
          });
          markersRef.current[device.device_id] = marker;
        } else {
          markersRef.current[device.device_id].setLatLng(pos);
          markersRef.current[device.device_id].setIcon(customIcon);
        }

        // Upsert Accuracy Circle
        const accuracy = device.accuracy_m || 5;
        if (!circlesRef.current[device.device_id]) {
          const circle = L.circle(pos, {
            radius: accuracy,
            color: color,
            weight: 1,
            fillColor: color,
            fillOpacity: 0.08
          }).addTo(map);
          circlesRef.current[device.device_id] = circle;
        } else {
          circlesRef.current[device.device_id].setLatLng(pos);
          circlesRef.current[device.device_id].setRadius(accuracy);
        }

        // Upsert Polyline Trail
        if (activeTrails[device.device_id] && device.history && device.history.length > 1) {
          const latLngs: [number, number][] = device.history.map((h) => [h.lat, h.lon]);
          if (!polylinesRef.current[device.device_id]) {
            const polyline = L.polyline(latLngs, {
              color: color,
              weight: 3,
              opacity: 0.85,
              dashArray: "4, 6"
            }).addTo(map);
            polylinesRef.current[device.device_id] = polyline;
          } else {
            polylinesRef.current[device.device_id].setLatLngs(latLngs);
          }
        } else if (polylinesRef.current[device.device_id]) {
          map.removeLayer(polylinesRef.current[device.device_id]);
          delete polylinesRef.current[device.device_id];
        }
      });

      // =========================================================================
      // Render Shared Perception FOV Vision Cones & Projected Threats
      // =========================================================================
      fovLayersRef.current.forEach((l) => map.removeLayer(l));
      fovLayersRef.current = [];
      threatLayersRef.current.forEach((l) => map.removeLayer(l));
      threatLayersRef.current = [];
      blindSpotLayersRef.current.forEach((l) => map.removeLayer(l));
      blindSpotLayersRef.current = [];

      devices.forEach((device) => {
        const color = device.color || (device.type === "station" ? "#2563eb" : "#059669");

        // 1. Render FOV Vision Cone Polygon
        if (device.fov_polygon && device.fov_polygon.length >= 3 && device.online) {
          const fovPoly = L.polygon(device.fov_polygon, {
            color: color,
            weight: 1.5,
            opacity: 0.7,
            dashArray: "4, 4",
            fillColor: color,
            fillOpacity: 0.12,
            interactive: false
          }).addTo(map);
          fovLayersRef.current.push(fovPoly);
        }

        // 2. Render Projected Threats detected by this device
        const threats = device.projected_threats || device.detections || [];
        threats.forEach((t) => {
          if (t.globalLat && t.globalLon) {
            const threatPos: [number, number] = [t.globalLat, t.globalLon];

            // Threat Marker Icon
            const threatIcon = L.divIcon({
              html: `
                <div style="
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  animation: pulse 1.5s infinite;
                ">
                  <div style="
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    background: #fee2e2;
                    border: 2px solid #ef4444;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #dc2626;
                    font-size: 14px;
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
                  ">
                    ⚠️
                  </div>
                  <div style="
                    background: rgba(15, 23, 42, 0.9);
                    color: #ffffff;
                    font-size: 9px;
                    font-weight: 800;
                    padding: 1px 5px;
                    border-radius: 4px;
                    margin-top: 2px;
                    white-space: nowrap;
                    font-family: monospace;
                  ">
                    ${t.class || "THREAT"} (${t.est_distance_m ? `${t.est_distance_m}m` : ""})
                  </div>
                </div>
              `,
              className: "threat-map-marker",
              iconSize: [40, 48],
              iconAnchor: [20, 24]
            });

            const tMarker = L.marker(threatPos, { icon: threatIcon }).addTo(map);
            threatLayersRef.current.push(tMarker);

            // Tactical Dotted Line from Observer to Threat
            const observerLine = L.polyline([[device.lat, device.lon], threatPos], {
              color: "#ef4444",
              weight: 2,
              opacity: 0.8,
              dashArray: "3, 5"
            }).addTo(map);
            threatLayersRef.current.push(observerLine);
          }
        });

        // 3. Render Blind-Spot Alerts
        if (device.blind_spot_alerts) {
          device.blind_spot_alerts.forEach((alert) => {
            if (alert.threatLat && alert.threatLon) {
              const blindLine = L.polyline([[device.lat, device.lon], [alert.threatLat, alert.threatLon]], {
                color: "#e11d48",
                weight: 3,
                opacity: 0.9,
                dashArray: "6, 6"
              }).addTo(map);
              blindSpotLayersRef.current.push(blindLine);
            }
          });
        }
      });

      // Auto-fit bounds on first load if user hasn't panned
      if (!userInteractedRef.current && devices.length > 0) {
        const bounds = L.latLngBounds(devices.map((d) => [d.lat, d.lon]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }
    });
  }, [devices, activeTrails]);

  // Geofences rendering (Circles and Multi-Waypoint Polygons)
  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then((L) => {
      const map = mapRef.current;
      geofenceLayersRef.current.forEach((layer) => map.removeLayer(layer));
      geofenceLayersRef.current = [];

      geofences.forEach((zone) => {
        if (!zone.enabled) return;

        const isPolygon = zone.type === "polygon" && zone.waypoints && zone.waypoints.length >= 3;

        if (isPolygon && zone.waypoints) {
          // Render Waypoint Enclosed Polygon
          const polygon = L.polygon(zone.waypoints, {
            color: zone.color || "#059669",
            weight: 2.5,
            dashArray: "6, 6",
            fillColor: zone.color || "#10b981",
            fillOpacity: 0.16
          }).addTo(map);

          // Add waypoint vertex pins
          zone.waypoints.forEach((wp, idx) => {
            const wpIcon = L.divIcon({
              html: `
                <div style="
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  width: 18px;
                  height: 18px;
                  border-radius: 50%;
                  background: #ffffff;
                  border: 2px solid ${zone.color};
                  color: ${zone.color};
                  font-size: 9px;
                  font-weight: 800;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                ">
                  ${idx + 1}
                </div>
              `,
              className: "waypoint-vertex-pin",
              iconSize: [18, 18],
              iconAnchor: [9, 9]
            });
            const wpMarker = L.marker(wp, { icon: wpIcon }).addTo(map);
            geofenceLayersRef.current.push(wpMarker);
          });

          const perimeter = calculatePolygonPerimeterMeters(zone.waypoints);
          polygon.bindTooltip(`
            <div style="padding: 4px 6px;">
              <b style="color: ${zone.color}">${zone.name}</b> (Waypoint Region)<br/>
              <b>Waypoints:</b> ${zone.waypoints.length} points<br/>
              <b>Perimeter:</b> ${formatDistance(perimeter)}
            </div>
          `, { permanent: false, direction: "top" });

          geofenceLayersRef.current.push(polygon);
        } else {
          // Render Geofence Radius Circle
          const circle = L.circle(zone.center, {
            radius: zone.radiusMeters,
            color: zone.color || "#059669",
            weight: 2,
            dashArray: "6, 6",
            fillColor: zone.color || "#10b981",
            fillOpacity: 0.14
          }).addTo(map);

          // Center Pin Marker
          const centerIcon = L.divIcon({
            html: `
              <div style="
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: ${zone.color};
                border: 2px solid #ffffff;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
              "></div>
            `,
            className: "geofence-center-pin",
            iconSize: [10, 10],
            iconAnchor: [5, 5]
          });
          const centerMarker = L.marker(zone.center, { icon: centerIcon }).addTo(map);

          circle.bindTooltip(`
            <div style="padding: 2px 4px;">
              <b>${zone.name}</b> (Circular Fence)<br/>
              Radius: ${formatDistance(zone.radiusMeters)}<br/>
              Center: ${zone.center[0].toFixed(5)}, ${zone.center[1].toFixed(5)}
            </div>
          `, { permanent: false, direction: "top" });

          geofenceLayersRef.current.push(circle, centerMarker);
        }
      });
    });
  }, [geofences]);

  // Live Interactive In-Progress Waypoint Drawing Layer
  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then((L) => {
      const map = mapRef.current;
      drawingLayersRef.current.forEach((layer) => map.removeLayer(layer));
      drawingLayersRef.current = [];

      if (!isDrawingWaypoints || drawingWaypoints.length === 0) return;

      // 1. Draw connecting polyline or enclosed polygon preview
      if (drawingWaypoints.length >= 3) {
        const previewPoly = L.polygon(drawingWaypoints, {
          color: drawingColor,
          weight: 2.5,
          dashArray: "4, 4",
          fillColor: drawingColor,
          fillOpacity: 0.2
        }).addTo(map);
        drawingLayersRef.current.push(previewPoly);
      } else if (drawingWaypoints.length === 2) {
        const previewLine = L.polyline(drawingWaypoints, {
          color: drawingColor,
          weight: 2.5,
          dashArray: "4, 4"
        }).addTo(map);
        drawingLayersRef.current.push(previewLine);
      }

      // 2. Draw numbered interactive waypoint pins
      drawingWaypoints.forEach((wp, idx) => {
        const pinIcon = L.divIcon({
          html: `
            <div style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 24px;
              height: 24px;
              border-radius: 50%;
              background: ${drawingColor};
              color: #ffffff;
              font-size: 11px;
              font-weight: 800;
              border: 2.5px solid #ffffff;
              box-shadow: 0 3px 8px rgba(0,0,0,0.35);
              transform: scale(1.1);
            ">
              W${idx + 1}
            </div>
          `,
          className: "drawing-waypoint-pin",
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        const marker = L.marker(wp, { icon: pinIcon }).addTo(map);
        drawingLayersRef.current.push(marker);
      });
    });
  }, [isDrawingWaypoints, drawingWaypoints, drawingColor]);

  const fitAllDevices = () => {
    if (!mapRef.current) return;
    import("leaflet").then((L) => {
      if (devices.length > 0) {
        const bounds = L.latLngBounds(devices.map((d) => [d.lat, d.lon]));
        mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
      } else if (geofences.length > 0) {
        const bounds = L.latLngBounds(geofences.map((g) => g.center));
        mapRef.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      }
      userInteractedRef.current = false;
    });
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: "500px" }}>
      {/* Map Target Container */}
      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: "100%",
          zIndex: 1,
          cursor: isDrawingWaypoints ? "crosshair" : "grab"
        }}
      />

      {/* Floating Waypoint Drawing Mode Banner */}
      {isDrawingWaypoints && (
        <div style={{
          position: "absolute",
          top: "16px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          backgroundColor: "#ffffff",
          border: `2px solid ${drawingColor}`,
          borderRadius: "var(--radius-md)",
          padding: "10px 18px",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.15)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          animation: "fadeIn 0.2s ease"
        }}>
          <div style={{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            backgroundColor: drawingColor
          }} className="pulse-active" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--emerald-dark)" }}>
              📍 Waypoint Geofence Marking Active
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
              Click on map to drop waypoint vertices ({drawingWaypoints.length} placed · {drawingWaypoints.length < 3 ? `Need ${3 - drawingWaypoints.length} more` : "Perimeter enclosed"})
            </span>
          </div>
        </div>
      )}

      {/* Floating Map Controls & Overlays */}
      <div style={{
        position: "absolute",
        top: "16px",
        right: "16px",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}>
        {/* Fit Bounds Button */}
        <button
          onClick={fitAllDevices}
          title="Fit view to all active targets and geofences"
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid var(--border-light)",
            borderRadius: "10px",
            padding: "10px",
            cursor: "pointer",
            boxShadow: "var(--shadow-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--emerald-dark)",
            transition: "all 0.2s"
          }}
        >
          <Maximize2 size={18} />
        </button>

        {/* Map Tile Layer Selector */}
        <div style={{
          backgroundColor: "#ffffff",
          border: "1px solid var(--border-light)",
          borderRadius: "10px",
          padding: "4px",
          boxShadow: "var(--shadow-md)",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          <button
            onClick={() => setMapStyle("light")}
            style={{
              border: "none",
              background: mapStyle === "light" ? "var(--bg-green-tint)" : "transparent",
              color: mapStyle === "light" ? "var(--emerald-primary)" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "11px",
              padding: "6px 8px",
              borderRadius: "6px",
              cursor: "pointer",
              textAlign: "left"
            }}
          >
            Light Minimal
          </button>
          <button
            onClick={() => setMapStyle("osm")}
            style={{
              border: "none",
              background: mapStyle === "osm" ? "var(--bg-green-tint)" : "transparent",
              color: mapStyle === "osm" ? "var(--emerald-primary)" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "11px",
              padding: "6px 8px",
              borderRadius: "6px",
              cursor: "pointer",
              textAlign: "left"
            }}
          >
            Streets
          </button>
          <button
            onClick={() => setMapStyle("satellite")}
            style={{
              border: "none",
              background: mapStyle === "satellite" ? "var(--bg-green-tint)" : "transparent",
              color: mapStyle === "satellite" ? "var(--emerald-primary)" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: "11px",
              padding: "6px 8px",
              borderRadius: "6px",
              cursor: "pointer",
              textAlign: "left"
            }}
          >
            Satellite
          </button>
        </div>
      </div>

      {/* Floating Status Pill on Top Left of Map */}
      <div style={{
        position: "absolute",
        top: "16px",
        left: "16px",
        zIndex: 10,
        backgroundColor: "rgba(255, 255, 255, 0.94)",
        backdropFilter: "blur(8px)",
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
        padding: "8px 14px",
        boxShadow: "var(--shadow-md)",
        display: "flex",
        alignItems: "center",
        gap: "10px"
      }}>
        <div style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: devices.length > 0 ? "#10b981" : "#94a3b8"
        }} className={devices.length > 0 ? "pulse-active" : ""} />
        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--emerald-dark)" }}>
          {devices.length} {devices.length === 1 ? "Target" : "Targets"} Active · {geofences.filter(g => g.enabled).length} Geofences
        </span>
      </div>
    </div>
  );
}
