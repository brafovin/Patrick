import * as THREE from 'three';

/**
 * Waffendefinitionen - muessen mit den Server-Werten uebereinstimmen.
 */
export const WEAPONS = {
  pistol: {
    name: 'Pistole',
    damage: 18,
    fireRate: 280,
    range: 90,
    spread: 0.015,
    magazine: 12,
    reload: 900,
    auto: false,
    pellets: 1,
  },
  rifle: {
    name: 'Gewehr',
    damage: 14,
    fireRate: 110,
    range: 140,
    spread: 0.010,
    magazine: 30,
    reload: 1600,
    auto: true,
    pellets: 1,
  },
  shotgun: {
    name: 'Schrotflinte',
    damage: 9,
    fireRate: 650,
    range: 30,
    spread: 0.090,
    magazine: 6,
    reload: 1400,
    auto: false,
    pellets: 8,
  },
};

/**
 * Sichtbares Waffen-Mesh am Kamerarand (view-model).
 */
export function createViewModel() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x222831 });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.55), bodyMat);
  body.position.set(0, -0.02, -0.2);
  group.add(body);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8),
    accentMat,
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.45);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), bodyMat);
  grip.position.set(0, -0.15, -0.05);
  group.add(grip);

  group.position.set(0.25, -0.2, -0.4);
  return group;
}

/**
 * Kleiner Mündungsblitz als Flash.
 */
export function createMuzzleFlash() {
  const flash = new THREE.PointLight(0xffcc55, 0, 6, 2);
  return flash;
}

/**
 * Erzeugt eine kurze "Tracer"-Linie vom Ursprung zum Trefferpunkt.
 */
export function spawnTracer(scene, from, to, lifetimeMs = 70) {
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  const start = performance.now();
  const animate = () => {
    const t = (performance.now() - start) / lifetimeMs;
    if (t >= 1) {
      scene.remove(line);
      geo.dispose();
      mat.dispose();
      return;
    }
    mat.opacity = 0.9 * (1 - t);
    requestAnimationFrame(animate);
  };
  animate();
}
