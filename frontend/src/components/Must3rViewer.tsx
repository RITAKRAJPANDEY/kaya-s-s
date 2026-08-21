"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { 
  Maximize2, 
  Minimize2, 
  RotateCcw, 
  Eye, 
  Layers, 
  Compass, 
  Camera, 
  Sliders, 
  Sun, 
  Grid, 
  Download,
  Info
} from "lucide-react";

export interface Point3D {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  conf: number;
}

export interface CameraPose {
  frame_idx: number;
  timestamp: number;
  position: [number, number, number];
  rotation_euler: [number, number, number];
  confidence: number;
  is_keyframe?: boolean;
}

export interface SceneData {
  source?: string;
  model_checkpoint?: string;
  point_count: number;
  keyframe_count?: number;
  total_frames?: number;
  trajectory_length_m?: number;
  mean_reprojection_conf?: number;
  points: Point3D[];
  poses: CameraPose[];
}

interface Must3rViewerProps {
  sceneData: SceneData | null;
  isLoading?: boolean;
  selectedFrameIdx?: number | null;
  onSelectFrame?: (frameIdx: number) => void;
}

export default function Must3rViewer({
  sceneData,
  isLoading = false,
  selectedFrameIdx = null,
  onSelectFrame
}: Must3rViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Three.js instance refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pointsMeshRef = useRef<THREE.Points | null>(null);
  const trajectoryGroupRef = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  // Interaction State
  const [pointSize, setPointSize] = useState<number>(3.5);
  const [confThreshold, setConfThreshold] = useState<number>(1.2);
  const [colorMode, setColorMode] = useState<"rgb" | "depth" | "height" | "confidence">("rgb");
  const [showTrajectory, setShowTrajectory] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [hoveredPose, setHoveredPose] = useState<CameraPose | null>(null);

  // Mouse drag & Orbit control state
  const isDraggingRef = useRef<boolean>(false);
  const prevMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const cameraSphericalRef = useRef<{ radius: number; theta: number; phi: number }>({
    radius: 22,
    theta: 0.6,
    phi: 1.1
  });
  const cameraTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));

  // Initialize Three.js Scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1d);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    // Ambient & Directional Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    // Ground Grid
    const gridHelper = new THREE.GridHelper(32, 32, 0x10b981, 0x1e293b);
    gridHelper.position.y = -1.25;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // Axes Helper
    const axesHelper = new THREE.AxesHelper(3);
    axesHelper.position.set(-14, -1.2, -14);
    scene.add(axesHelper);
    axesHelperRef.current = axesHelper;

    // Trajectory Group
    const trajGroup = new THREE.Group();
    scene.add(trajGroup);
    trajectoryGroupRef.current = trajGroup;

    // Update Camera position based on spherical coordinates
    const updateCameraPos = () => {
      const { radius, theta, phi } = cameraSphericalRef.current;
      const target = cameraTargetRef.current;
      camera.position.x = target.x + radius * Math.sin(phi) * Math.sin(theta);
      camera.position.y = target.y + radius * Math.cos(phi);
      camera.position.z = target.z + radius * Math.sin(phi) * Math.cos(theta);
      camera.lookAt(target);
    };
    updateCameraPos();

    // Render loop
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries[0] || !cameraRef.current || !rendererRef.current) return;
      const { width: newW, height: newH } = entries[0].contentRect;
      if (newW > 0 && newH > 0) {
        cameraRef.current.aspect = newW / newH;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(newW, newH);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      resizeObserver.disconnect();
      renderer.dispose();
    };
  }, []);

  // Update Points Mesh when sceneData, colorMode, pointSize, or confThreshold changes
  useEffect(() => {
    if (!sceneRef.current || !sceneData || !sceneData.points) return;

    const scene = sceneRef.current;
    if (pointsMeshRef.current) {
      scene.remove(pointsMeshRef.current);
      pointsMeshRef.current.geometry.dispose();
      (pointsMeshRef.current.material as THREE.Material).dispose();
      pointsMeshRef.current = null;
    }

    const rawPoints = sceneData.points.filter((p) => p.conf >= confThreshold);
    const count = rawPoints.length;
    if (count === 0) return;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    // Compute min/max for color scales
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const p = rawPoints[i];
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const rangeY = Math.max(0.01, maxY - minY);
    const rangeZ = Math.max(0.01, maxZ - minZ);

    for (let i = 0; i < count; i++) {
      const p = rawPoints[i];
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;

      if (colorMode === "rgb") {
        colors[i * 3] = p.r / 255;
        colors[i * 3 + 1] = p.g / 255;
        colors[i * 3 + 2] = p.b / 255;
      } else if (colorMode === "height") {
        // Elevation colormap (Cyan to Yellow to Orange)
        const t = (p.y - minY) / rangeY;
        colors[i * 3] = Math.min(1, t * 1.5);
        colors[i * 3 + 1] = Math.min(1, (1 - Math.abs(t - 0.5) * 2));
        colors[i * 3 + 2] = Math.max(0, 1 - t * 2);
      } else if (colorMode === "depth") {
        // Depth / Distance gradient (Viridis style: Purple to Teal to Yellow)
        const t = (p.z - minZ) / rangeZ;
        colors[i * 3] = Math.sin(t * Math.PI) * 0.8;
        colors[i * 3 + 1] = t * 0.9;
        colors[i * 3 + 2] = (1 - t) * 0.9 + 0.1;
      } else if (colorMode === "confidence") {
        // Confidence Heatmap (Red < 2.0 -> Amber -> Emerald Green > 4.0)
        const normConf = Math.min(1, Math.max(0, (p.conf - 1.0) / 4.0));
        colors[i * 3] = normConf < 0.5 ? 1.0 : (1.0 - normConf) * 2;
        colors[i * 3 + 1] = normConf >= 0.5 ? 0.9 : normConf * 1.8;
        colors[i * 3 + 2] = 0.15;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      sizeAttenuation: true
    });

    const pointsMesh = new THREE.Points(geometry, material);
    scene.add(pointsMesh);
    pointsMeshRef.current = pointsMesh;
  }, [sceneData, colorMode, pointSize, confThreshold]);

  // Update 6-DoF Camera Trajectory Pyramids / Frustums
  useEffect(() => {
    if (!trajectoryGroupRef.current || !sceneData || !sceneData.poses) return;

    const group = trajectoryGroupRef.current;
    // Clear existing
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
      if ((child as any).material) (child as any).material.dispose();
    }

    if (!showTrajectory) return;

    const poses = sceneData.poses;
    const count = poses.length;
    if (count === 0) return;

    // 1. Path Line Connecting Poses
    const linePoints: THREE.Vector3[] = [];
    poses.forEach((p) => {
      linePoints.push(new THREE.Vector3(p.position[0], p.position[1], p.position[2]));
    });
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    });
    const pathLine = new THREE.Line(lineGeom, lineMat);
    group.add(pathLine);

    // 2. Camera Frustum Pyramids
    poses.forEach((p) => {
      const isSelected = selectedFrameIdx === p.frame_idx;
      const isKeyframe = p.is_keyframe;

      // Small 3D Camera Wireframe Frustum
      const frustumGeom = new THREE.ConeGeometry(0.35, 0.6, 4, 1, true);
      frustumGeom.rotateX(Math.PI / 2);
      frustumGeom.rotateZ(Math.PI / 4);

      const color = isSelected ? 0x22c55e : isKeyframe ? 0x38bdf8 : 0x64748b;
      const frustumMat = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: isSelected ? 1.0 : isKeyframe ? 0.85 : 0.4
      });

      const cone = new THREE.Mesh(frustumGeom, frustumMat);
      cone.position.set(p.position[0], p.position[1], p.position[2]);

      // Apply Euler rotation (Pitch, Yaw, Roll)
      const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(p.rotation_euler[0]),
        THREE.MathUtils.degToRad(p.rotation_euler[1]),
        THREE.MathUtils.degToRad(p.rotation_euler[2]),
        "YXZ"
      );
      cone.setRotationFromEuler(euler);

      cone.userData = { pose: p };
      group.add(cone);
    });
  }, [sceneData, showTrajectory, selectedFrameIdx]);

  // Toggle Grid
  useEffect(() => {
    if (gridHelperRef.current) gridHelperRef.current.visible = showGrid;
    if (axesHelperRef.current) axesHelperRef.current.visible = showGrid;
  }, [showGrid]);

  // Orbit & Pan Mouse Event Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    prevMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !cameraRef.current) return;

    const dx = e.clientX - prevMousePosRef.current.x;
    const dy = e.clientY - prevMousePosRef.current.y;
    prevMousePosRef.current = { x: e.clientX, y: e.clientY };

    if (e.buttons === 1) {
      // Left Click Drag -> Rotate (Orbit)
      const s = cameraSphericalRef.current;
      s.theta -= dx * 0.008;
      s.phi = Math.max(0.1, Math.min(Math.PI - 0.1, s.phi - dy * 0.008));
    } else if (e.buttons === 2 || e.buttons === 4) {
      // Right Click / Middle Drag -> Pan Target
      const right = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      cameraRef.current.getWorldDirection(right);
      right.cross(up).normalize();

      cameraTargetRef.current.addScaledVector(right, -dx * 0.02);
      cameraTargetRef.current.y += dy * 0.02;
    }

    const { radius, theta, phi } = cameraSphericalRef.current;
    const target = cameraTargetRef.current;
    cameraRef.current.position.x = target.x + radius * Math.sin(phi) * Math.sin(theta);
    cameraRef.current.position.y = target.y + radius * Math.cos(phi);
    cameraRef.current.position.z = target.z + radius * Math.sin(phi) * Math.cos(theta);
    cameraRef.current.lookAt(target);
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!cameraRef.current) return;
    const s = cameraSphericalRef.current;
    s.radius = Math.max(2, Math.min(100, s.radius + e.deltaY * 0.02));

    const target = cameraTargetRef.current;
    cameraRef.current.position.x = target.x + s.radius * Math.sin(s.phi) * Math.sin(s.theta);
    cameraRef.current.position.y = target.y + s.radius * Math.cos(s.phi);
    cameraRef.current.position.z = target.z + s.radius * Math.sin(s.phi) * Math.cos(s.theta);
    cameraRef.current.lookAt(target);
  };

  // Preset Views
  const setPresetView = (preset: "iso" | "top" | "front" | "reset") => {
    if (!cameraRef.current) return;
    const s = cameraSphericalRef.current;

    if (preset === "iso") {
      s.theta = 0.785; // 45 deg
      s.phi = 1.0;
      s.radius = 22;
      cameraTargetRef.current.set(0, 0, 0);
    } else if (preset === "top") {
      s.theta = 0;
      s.phi = 0.05; // Almost straight down
      s.radius = 26;
      cameraTargetRef.current.set(0, 0, 0);
    } else if (preset === "front") {
      s.theta = 0;
      s.phi = Math.PI / 2;
      s.radius = 22;
      cameraTargetRef.current.set(0, 0, 0);
    } else if (preset === "reset") {
      s.theta = 0.6;
      s.phi = 1.1;
      s.radius = 22;
      cameraTargetRef.current.set(0, 0, 0);
    }

    const target = cameraTargetRef.current;
    cameraRef.current.position.x = target.x + s.radius * Math.sin(s.phi) * Math.sin(s.theta);
    cameraRef.current.position.y = target.y + s.radius * Math.cos(s.phi);
    cameraRef.current.position.z = target.z + s.radius * Math.sin(s.phi) * Math.cos(s.theta);
    cameraRef.current.lookAt(target);
  };

  // Export Screenshot
  const handleExportScreenshot = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `must3r_3d_reconstruction_${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: isFullscreen ? "100vh" : "100%",
        minHeight: "440px",
        backgroundColor: "#0a0f1d",
        borderRadius: isFullscreen ? "0px" : "var(--radius-lg)",
        overflow: "hidden",
        border: isFullscreen ? "none" : "1px solid #1e293b",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
        zIndex: isFullscreen ? 9999 : 1,
        ...(isFullscreen ? { position: "fixed", top: 0, left: 0 } : {})
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(10, 15, 29, 0.75)",
          backdropFilter: "blur(4px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          color: "#ffffff"
        }}>
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            border: "3px solid rgba(16, 185, 129, 0.2)",
            borderTopColor: "#10b981",
            animation: "spin 0.8s linear infinite"
          }} />
          <span style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.02em" }}>
            Synthesizing 3D Spatial Geometry & Odometry...
          </span>
        </div>
      )}

      {/* Top Left: Metadata HUD Badge */}
      <div style={{
        position: "absolute",
        top: "14px",
        left: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        pointerEvents: "none"
      }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(8px)",
          padding: "6px 12px",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          color: "#ffffff",
          fontSize: "12px",
          fontWeight: 800
        }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#10b981" }} className="pulse-active" />
          <span>MUSt3R 3D MESH ENGINE</span>
          <span style={{ color: "rgba(255, 255, 255, 0.4)", fontWeight: 400 }}>|</span>
          <span style={{ color: "#38bdf8", fontFamily: "'JetBrains Mono', monospace" }}>
            {sceneData?.points?.length.toLocaleString() || "0"} pts
          </span>
        </div>

        {sceneData?.trajectory_length_m && (
          <div style={{
            fontSize: "11px",
            color: "rgba(255, 255, 255, 0.6)",
            backgroundColor: "rgba(15, 23, 42, 0.7)",
            padding: "4px 10px",
            borderRadius: "6px",
            display: "inline-block",
            width: "fit-content"
          }}>
            Trajectory: <b>{sceneData.trajectory_length_m}m</b> · Keyframes: <b>{sceneData.keyframe_count || 0}</b>
          </div>
        )}
      </div>

      {/* Top Right: Preset Views & Actions */}
      <div style={{
        position: "absolute",
        top: "14px",
        right: "14px",
        display: "flex",
        alignItems: "center",
        gap: "6px"
      }}>
        {/* Preset View Buttons */}
        <div style={{
          display: "flex",
          backgroundColor: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(8px)",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "3px"
        }}>
          <button
            onClick={() => setPresetView("iso")}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 700,
              color: "#ffffff",
              backgroundColor: "transparent",
              border: "none",
              cursor: "pointer",
              borderRadius: "4px"
            }}
            title="Isometric 3D View"
          >
            3D ISO
          </button>
          <button
            onClick={() => setPresetView("top")}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 700,
              color: "rgba(255, 255, 255, 0.7)",
              backgroundColor: "transparent",
              border: "none",
              cursor: "pointer",
              borderRadius: "4px"
            }}
            title="Top-Down Plan View"
          >
            TOP
          </button>
          <button
            onClick={() => setPresetView("front")}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 700,
              color: "rgba(255, 255, 255, 0.7)",
              backgroundColor: "transparent",
              border: "none",
              cursor: "pointer",
              borderRadius: "4px"
            }}
            title="Front Elevation View"
          >
            FRONT
          </button>
        </div>

        {/* Reset Camera */}
        <button
          onClick={() => setPresetView("reset")}
          title="Reset Camera Center"
          style={{
            width: "32px",
            height: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(8px)",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "#ffffff",
            cursor: "pointer"
          }}
        >
          <RotateCcw size={14} />
        </button>

        {/* Screenshot */}
        <button
          onClick={handleExportScreenshot}
          title="Download High-Res 3D Snapshot"
          style={{
            width: "32px",
            height: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(8px)",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "#ffffff",
            cursor: "pointer"
          }}
        >
          <Download size={14} />
        </button>

        {/* Fullscreen */}
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen 3D View"}
          style={{
            width: "32px",
            height: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(8px)",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "#ffffff",
            cursor: "pointer"
          }}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Bottom Floating Control Ribbon: Rendering Controls */}
      <div style={{
        position: "absolute",
        bottom: "14px",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        backdropFilter: "blur(12px)",
        padding: "8px 16px",
        borderRadius: "12px",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)"
      }}>
        {/* Color Mode Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255, 255, 255, 0.5)", textTransform: "uppercase" }}>
            Color:
          </span>
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as any)}
            style={{
              backgroundColor: "#1e293b",
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: 700,
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              padding: "3px 8px",
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value="rgb">RGB Real</option>
            <option value="height">Elevation (Y)</option>
            <option value="depth">Depth Gradient (Z)</option>
            <option value="confidence">Confidence Map</option>
          </select>
        </div>

        <div style={{ width: "1px", height: "18px", backgroundColor: "rgba(255, 255, 255, 0.15)" }} />

        {/* Point Size Slider */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255, 255, 255, 0.5)" }}>
            Size: {pointSize.toFixed(1)}
          </span>
          <input
            type="range"
            min="1.0"
            max="8.0"
            step="0.5"
            value={pointSize}
            onChange={(e) => setPointSize(parseFloat(e.target.value))}
            style={{ width: "65px", accentColor: "#10b981", cursor: "pointer" }}
          />
        </div>

        <div style={{ width: "1px", height: "18px", backgroundColor: "rgba(255, 255, 255, 0.15)" }} />

        {/* Confidence Filter Slider */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255, 255, 255, 0.5)" }}>
            Filter: ≥{confThreshold.toFixed(1)}
          </span>
          <input
            type="range"
            min="1.0"
            max="4.5"
            step="0.2"
            value={confThreshold}
            onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
            style={{ width: "65px", accentColor: "#38bdf8", cursor: "pointer" }}
          />
        </div>

        <div style={{ width: "1px", height: "18px", backgroundColor: "rgba(255, 255, 255, 0.15)" }} />

        {/* Toggle Trajectory */}
        <button
          onClick={() => setShowTrajectory(!showTrajectory)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "11px",
            fontWeight: 700,
            color: showTrajectory ? "#10b981" : "rgba(255, 255, 255, 0.4)",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer"
          }}
          title="Toggle 6-DoF Camera Trajectory"
        >
          <Camera size={13} />
          <span>Path</span>
        </button>

        {/* Toggle Grid */}
        <button
          onClick={() => setShowGrid(!showGrid)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "11px",
            fontWeight: 700,
            color: showGrid ? "#10b981" : "rgba(255, 255, 255, 0.4)",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer"
          }}
          title="Toggle Ground Grid"
        >
          <Grid size={13} />
          <span>Grid</span>
        </button>
      </div>

      {/* Navigation Help Cue */}
      <div style={{
        position: "absolute",
        bottom: "14px",
        left: "14px",
        fontSize: "10px",
        color: "rgba(255, 255, 255, 0.35)",
        pointerEvents: "none",
        lineHeight: 1.4
      }}>
        Left Click: Rotate · Right Click: Pan · Scroll: Zoom
      </div>
    </div>
  );
}
