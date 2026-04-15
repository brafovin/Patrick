import * as THREE from 'three';

/**
 * Baut die 3D-Welt: Himmel, Boden, Haeuser (mit Tueren), Kisten, Baeume.
 * Gibt { scene, colliders, doors, botBuildingBoxes } zurueck.
 *
 * `colliders`       - AABB-Array fuer Spieler-Kollision + Raycasts
 * `doors`           - Array mit Tuer-Objekten { pivot, center, isOpen, openAngle, collider }
 * `botBuildingBoxes`- Vereinfachte 2D-Footprints (XZ) aller Gebaeude fuer Bot-KI
 */

const DOOR_W = 2.4;   // Tuerbreite
const DOOR_H = 2.6;   // Tuerhoehe (begehbar)
const WALL_T = 0.4;   // Wanddicke

export function buildWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 200, 480);

  // Licht
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(80, 160, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -200;
  sun.shadow.camera.right = 200;
  sun.shadow.camera.top = 200;
  sun.shadow.camera.bottom = -200;
  sun.shadow.camera.far = 400;
  scene.add(sun);

  // Boden
  const groundGeo = new THREE.PlaneGeometry(600, 600, 1, 1);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a7a3a });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Raster-Linien fuer Orientierung
  const grid = new THREE.GridHelper(600, 60, 0x2d4a22, 0x2d4a22);
  grid.position.y = 0.02;
  scene.add(grid);

  // Aussenmauer
  const outerWallMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
  const wallH = 6;
  const wallT = 2;
  const wallSize = 300;
  const colliders = [];
  const outerWalls = [
    [0, wallH / 2,  wallSize, wallSize * 2, wallH, wallT],
    [0, wallH / 2, -wallSize, wallSize * 2, wallH, wallT],
    [ wallSize, wallH / 2, 0, wallT, wallH, wallSize * 2],
    [-wallSize, wallH / 2, 0, wallT, wallH, wallSize * 2],
  ];
  for (const [x, y, z, sx, sy, sz] of outerWalls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), outerWallMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    colliders.push(boxAABB(m));
  }

  // Materialien fuer Haeuser
  const buildingMat = new THREE.MeshLambertMaterial({ color: 0xd6b48a });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b3a2a });
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x7a4012 });

  const doors = [];

  // --- Hilfsfunktionen ---

  /** Erstellt ein Wand-Segment-Mesh, fuegt es zur Szene + Collider-Array hinzu. */
  function addWall(x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), buildingMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const c = boxAABB(m);
    colliders.push(c);
    return c;
  }

  /** Erstellt die Decke (nur fuer Kollision/Optik, nicht fuer Bot-KI). */
  function addCeil(x, y, z, sx, sz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.3, sz), buildingMat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    colliders.push(boxAABB(m));
  }

  /**
   * Baut ein hohles Haus mit Tueroeffnung in der dem Zentrum zugewandten Wand.
   * @param {number} cx  - Mittelpunkt X
   * @param {number} cz  - Mittelpunkt Z
   * @param {number} wx  - Breite in X
   * @param {number} wy  - Hoehe
   * @param {number} wz  - Tiefe in Z
   */
  function addHouse(cx, cz, wx, wy, wz) {
    // Welche Seite zeigt zur Kartenmitte?
    let side;
    if (Math.abs(cx) >= Math.abs(cz)) {
      side = cx >= 0 ? 'west' : 'east';
    } else {
      side = cz > 0 ? 'north' : 'south';
    }

    // Hilfswerte
    const sl_x = wx / 2 - DOOR_W / 2;   // Segmentlaenge fuer N/S-Waende mit Tuer
    const sl_z = wz / 2 - DOOR_W / 2;   // Segmentlaenge fuer W/E-Waende mit Tuer
    const topH = wy - DOOR_H;            // Sturz-Hoehe ueber der Tuer

    // --- Nord-Wand (z = cz - wz/2) ---
    if (side === 'north') {
      addWall(cx - (wx + DOOR_W) / 4, wy / 2, cz - wz / 2, sl_x, wy, WALL_T);
      addWall(cx + (wx + DOOR_W) / 4, wy / 2, cz - wz / 2, sl_x, wy, WALL_T);
      if (topH > 0.1) addWall(cx, DOOR_H + topH / 2, cz - wz / 2, DOOR_W, topH, WALL_T);
    } else {
      addWall(cx, wy / 2, cz - wz / 2, wx, wy, WALL_T);
    }

    // --- Sued-Wand (z = cz + wz/2) ---
    if (side === 'south') {
      addWall(cx - (wx + DOOR_W) / 4, wy / 2, cz + wz / 2, sl_x, wy, WALL_T);
      addWall(cx + (wx + DOOR_W) / 4, wy / 2, cz + wz / 2, sl_x, wy, WALL_T);
      if (topH > 0.1) addWall(cx, DOOR_H + topH / 2, cz + wz / 2, DOOR_W, topH, WALL_T);
    } else {
      addWall(cx, wy / 2, cz + wz / 2, wx, wy, WALL_T);
    }

    // --- West-Wand (x = cx - wx/2) ---
    if (side === 'west') {
      addWall(cx - wx / 2, wy / 2, cz - (wz + DOOR_W) / 4, WALL_T, wy, sl_z);
      addWall(cx - wx / 2, wy / 2, cz + (wz + DOOR_W) / 4, WALL_T, wy, sl_z);
      if (topH > 0.1) addWall(cx - wx / 2, DOOR_H + topH / 2, cz, WALL_T, topH, DOOR_W);
    } else {
      addWall(cx - wx / 2, wy / 2, cz, WALL_T, wy, wz);
    }

    // --- Ost-Wand (x = cx + wx/2) ---
    if (side === 'east') {
      addWall(cx + wx / 2, wy / 2, cz - (wz + DOOR_W) / 4, WALL_T, wy, sl_z);
      addWall(cx + wx / 2, wy / 2, cz + (wz + DOOR_W) / 4, WALL_T, wy, sl_z);
      if (topH > 0.1) addWall(cx + wx / 2, DOOR_H + topH / 2, cz, WALL_T, topH, DOOR_W);
    } else {
      addWall(cx + wx / 2, wy / 2, cz, WALL_T, wy, wz);
    }

    // --- Decke (fuer Optik + Spieler-Kollision, nicht fuer Bots) ---
    addCeil(cx, wy + 0.15, cz, wx - WALL_T * 2, wz - WALL_T * 2);

    // --- Dach (Kegel) ---
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(wx, wz) * 0.75, wy * 0.4, 4),
      roofMat,
    );
    roof.position.set(cx, wy + wy * 0.2, cz);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    scene.add(roof);

    // --- Tuer-Pivot + Panel ---
    let pivotPos, panelOffset, panelGeo, openAngle, doorCenter;

    if (side === 'north') {
      // Tuer in der Nord-Wand, Scharnier links, schwingt nach innen (+z)
      pivotPos = new THREE.Vector3(cx - DOOR_W / 2, 0, cz - wz / 2);
      panelOffset = new THREE.Vector3(DOOR_W / 2, DOOR_H / 2, 0);
      panelGeo = new THREE.BoxGeometry(DOOR_W, DOOR_H, WALL_T * 0.9);
      openAngle = Math.PI / 2;
      doorCenter = new THREE.Vector3(cx, DOOR_H / 2, cz - wz / 2);
    } else if (side === 'south') {
      // Tuer in der Sued-Wand, schwingt nach innen (-z)
      pivotPos = new THREE.Vector3(cx - DOOR_W / 2, 0, cz + wz / 2);
      panelOffset = new THREE.Vector3(DOOR_W / 2, DOOR_H / 2, 0);
      panelGeo = new THREE.BoxGeometry(DOOR_W, DOOR_H, WALL_T * 0.9);
      openAngle = -Math.PI / 2;
      doorCenter = new THREE.Vector3(cx, DOOR_H / 2, cz + wz / 2);
    } else if (side === 'west') {
      // Tuer in der West-Wand, schwingt nach innen (+x)
      pivotPos = new THREE.Vector3(cx - wx / 2, 0, cz - DOOR_W / 2);
      panelOffset = new THREE.Vector3(0, DOOR_H / 2, DOOR_W / 2);
      panelGeo = new THREE.BoxGeometry(WALL_T * 0.9, DOOR_H, DOOR_W);
      openAngle = Math.PI / 2;
      doorCenter = new THREE.Vector3(cx - wx / 2, DOOR_H / 2, cz);
    } else {
      // east: Tuer in der Ost-Wand, schwingt nach innen (-x)
      pivotPos = new THREE.Vector3(cx + wx / 2, 0, cz - DOOR_W / 2);
      panelOffset = new THREE.Vector3(0, DOOR_H / 2, DOOR_W / 2);
      panelGeo = new THREE.BoxGeometry(WALL_T * 0.9, DOOR_H, DOOR_W);
      openAngle = -Math.PI / 2;
      doorCenter = new THREE.Vector3(cx + wx / 2, DOOR_H / 2, cz);
    }

    const doorPivot = new THREE.Group();
    doorPivot.position.copy(pivotPos);
    scene.add(doorPivot);

    const doorMesh = new THREE.Mesh(panelGeo, doorMat);
    doorMesh.position.copy(panelOffset);
    doorMesh.castShadow = true;
    doorMesh.receiveShadow = true;
    doorPivot.add(doorMesh);

    // AABB des geschlossenen Tuer-Panels berechnen
    doorPivot.updateMatrixWorld(true);
    const doorBox = new THREE.Box3().setFromObject(doorPivot);
    const doorCollider = {
      min: doorBox.min.clone(),
      max: doorBox.max.clone(),
      active: true,   // wird auf false gesetzt wenn Tuer offen ist
    };
    colliders.push(doorCollider);

    doors.push({
      pivot: doorPivot,
      center: doorCenter.clone(),
      isOpen: false,
      isAnimating: false,
      openAngle,
      collider: doorCollider,
    });
  }

  // Haeuser (cx, cz, breiteX, hoehe, tiefeZ)
  const HOUSES = [
    [ 60,  40, 14, 10, 14],
    [-60,  40, 18, 12, 12],
    [ 60, -40, 16, 11, 16],
    [-60, -40, 12,  9, 18],
    [100,   0, 16, 14, 10],
    [-100,  0, 10,  9, 20],
    [  0,  90, 22, 13, 10],
    [  0, -90, 10, 13, 22],
  ];
  for (const [cx, cz, wx, wy, wz] of HOUSES) {
    addHouse(cx, cz, wx, wy, wz);
  }

  // Bot-Kollisions-Footprints (einfache 2D-AABB der Hauser, kein Spalt)
  const botBuildingBoxes = HOUSES.map(([cx, cz, wx, , wz]) => ({
    minX: cx - wx / 2,
    maxX: cx + wx / 2,
    minZ: cz - wz / 2,
    maxZ: cz + wz / 2,
  }));

  // Kisten als Deckung (ausserhalb der zentralen Kampfzone)
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8b6b3a });
  for (let i = 0; i < 30; i++) {
    const s = 1.5 + Math.random() * 1.2;
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    c.position.set(
      (Math.random() - 0.5) * 260,
      s / 2,
      (Math.random() - 0.5) * 260,
    );
    if (Math.hypot(c.position.x, c.position.z) < 50) continue;
    c.castShadow = true;
    c.receiveShadow = true;
    scene.add(c);
    colliders.push(boxAABB(c));
  }

  // Baeume
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e6b2a });
  for (let i = 0; i < 50; i++) {
    const tx = (Math.random() - 0.5) * 280;
    const tz = (Math.random() - 0.5) * 280;
    if (Math.hypot(tx, tz) < 55) continue;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.6, 4, 8),
      trunkMat,
    );
    trunk.position.set(tx, 2, tz);
    trunk.castShadow = true;
    scene.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(2.5, 8, 8),
      leafMat,
    );
    leaves.position.set(tx, 5, tz);
    leaves.castShadow = true;
    scene.add(leaves);
    colliders.push({
      min: new THREE.Vector3(tx - 0.6, 0, tz - 0.6),
      max: new THREE.Vector3(tx + 0.6, 4, tz + 0.6),
    });
  }

  // Rampen / Plattformen
  const rampMat = new THREE.MeshLambertMaterial({ color: 0xb4a070 });
  for (let i = 0; i < 6; i++) {
    const rx = (Math.random() - 0.5) * 200;
    const rz = (Math.random() - 0.5) * 200;
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.5, 8),
      rampMat,
    );
    platform.position.set(rx, 3, rz);
    platform.castShadow = true;
    platform.receiveShadow = true;
    scene.add(platform);
    colliders.push(boxAABB(platform));
  }

  return { scene, colliders, doors, botBuildingBoxes };
}

function boxAABB(mesh) {
  mesh.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(mesh);
  return { min: box.min.clone(), max: box.max.clone() };
}
