import * as THREE from 'three';

/**
 * Erzeugt ein einfaches "Block-Figur" Mesh fuer einen entfernten Spieler.
 */
export function createRemotePlayer(name, color = 0xff8844) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x223344 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffe0bd });

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), headMat);
  head.position.y = 2.1;
  head.castShadow = true;
  head.userData.isHead = true;
  group.add(head);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.15, 0.55), skinMat);
  body.position.y = 1.2;
  body.castShadow = true;
  group.add(body);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 0.28), skinMat);
  leftArm.position.set(-0.6, 1.25, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 0.28), skinMat);
  rightArm.position.set(0.6, 1.25, 0);
  rightArm.castShadow = true;
  group.add(rightArm);

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.1, 0.32), pantsMat);
  leftLeg.position.set(-0.22, 0.55, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.1, 0.32), pantsMat);
  rightLeg.position.set(0.22, 0.55, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  // Halo-Ring ueber dem Kopf fuer weithin sichtbare Markierung
  const haloGeo = new THREE.TorusGeometry(0.7, 0.08, 8, 24);
  const haloMat = new THREE.MeshBasicMaterial({ color });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = 2.75;
  halo.rotation.x = Math.PI / 2;
  group.add(halo);
  group.userData.halo = halo;

  // Namensschild (Sprite)
  const tag = makeNameTag(name);
  tag.position.y = 3.15;
  group.add(tag);

  group.userData = {
    head,
    body,
    tag,
    nameText: name,
    // Ziel-Werte fuer Interpolation
    targetPos: group.position.clone(),
    targetRot: 0,
  };
  return group;
}

export function updateNameTag(group, name) {
  if (group.userData.nameText === name) return;
  const old = group.userData.tag;
  group.remove(old);
  old.material.map.dispose();
  old.material.dispose();
  const tag = makeNameTag(name);
  tag.position.y = 3.15;
  group.add(tag);
  group.userData.tag = tag;
  group.userData.nameText = name;
}

function makeNameTag(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 14, canvas.width, 36);
  ctx.font = 'bold 28px Segoe UI';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}

/**
 * Kollisionspruefung: blockiert Spieler-Bewegung an AABB Collidern.
 * `pos` wird in-place angepasst.
 */
export function resolveCollisions(pos, radius, height, colliders) {
  const min = new THREE.Vector3(pos.x - radius, pos.y, pos.z - radius);
  const max = new THREE.Vector3(pos.x + radius, pos.y + height, pos.z + radius);

  for (const c of colliders) {
    if (
      max.x < c.min.x || min.x > c.max.x ||
      max.y < c.min.y || min.y > c.max.y ||
      max.z < c.min.z || min.z > c.max.z
    ) continue;

    // Ueberlappung pro Achse
    const overlapX = Math.min(max.x - c.min.x, c.max.x - min.x);
    const overlapZ = Math.min(max.z - c.min.z, c.max.z - min.z);
    const overlapY = Math.min(max.y - c.min.y, c.max.y - min.y);

    // Kleinste Achse = auspushen
    if (overlapY < overlapX && overlapY < overlapZ && pos.y > c.min.y) {
      // nach oben pushen (stehen auf Objekt)
      pos.y = c.max.y;
    } else if (overlapX < overlapZ) {
      if (pos.x > (c.min.x + c.max.x) / 2) pos.x += overlapX;
      else pos.x -= overlapX;
    } else {
      if (pos.z > (c.min.z + c.max.z) / 2) pos.z += overlapZ;
      else pos.z -= overlapZ;
    }
  }
}
