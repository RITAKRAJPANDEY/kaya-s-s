import { NextResponse } from "next/server";
import {
  broadcastTelemetryUpdate,
  getTelemetryStore,
  getActiveBlindSpotAlerts,
  processTelemetryPacket,
  removeTelemetryDevice,
  clearAllTelemetry
} from "@/lib/telemetryStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawData = await request.json();
    
    // Process packet through shared perception & blind-spot engine
    const { device, blindSpotAlerts } = processTelemetryPacket(rawData);

    // Instantly notify all SSE listeners (<3ms)
    broadcastTelemetryUpdate({ 
      type: "update", 
      device, 
      blind_spot_alerts: blindSpotAlerts,
      timestamp: Date.now() 
    });

    // Check if there is an alert specifically targeted at this device
    const targetAlerts = blindSpotAlerts.filter(a => a.targetAgentId === device.device_id);

    return NextResponse.json({
      status: "ok",
      device_id: device.device_id,
      agent_id: device.device_id,
      fov_points: device.fov_polygon?.length || 0,
      active_threats: device.projected_threats?.length || 0,
      blind_spot_alerts: targetAlerts,
      all_site_alerts_count: blindSpotAlerts.length,
      latency_ms: rawData.timestamp ? Math.max(0, Date.now() - rawData.timestamp) : 0
    });
  } catch (error) {
    return NextResponse.json({ status: "error", message: "Invalid telemetry payload" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    devices: Object.values(getTelemetryStore()),
    blind_spot_alerts: getActiveBlindSpotAlerts()
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const device_id = searchParams.get("device_id");
  const clear = searchParams.get("clear");

  if (clear === "all") {
    clearAllTelemetry();
    broadcastTelemetryUpdate({ type: "clear", target: "all" });
    return NextResponse.json({ status: "ok", message: "Cleared all devices" });
  }

  if (clear === "dummy" || clear === "stale") {
    const store = getTelemetryStore();
    Object.keys(store).forEach((id) => {
      if (id.startsWith("sim-") || (store[id] as any)?.simulated) {
        removeTelemetryDevice(id);
      }
    });
    return NextResponse.json({ status: "ok", message: "Cleared dummy devices" });
  }

  if (device_id) {
    removeTelemetryDevice(device_id);
    broadcastTelemetryUpdate({ type: "delete", device_id });
    return NextResponse.json({ status: "ok", message: `Device ${device_id} deleted` });
  }

  return NextResponse.json({ status: "ok", message: "No action taken" });
}
