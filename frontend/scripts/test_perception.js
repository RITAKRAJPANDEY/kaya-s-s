/**
 * Unit test suite for Shared Perception & Blind-Spot Detection Engine
 */

function projectCoordinates(originLat, originLon, bearingDeg, distanceMeters) {
  const thetaRad = (bearingDeg * Math.PI) / 180;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos((originLat * Math.PI) / 180);

  const dLat = (distanceMeters * Math.cos(thetaRad)) / metersPerDegreeLat;
  const dLon = (distanceMeters * Math.sin(thetaRad)) / metersPerDegreeLon;

  return [originLat + dLat, originLon + dLon];
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function isPointInPolygon(point, waypoints) {
  if (!waypoints || waypoints.length < 3) return false;

  const [lat, lon] = point;
  let inside = false;

  for (let i = 0, j = waypoints.length - 1; i < waypoints.length; j = i++) {
    const [latI, lonI] = waypoints[i];
    const [latJ, lonJ] = waypoints[j];

    const intersect =
      lonI > lon !== lonJ > lon &&
      lat < ((latJ - latI) * (lon - lonI)) / (lonJ - lonI) + latI;

    if (intersect) inside = !inside;
  }

  return inside;
}

function calculateFovPolygon(lat, lon, headingDeg, hfovDeg = 68, visibilityRangeMeters = 50, numArcPoints = 16) {
  const halfFov = hfovDeg / 2;
  const startAngle = headingDeg - halfFov;
  const endAngle = headingDeg + halfFov;

  const polygon = [[lat, lon]];

  for (let i = 0; i <= numArcPoints; i++) {
    const angle = startAngle + (i / numArcPoints) * (endAngle - startAngle);
    const point = projectCoordinates(lat, lon, angle, visibilityRangeMeters);
    polygon.push(point);
  }

  polygon.push([lat, lon]);
  return polygon;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

function determineRelativePosition(targetHeadingDeg, fromTargetToThreatBearingDeg) {
  const relativeAngle = ((fromTargetToThreatBearingDeg - targetHeadingDeg) % 360 + 360) % 360;

  if (relativeAngle >= 135 && relativeAngle <= 225) {
    return 'behind';
  } else if (relativeAngle > 45 && relativeAngle < 135) {
    return 'right_flank';
  } else if (relativeAngle > 225 && relativeAngle < 315) {
    return 'left_flank';
  }
  return 'obscured';
}

function runTests() {
  console.log("=== RUNNING SHARED PERCEPTION UNIT TESTS ===");

  // Test 1: FOV Polygon Computation
  const origin = [23.0225, 72.5714];
  const fovNorth = calculateFovPolygon(origin[0], origin[1], 0, 68, 50);
  console.log(`[TEST 1] FOV North points count: ${fovNorth.length}`);
  if (fovNorth.length < 18) throw new Error("FOV polygon missing vertices");

  // Test 2: Point in Front vs Point Behind
  const pointInFront = projectCoordinates(origin[0], origin[1], 0, 25); // 25m North
  const pointBehind = projectCoordinates(origin[0], origin[1], 180, 25); // 25m South

  const frontInFov = isPointInPolygon(pointInFront, fovNorth);
  const behindInFov = isPointInPolygon(pointBehind, fovNorth);

  console.log(`[TEST 2] Point 25m North in FOV (expect true): ${frontInFov}`);
  console.log(`[TEST 2] Point 25m South in FOV (expect false): ${behindInFov}`);
  if (!frontInFov || behindInFov) throw new Error("FOV point-in-polygon check failed");

  // Test 3: Multi-Agent Blind-Spot Scenario
  // Phone A is at origin (23.0225, 72.5714), looking North (0 deg)
  // Phone B is 20m North of Phone A (23.02268, 72.5714), also looking North (0 deg)
  // Phone A spots a threat 12m North of Phone A.
  // The threat is 8m BEHIND Phone B.
  const phoneA = {
    agent_id: "phoneA",
    lat: 23.0225,
    lon: 72.5714,
    heading_deg: 0,
    camera_hfov_deg: 68
  };
  const phoneB = {
    agent_id: "phoneB",
    lat: projectCoordinates(phoneA.lat, phoneA.lon, 0, 20)[0],
    lon: projectCoordinates(phoneA.lat, phoneA.lon, 0, 20)[1],
    heading_deg: 0, // Looking North
    camera_hfov_deg: 68
  };

  const threatGlobal = projectCoordinates(phoneA.lat, phoneA.lon, 0, 12);
  const phoneBFov = calculateFovPolygon(phoneB.lat, phoneB.lon, phoneB.heading_deg, 68, 50);

  const threatInAFov = isPointInPolygon(threatGlobal, fovNorth);
  const threatInBFov = isPointInPolygon(threatGlobal, phoneBFov);

  console.log(`[TEST 3] Threat in Phone A's FOV (expect true): ${threatInAFov}`);
  console.log(`[TEST 3] Threat in Phone B's FOV (expect false - Blind Spot): ${threatInBFov}`);

  if (!threatInAFov || threatInBFov) throw new Error("Blind spot test failed");

  const bearingBToThreat = calculateBearing(phoneB.lat, phoneB.lon, threatGlobal[0], threatGlobal[1]);
  const relPos = determineRelativePosition(phoneB.heading_deg, bearingBToThreat);
  const distBToThreat = calculateDistanceMeters(phoneB.lat, phoneB.lon, threatGlobal[0], threatGlobal[1]);

  console.log(`[TEST 3] Bearing from Phone B to Threat: ${Math.round(bearingBToThreat)}°`);
  console.log(`[TEST 3] Relative Position to Phone B: '${relPos}' (expect 'behind')`);
  console.log(`[TEST 3] Distance from Phone B to Threat: ${distBToThreat.toFixed(1)}m`);

  if (relPos !== 'behind') throw new Error("Relative position calculation failed");

  // Test 4: Phone B turns around (heading South = 180 deg)
  const phoneBFovTurned = calculateFovPolygon(phoneB.lat, phoneB.lon, 180, 68, 50);
  const threatInBFovTurned = isPointInPolygon(threatGlobal, phoneBFovTurned);
  console.log(`[TEST 4] Phone B turns around: Threat in Phone B's FOV now (expect true): ${threatInBFovTurned}`);
  if (!threatInBFovTurned) throw new Error("Turned FOV check failed");

  console.log("\n✅ ALL SHARED PERCEPTION & BLIND-SPOT TESTS PASSED WITH 100% ACCURACY!");
}

runTests();
