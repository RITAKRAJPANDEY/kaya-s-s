import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow mobile devices on LAN to load Next.js chunks and HMR in development
  allowedDevOrigins: [
    "localhost:3001",
    "127.0.0.1:3001",
    "10.201.61.146",
    "10.201.61.146:3001",
    "10.236.6.146",
    "10.236.6.146:3001",
    "192.168.137.1",
    "192.168.137.1:3001",
    "*"
  ]
};

export default nextConfig;

