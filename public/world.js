import * as THREE from 'three';

/**
 * Baut die 3D-Welt: Himmel, Boden, Gebaeude, Kisten, Baeume.
 * Gibt { scene, colliders } zurueck. `colliders` sind AABBs fuer
 * simple Kollisionspruefung gegen den Spieler und Raycasts.
 */
export function buildWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 120, 380);

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
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
  const wallH = 6;
  const wallT = 2;
  const wallSize = 300;
  const walls = [
    [0, wallH / 2,  wallSize, wallSize * 2, wallH, wallT],
    [0, wallH / 2, -wallSize, wallSize * 2, wallH, wallT],
    [ wallSize, wallH / 2, 0, wallT, wallH, wallSize * 2],
    [-wallSize, wallH / 2, 0, wallT, wallH, wallSize * 2],
  ];
  const colliders = [];
  for (const [x, y, z, sx, sy, sz] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    colliders.push(boxAABB(m));
  }

  // Gebaeude in der Mitte und verstreut
  const buildingMat = new THREE.MeshLambertMaterial({ color: 0xd6b48a });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b3a2a });
  const buildings = [
    [  0, 0,   0, 20, 14, 20],
    [ 60, 0,  40, 14, 10, 14],
    [-60, 0,  40, 18, 12, 12],
    [ 60, 0, -40, 16, 11, 16],
    [-60, 0, -40, 12, 9, 18],
    [100, 0,   0, 16, 14, 10],
    [-100, 0,  0, 10, 9, 20],
    [  0, 0,  90, 22, 13, 10],
    [  0, 0, -90, 10, 13, 22],
  ];
  for (const [x, y, z, sx, sy, sz] of buildings) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), buildingMat);
    body.position.set(x, sy / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);
    colliders.push(boxAABB(body));

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(sx, sz) * 0.75, sy * 0.5, 4),
      roofMat,
    );
    roof.position.set(x, sy + sy * 0.25, z);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    scene.add(roof);
  }

  // Kisten als Deckung
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8b6b3a });
  for (let i = 0; i < 30; i++) {
    const s = 1.5 + Math.random() * 1.2;
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    c.position.set(
      (Math.random() - 0.5) * 260,
      s / 2,
      (Math.random() - 0.5) * 260,
    );
    // Kisten nicht in Gebaeuden spawnen
    if (Math.hypot(c.position.x, c.position.z) < 16) continue;
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
    if (Math.hypot(tx, tz) < 20) continue;
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

  return { scene, colliders };
}

function boxAABB(mesh) {
  mesh.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(mesh);
  return { min: box.min.clone(), max: box.max.clone() };
}
