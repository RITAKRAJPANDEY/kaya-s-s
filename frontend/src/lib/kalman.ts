/**
 * 2D/3D Kinematic Kalman Filter for GPS Geolocation & Speed Estimation
 * 
 * Features:
 * - Dynamic process noise covariance (Q) and measurement noise covariance (R) scaled by GPS accuracy.
 * - Optimal state estimation for Latitude, Longitude, Altitude, and Velocity.
 * - Outlier gating (rejects multipath / satellite glitch spikes).
 * - Smooth instantaneous speed derivation directly from state vector.
 */

export interface KalmanState {
  lat: number;
  lon: number;
  alt: number;
  speedMps: number;
  accuracy: number;
  timestamp: number;
}

export class GPSKalmanFilter {
  // Degrees per meter at the equator (approximate)
  private static readonly METERS_PER_DEGREE_LAT = 111132.954;

  // State variables
  private lat: number = 0;
  private lon: number = 0;
  private alt: number = 0;
  
  // Velocity in meters per second
  private vLatMps: number = 0;
  private vLonMps: number = 0;
  private vAltMps: number = 0;

  // Covariance matrix diagonal elements (P)
  private variancePos: number = 64; // Initial position variance in meters^2 (8m std dev)
  private varianceVel: number = 25; // Initial velocity variance in (m/s)^2 (5m/s std dev)

  // Process noise parameter (Q): how quickly acceleration changes (m/s^2)^2
  private processNoise: number = 3.0; // 3 m/s^2 for human/vehicle motion

  private lastTimestamp: number = 0;
  private isInitialized: boolean = false;

  constructor(processNoise: number = 3.0) {
    this.processNoise = processNoise;
  }

  /**
   * Reset filter state
   */
  public reset(): void {
    this.isInitialized = false;
    this.variancePos = 64;
    this.varianceVel = 25;
    this.vLatMps = 0;
    this.vLonMps = 0;
    this.vAltMps = 0;
    this.lastTimestamp = 0;
  }

  /**
   * Convert latitude displacement in meters to degrees
   */
  private metersToDegreesLat(meters: number): number {
    return meters / GPSKalmanFilter.METERS_PER_DEGREE_LAT;
  }

  /**
   * Convert longitude displacement in meters to degrees at a given latitude
   */
  private metersToDegreesLon(meters: number, lat: number): number {
    const rad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(rad);
    const metersPerDegreeLon = GPSKalmanFilter.METERS_PER_DEGREE_LAT * Math.max(cosLat, 0.01);
    return meters / metersPerDegreeLon;
  }

  /**
   * Convert latitude displacement in degrees to meters
   */
  private degreesLatToMeters(deg: number): number {
    return deg * GPSKalmanFilter.METERS_PER_DEGREE_LAT;
  }

  /**
   * Convert longitude displacement in degrees to meters at a given latitude
   */
  private degreesLonToMeters(deg: number, lat: number): number {
    const rad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(rad);
    const metersPerDegreeLon = GPSKalmanFilter.METERS_PER_DEGREE_LAT * Math.max(cosLat, 0.01);
    return deg * metersPerDegreeLon;
  }

  /**
   * Update the Kalman filter with a new raw GPS observation
   * 
   * @param rawLat Raw measured Latitude from GPS sensor
   * @param rawLon Raw measured Longitude from GPS sensor
   * @param accuracyM Measured accuracy radius in meters (from sensor pos.coords.accuracy)
   * @param timestampSec Epoch time in seconds (e.g. Date.now() / 1000)
   * @param rawAlt Measured Altitude in meters (optional)
   * @returns Filtered optimal state (lat, lon, alt, speed, accuracy)
   */
  public update(
    rawLat: number,
    rawLon: number,
    accuracyM: number = 5,
    timestampSec: number = Date.now() / 1000,
    rawAlt: number = 0
  ): KalmanState {
    // 1. First fix initialization
    if (!this.isInitialized || this.lastTimestamp === 0) {
      this.lat = rawLat;
      this.lon = rawLon;
      this.alt = rawAlt || 0;
      this.lastTimestamp = timestampSec;
      this.variancePos = Math.max(accuracyM * accuracyM, 4);
      this.varianceVel = 9; // 3 m/s uncertainty
      this.isInitialized = true;

      return {
        lat: this.lat,
        lon: this.lon,
        alt: this.alt,
        speedMps: 0,
        accuracy: Math.min(accuracyM, Math.sqrt(this.variancePos)),
        timestamp: timestampSec
      };
    }

    // Calculate time delta (dt in seconds)
    const dt = timestampSec - this.lastTimestamp;
    
    // If time delta is non-positive or stale (> 15 seconds), re-initialize position
    if (dt <= 0.001 || dt > 15) {
      this.lat = rawLat;
      this.lon = rawLon;
      this.alt = rawAlt || 0;
      this.lastTimestamp = timestampSec;
      this.variancePos = Math.max(accuracyM * accuracyM, 4);
      return {
        lat: this.lat,
        lon: this.lon,
        alt: this.alt,
        speedMps: Math.sqrt(this.vLatMps * this.vLatMps + this.vLonMps * this.vLonMps),
        accuracy: Math.min(accuracyM, Math.sqrt(this.variancePos)),
        timestamp: timestampSec
      };
    }

    // ==========================================
    // STEP 1: PREDICT (Time Update)
    // ==========================================
    // Project position forward using estimated velocity: x_k = x_{k-1} + v * dt
    const predLat = this.lat + this.metersToDegreesLat(this.vLatMps * dt);
    const predLon = this.lon + this.metersToDegreesLon(this.vLonMps * dt, this.lat);
    const predAlt = this.alt + this.vAltMps * dt;

    // Project covariance forward: P_k = P_{k-1} + Q * dt
    const qPos = 0.5 * this.processNoise * dt * dt;
    const qVel = this.processNoise * dt;
    const predVariancePos = this.variancePos + this.varianceVel * dt * dt + qPos;
    const predVarianceVel = this.varianceVel + qVel;

    // ==========================================
    // STEP 2: MEASUREMENT UPDATE (Kalman Gain & Correction)
    // ==========================================
    // Measurement noise covariance (R): accuracy^2 (clamped for realism)
    const measurementVariance = Math.max(accuracyM * accuracyM, 2.25); // minimum 1.5m std dev

    // Innovation (Measurement residual in meters)
    const deltaLatMeters = this.degreesLatToMeters(rawLat - predLat);
    const deltaLonMeters = this.degreesLonToMeters(rawLon - predLon, predLat);
    const deltaAltMeters = (rawAlt || predAlt) - predAlt;
    const innovationDistMeters = Math.sqrt(deltaLatMeters * deltaLatMeters + deltaLonMeters * deltaLonMeters);

    // Outlier Gating: If the measurement jumped by > 120m in a fraction of a second with low accuracy,
    // inflate R to smoothly reject the glitch.
    let effectiveR = measurementVariance;
    if (innovationDistMeters > 35 && dt < 2.0 && accuracyM > 10) {
      effectiveR *= 5.0; // Heavily distrust glitch
    }

    // Kalman Gain for position: K = P / (P + R)
    const kalmanGainPos = predVariancePos / (predVariancePos + effectiveR);

    // Kalman Gain for velocity: K_v = P_v / (P_v + R / dt^2)
    const kalmanGainVel = predVarianceVel / (predVarianceVel + (effectiveR / Math.max(dt * dt, 0.04)));

    // Correct Position state
    const correctedDeltaLatM = deltaLatMeters * kalmanGainPos;
    const correctedDeltaLonM = deltaLonMeters * kalmanGainPos;
    const correctedDeltaAltM = deltaAltMeters * kalmanGainPos;

    this.lat = predLat + this.metersToDegreesLat(correctedDeltaLatM);
    this.lon = predLon + this.metersToDegreesLon(correctedDeltaLonM, predLat);
    this.alt = predAlt + correctedDeltaAltM;

    // Correct Velocity state
    // Derived velocity from measurement innovation
    const measuredVLat = deltaLatMeters / dt;
    const measuredVLon = deltaLonMeters / dt;
    const measuredVAlt = deltaAltMeters / dt;

    this.vLatMps = (1 - kalmanGainVel) * this.vLatMps + kalmanGainVel * measuredVLat;
    this.vLonMps = (1 - kalmanGainVel) * this.vLonMps + kalmanGainVel * measuredVLon;
    this.vAltMps = (1 - kalmanGainVel) * this.vAltMps + kalmanGainVel * measuredVAlt;

    // Update covariance matrices: P = (1 - K) * P_pred
    this.variancePos = (1 - kalmanGainPos) * predVariancePos;
    this.varianceVel = (1 - kalmanGainVel) * predVarianceVel;

    this.lastTimestamp = timestampSec;

    // Calculate magnitude of instantaneous velocity vector (speed in m/s)
    let speedMps = Math.sqrt(this.vLatMps * this.vLatMps + this.vLonMps * this.vLonMps);
    
    // Apply deadband: if speed < 0.25 m/s (~0.9 km/h), treat as stationary to stop drift
    if (speedMps < 0.25) {
      speedMps = 0;
      this.vLatMps *= 0.2;
      this.vLonMps *= 0.2;
    }

    const filteredAccuracy = Math.min(accuracyM, Math.max(Math.sqrt(this.variancePos), 1.2));

    return {
      lat: this.lat,
      lon: this.lon,
      alt: this.alt,
      speedMps,
      accuracy: filteredAccuracy,
      timestamp: timestampSec
    };
  }

  /**
   * Get current filter state
   */
  public getState(): KalmanState {
    const speedMps = Math.sqrt(this.vLatMps * this.vLatMps + this.vLonMps * this.vLonMps);
    return {
      lat: this.lat,
      lon: this.lon,
      alt: this.alt,
      speedMps: speedMps < 0.25 ? 0 : speedMps,
      accuracy: Math.max(Math.sqrt(this.variancePos), 1.2),
      timestamp: this.lastTimestamp
    };
  }
}
