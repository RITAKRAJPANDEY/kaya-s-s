#!/usr/bin/env bash
# Generates a self-signed TLS certificate so phone browsers will allow
# camera access (getUserMedia requires a "secure context" — plain HTTP
# over a LAN IP does not count, even on your own WiFi).
set -e
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout key.pem -out cert.pem \
  -subj "/CN=worksiteguard.local"
echo "Created key.pem and cert.pem in $(pwd)"
