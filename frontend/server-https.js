const { createServer } = require("https");
const { parse } = require("url");
const next = require("next");
const fs = require("fs");
const path = require("path");
const os = require("os");
const selfsigned = require("selfsigned");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

// Determine local LAN IP
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

const localIp = getLocalIp();
const certDir = path.join(__dirname, ".certs");
const keyPath = path.join(certDir, "dev-key.pem");
const certPath = path.join(certDir, "dev-cert.pem");

// Generate certificates if not already existing
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

let key, cert;
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.log("🔐 Generating local SSL certificates for HTTPS...");
  const attrs = [{ name: "commonName", value: localIp }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
          { type: 7, ip: localIp }
        ]
      }
    ]
  });

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  key = pems.private;
  cert = pems.cert;
  console.log("✅ SSL certificates created in .certs/");
} else {
  key = fs.readFileSync(keyPath);
  cert = fs.readFileSync(certPath);
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer({ key, cert }, async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  server.listen(port, hostname, () => {
    console.log("\n=======================================================");
    console.log(`🚀 Secure HTTPS Server is running!`);
    console.log(`   💻 Laptop:  https://localhost:${port}`);
    console.log(`   📱 Phone:   https://${localIp}:${port}/phone`);
    console.log("=======================================================\n");
  });
});
