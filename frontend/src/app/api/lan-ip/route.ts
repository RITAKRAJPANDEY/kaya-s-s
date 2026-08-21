import { NextResponse } from "next/server";
import os from "os";

export const dynamic = "force-dynamic";

export async function GET() {
  const interfaces = os.networkInterfaces();
  const candidates: { ip: string; name: string }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        // Exclude virtual/docker/WSL subnets if regular Wi-Fi is available
        candidates.push({ ip: addr.address, name });
      }
    }
  }

  // Prioritize active standard Wi-Fi (excluding virtual/hotspot adapters like Wi-Fi 5/Wi-Fi 2 if Wi-Fi exists)
  const wifiExact = candidates.find(c => c.name.toLowerCase() === "wi-fi" || c.name.toLowerCase() === "wireless");
  const wifiAny = candidates.find(c => c.name.toLowerCase().includes("wi-fi") || c.name.toLowerCase().includes("wlan"));
  const ethernet = candidates.find(c => c.name.toLowerCase().includes("ethernet") && !c.name.toLowerCase().includes("veth"));
  
  const primaryIp = wifiExact?.ip || wifiAny?.ip || ethernet?.ip || candidates[0]?.ip || "127.0.0.1";

  return NextResponse.json({
    ip: primaryIp,
    port: 3001,
    url: `http://${primaryIp}:3001/phone`,
    candidates
  });
}
