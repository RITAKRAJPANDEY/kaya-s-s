"""
Runs ON the Raspberry Pi. Reads a GPS module (NEO-6M/NEO-M8N over UART) and
an IMU (BNO055 recommended - it does onboard sensor fusion and gives you a
ready-to-use heading, saving you from writing a Kalman/complementary filter
yourself) and streams pose data to the server over WiFi.

Hardware assumed:
  - GPS module wired to the Pi's UART (e.g. /dev/serial0), producing NMEA sentences
  - BNO055 IMU wired over I2C

Install deps on the Pi:
  pip install pynmea2 pyserial adafruit-circuitpython-bno055 websockets

If you're using a different IMU (MPU6050, MPU9250, etc.) swap out the
read_heading() function - those chips give raw accel/gyro/mag and need your
own fusion filter to get a stable heading; BNO055 hands you one directly.
"""

import asyncio
import json
import time

import serial
import pynmea2
import websockets

SERVER_URL = "ws://SERVER_IP_HERE:8000/ws/device"  # <-- set this to your server's LAN IP
DEVICE_ID = "raspberry-pi"
GPS_PORT = "/dev/serial0"
GPS_BAUD = 9600

# --- IMU setup (BNO055 over I2C) ---
try:
    import board
    import adafruit_bno055
    i2c = board.I2C()
    imu = adafruit_bno055.BNO055_I2C(i2c)
except Exception as e:
    imu = None
    print(f"[warn] IMU not available ({e}); heading will be None")


def read_heading():
    """Returns compass heading in degrees (0=N, 90=E), or None."""
    if imu is None:
        return None
    try:
        # BNO055 euler[0] is heading in fusion (NDOF) mode
        euler = imu.euler
        return euler[0] if euler else None
    except Exception:
        return None


def read_gps_fix(ser):
    """Blocks briefly reading NMEA lines until a valid GGA/RMC fix is found."""
    line = ser.readline().decode("ascii", errors="ignore").strip()
    if not line.startswith("$"):
        return None
    try:
        msg = pynmea2.parse(line)
    except pynmea2.ParseError:
        return None

    if isinstance(msg, pynmea2.types.talker.GGA) and msg.gps_qual and msg.gps_qual > 0:
        return {"lat": msg.latitude, "lon": msg.longitude, "accuracy_m": None}
    return None


async def main():
    ser = serial.Serial(GPS_PORT, GPS_BAUD, timeout=1)

    async with websockets.connect(SERVER_URL) as ws:
        print("Connected to server, streaming pose...")
        last_fix = None
        while True:
            fix = read_gps_fix(ser)
            if fix:
                last_fix = fix

            if last_fix:
                payload = {
                    "device_id": DEVICE_ID,
                    "type": "raspberry-pi",
                    "lat": last_fix["lat"],
                    "lon": last_fix["lon"],
                    "heading": read_heading(),
                    "timestamp": time.time(),
                    "online": True,
                }
                await ws.send(json.dumps(payload))

            await asyncio.sleep(0.5)  # ~2 updates/sec


if __name__ == "__main__":
    asyncio.run(main())
