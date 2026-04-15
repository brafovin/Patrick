import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { buildWorld } from './world.js';
import { createRemotePlayer, updateNameTag, resolveCollisions } from './player.js';
import { WEAPONS, createViewModel, createMuzzleFlash, spawnTracer } from './weapons.js';
import { HUD } from './hud.js';

// --------------------------------------------------------------------------
// Setup: Renderer, Szene, Kamera
// --------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const { scene, colliders } = buildWorld();

// DEBUG: Riesiger neonroter Pfeiler in der Kartenmitte, unmoeglich zu uebersehen.
// Wenn du diesen nicht siehst, stimmt etwas Grundsaetzliches mit dem Rendering nicht.
{
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2, 60, 16),
    new THREE.MeshBasicMaterial({ color: 0xff0066 }),
  );
  pillar.position.set(0, 30, 0);
  scene.add(pillar);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(3, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffff00 }),
  );
  beacon.position.set(0, 62, 0);
  scene.add(beacon);
}

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  600,
);
camera.position.set(0, 1.7, 0);

// View-Model (Waffe in der ersten Person)
const viewModelRoot = new THREE.Group();
camera.add(viewModelRoot);
scene.add(camera);
const viewModel = createViewModel();
viewModelRoot.add(viewModel);
// Alle View-Model-Teile markieren, damit sie nicht vom Raycast getroffen werden
viewModelRoot.traverse((o) => { o.userData.isViewModel = true; });
const muzzleFlash = createMuzzleFlash();
muzzleFlash.position.set(0.25, -0.18, -0.85);
muzzleFlash.userData.isViewModel = true;
camera.add(muzzleFlash);

// PointerLock-Controls fuer Maussteuerung
const controls = new PointerLockControls(camera, document.body);

// --------------------------------------------------------------------------
// Spielzustand
// --------------------------------------------------------------------------
const state = {
  selfId: null,
  alive: true,
  health: 100,
  kills: 0,
  deaths: 0,
  weaponKey: 'rifle',
  ammo: WEAPONS.rifle.magazine,
  reloading: false,
  lastShotAt: 0,
  velocity: new THREE.Vector3(),
  onGround: false,
  lastNetSent: 0,
  remote: new Map(), // id -> Group
  remoteData: new Map(), // id -> { name, health }
};
HUD.setHealth(100);
HUD.setWeapon(WEAPONS.rifle.name, state.ammo, WEAPONS.rifle.magazine);

// --------------------------------------------------------------------------
// Eingaben
// --------------------------------------------------------------------------
const keys = Object.create(null);
let chatting = false;

document.addEventListener('keydown', (e) => {
  if (chatting) {
    if (e.key === 'Escape') closeChat();
    return;
  }
  keys[e.code] = true;
  if (e.code === 'Digit1') switchWeapon('pistol');
  if (e.code === 'Digit2') switchWeapon('rifle');
  if (e.code === 'Digit3') switchWeapon('shotgun');
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyT') { e.preventDefault(); openChat(); }
  if (e.code === 'Tab') { e.preventDefault(); HUD.showScoreboard(true); }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') HUD.showScoreboard(false);
});

let mouseDown = false;
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  mouseDown = true;
  if (!controls.isLocked || chatting) return;
  fireWeapon();
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --------------------------------------------------------------------------
// Chat
// --------------------------------------------------------------------------
const chatInput = document.getElementById('chatInput');
function openChat() {
  chatting = true;
  chatInput.classList.add('active');
  chatInput.focus();
  controls.unlock();
}
function closeChat() {
  chatting = false;
  chatInput.value = '';
  chatInput.classList.remove('active');
  chatInput.blur();
  controls.lock();
}
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text && socket) socket.emit('chat', text);
    closeChat();
  } else if (e.key === 'Escape') {
    closeChat();
  }
});

// --------------------------------------------------------------------------
// Waffen
// --------------------------------------------------------------------------
function switchWeapon(key) {
  if (!WEAPONS[key] || state.reloading) return;
  state.weaponKey = key;
  const w = WEAPONS[key];
  state.ammo = w.magazine;
  HUD.setWeapon(w.name, state.ammo, w.magazine);
}

function reload() {
  const w = WEAPONS[state.weaponKey];
  if (state.reloading || state.ammo === w.magazine) return;
  state.reloading = true;
  HUD.setWeapon(w.name + ' ...', state.ammo, w.magazine);
  setTimeout(() => {
    state.reloading = false;
    state.ammo = w.magazine;
    HUD.setWeapon(w.name, state.ammo, w.magazine);
  }, w.reload);
}

function fireWeapon() {
  if (!state.alive || state.reloading) return;
  const w = WEAPONS[state.weaponKey];
  const now = performance.now();
  if (now - state.lastShotAt < w.fireRate) return;
  if (state.ammo <= 0) { reload(); return; }
  state.lastShotAt = now;
  state.ammo -= 1;
  HUD.setWeapon(w.name, state.ammo, w.magazine);

  // Rueckstoss-Animation der Waffe
  viewModel.position.z = -0.3;
  setTimeout(() => { viewModel.position.z = -0.4; }, 40);

  // Muzzle flash
  muzzleFlash.intensity = 2.5;
  setTimeout(() => { muzzleFlash.intensity = 0; }, 55);

  // Raycast(s)
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const baseDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const pellets = w.pellets || 1;
  let bestHit = null;

  for (let i = 0; i < pellets; i++) {
    const dir = baseDir.clone();
    dir.x += (Math.random() - 0.5) * w.spread * 2;
    dir.y += (Math.random() - 0.5) * w.spread * 2;
    dir.z += (Math.random() - 0.5) * w.spread * 2;
    dir.normalize();

    const hit = raycastShot(origin, dir, w.range);
    const endPoint = hit
      ? hit.point
      : origin.clone().add(dir.clone().multiplyScalar(w.range));
    spawnTracer(scene, origin, endPoint);

    if (hit && hit.targetId && (!bestHit || hit.distance < bestHit.distance)) {
      bestHit = hit;
    }
  }

  const payload = {
    origin: [origin.x, origin.y, origin.z],
    direction: [baseDir.x, baseDir.y, baseDir.z],
  };
  if (bestHit) {
    payload.hit = { target: bestHit.targetId, headshot: bestHit.headshot };
  }
  if (socket) socket.emit('shoot', payload);
}

/**
 * Raycast gegen alle entfernten Spieler und die Welt-Collider.
 * Gibt den naechsten Treffer zurueck oder null.
 */
function raycastShot(origin, dir, maxRange) {
  const raycaster = new THREE.Raycaster(origin, dir, 0, maxRange);

  const targets = [];
  const remoteMeshIds = new Set();
  for (const [id, group] of state.remote) {
    group.traverse((obj) => {
      if (obj.isMesh) {
        obj.userData._ownerId = id;
        remoteMeshIds.add(obj.uuid);
        targets.push(obj);
      }
    });
  }
  // Auch die Welt pruefen, damit Kugeln von Waenden gestoppt werden.
  // View-Model und die Spieler-Meshes sind bereits ausgeschlossen.
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.isViewModel) return;
    if (remoteMeshIds.has(obj.uuid)) return;
    targets.push(obj);
  });

  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return null;
  const h = hits[0];
  const ownerId = h.object.userData._ownerId;
  if (!ownerId) {
    // Wand / Objekt, kein Spieler
    return { point: h.point, distance: h.distance };
  }
  return {
    point: h.point,
    distance: h.distance,
    targetId: ownerId,
    headshot: !!h.object.userData.isHead,
  };
}

// --------------------------------------------------------------------------
// Bewegung + Physik
// --------------------------------------------------------------------------
const GRAVITY = -28;
const MOVE_SPEED = 6;
const SPRINT_MULT = 1.6;
const JUMP_VELOCITY = 9.5;

function updateMovement(dt) {
  if (!state.alive) { state.velocity.set(0, 0, 0); return; }

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0; forward.normalize();
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  let speed = MOVE_SPEED;
  if (keys['ShiftLeft'] || keys['ShiftRight']) speed *= SPRINT_MULT;

  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(forward);
  if (keys['KeyS']) move.sub(forward);
  if (keys['KeyD']) move.add(right);
  if (keys['KeyA']) move.sub(right);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

  // Horizontale Geschwindigkeit = sofort (arcadig)
  state.velocity.x = move.x;
  state.velocity.z = move.z;

  // Schwerkraft
  state.velocity.y += GRAVITY * dt;

  // Sprung
  if ((keys['Space']) && state.onGround) {
    state.velocity.y = JUMP_VELOCITY;
    state.onGround = false;
  }

  // Position integrieren
  const pos = camera.position.clone();
  pos.x += state.velocity.x * dt;
  pos.y += state.velocity.y * dt;
  pos.z += state.velocity.z * dt;

  // Boden
  const groundY = 1.7;
  if (pos.y < groundY) {
    pos.y = groundY;
    state.velocity.y = 0;
    state.onGround = true;
  } else {
    state.onGround = false;
  }

  // Welt-Grenzen
  pos.x = Math.max(-295, Math.min(295, pos.x));
  pos.z = Math.max(-295, Math.min(295, pos.z));

  // Kollision gegen Welt-AABBs (verwendet Body-Height 1.7)
  const footPos = new THREE.Vector3(pos.x, pos.y - 1.7, pos.z);
  resolveCollisions(footPos, 0.35, 1.7, colliders);
  // Wenn Kollision y erhoeht hat => auf Kiste stehen
  if (footPos.y > pos.y - 1.7 + 0.01) {
    pos.y = footPos.y + 1.7;
    if (state.velocity.y < 0) {
      state.velocity.y = 0;
      state.onGround = true;
    }
  }
  pos.x = footPos.x;
  pos.z = footPos.z;

  camera.position.copy(pos);
}

// --------------------------------------------------------------------------
// Netzwerk-Anbindung
// --------------------------------------------------------------------------
const socket = typeof io !== 'undefined' ? io() : null;
const connStatus = document.getElementById('connStatus');

if (!socket) {
  connStatus.textContent = 'FEHLER: Socket.IO nicht geladen';
} else {
  socket.on('connect', () => {
    connStatus.textContent = 'Verbunden! Gib deinen Namen ein und starte.';
    const dc = document.getElementById('dbgConn');
    if (dc) dc.textContent = 'verbunden (' + socket.id.slice(0, 6) + ')';
  });
  socket.on('disconnect', () => {
    connStatus.textContent = 'Verbindung verloren.';
    const dc = document.getElementById('dbgConn');
    if (dc) dc.textContent = 'getrennt';
  });
  socket.on('connect_error', (err) => {
    showError('socket: ' + err.message);
  });

  socket.on('init', (data) => {
    state.selfId = data.selfId;
    if (data.spawn) {
      camera.position.set(data.spawn[0], data.spawn[1] + 1.5, data.spawn[2]);
      // Beim Spawn zur Kartenmitte blicken (dort stehen die Gegner)
      camera.lookAt(0, data.spawn[1] + 1.5, 0);
    }
    let added = 0;
    for (const id in data.players) {
      if (id === state.selfId) continue;
      addRemote(data.players[id]);
      added += 1;
    }
    console.log('[init] selfId=' + state.selfId + ' remotes=' + added);
    updatePlayerCount();
  });

  socket.on('playerJoined', (p) => {
    if (p.id === state.selfId) return;
    addRemote(p);
    updatePlayerCount();
  });

  socket.on('playerLeft', (id) => {
    removeRemote(id);
    updatePlayerCount();
  });

  socket.on('playerRenamed', ({ id, name }) => {
    const g = state.remote.get(id);
    if (g) updateNameTag(g, name);
    const d = state.remoteData.get(id);
    if (d) d.name = name;
  });

  socket.on('playerMoved', ({ id, position, rotation, weapon }) => {
    const g = state.remote.get(id);
    if (!g) return;
    const footY = Math.max(0, (position[1] || 1.7) - 1.7);
    g.userData.targetPos.set(position[0], footY, position[2]);
    g.userData.targetRot = rotation[1] || 0;
  });

  socket.on('shot', ({ shooter, origin, direction, weapon }) => {
    if (shooter === state.selfId) return;
    const o = new THREE.Vector3(origin[0], origin[1], origin[2]);
    const d = new THREE.Vector3(direction[0], direction[1], direction[2]);
    const end = o.clone().add(d.multiplyScalar(80));
    spawnTracer(scene, o, end, 90);
  });

  socket.on('damage', ({ target, attacker, damage, headshot, health }) => {
    if (target === state.selfId) {
      state.health = health;
      HUD.setHealth(health);
      flashHurt();
    }
    const d = state.remoteData.get(target);
    if (d) d.health = health;
  });

  socket.on('kill', ({ killer, victim, killerName, victimName, weapon, headshot }) => {
    HUD.addKillFeed(killerName, victimName, WEAPONS[weapon]?.name || weapon, headshot);
    if (killer === state.selfId) {
      state.kills += 1;
      HUD.setStats(state.kills, state.deaths, state.remote.size + 1);
    }
    if (victim === state.selfId) {
      state.deaths += 1;
      state.alive = false;
      HUD.setStats(state.kills, state.deaths, state.remote.size + 1);
      HUD.showDeathScreen(true);
      let t = 3;
      HUD.setRespawnTimer(t);
      const iv = setInterval(() => {
        t -= 1;
        HUD.setRespawnTimer(Math.max(0, t));
        if (t <= 0) clearInterval(iv);
      }, 1000);
    }
  });

  socket.on('respawn', ({ id, position, health }) => {
    if (id === state.selfId) {
      camera.position.set(position[0], position[1] + 1.5, position[2]);
      camera.lookAt(0, position[1] + 1.5, 0);
      state.alive = true;
      state.health = health;
      state.velocity.set(0, 0, 0);
      HUD.setHealth(health);
      HUD.showDeathScreen(false);
    } else {
      const g = state.remote.get(id);
      if (g) {
        g.position.set(position[0], position[1] - 1.5, position[2]);
        g.userData.targetPos.copy(g.position);
      }
    }
  });

  socket.on('chat', ({ from, text }) => {
    HUD.addChat(from, text);
  });

  socket.on('scoreboard', (rows) => {
    HUD.updateScoreboard(rows, state.selfId);
  });
}

function addRemote(p) {
  const g = createRemotePlayer(p.name || 'Spieler', p.color || 0xff8844);
  // Fuesse immer auf dem Boden, egal ob der Server Eye-Height oder Foot-Height schickt
  const footY = Math.max(0, (p.position[1] || 1.7) - 1.7);
  g.position.set(p.position[0], footY, p.position[2]);
  g.userData.targetPos.copy(g.position);
  g.userData.targetRot = p.rotation ? p.rotation[1] : 0;
  scene.add(g);
  state.remote.set(p.id, g);
  state.remoteData.set(p.id, { name: p.name, health: p.health });
  console.log('[addRemote] ' + p.id + ' ' + p.name + ' at', g.position.toArray());
}

function removeRemote(id) {
  const g = state.remote.get(id);
  if (!g) return;
  scene.remove(g);
  state.remote.delete(id);
  state.remoteData.delete(id);
}

function updatePlayerCount() {
  HUD.setStats(state.kills, state.deaths, state.remote.size + 1);
}

function flashHurt() {
  document.body.style.boxShadow = 'inset 0 0 120px rgba(255,0,0,0.6)';
  setTimeout(() => { document.body.style.boxShadow = ''; }, 150);
}

// --------------------------------------------------------------------------
// Start-Menue Handling
// --------------------------------------------------------------------------
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const playBtn = document.getElementById('playBtn');
const nameInput = document.getElementById('nameInput');

playBtn.addEventListener('click', startGame);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

function startGame() {
  const name = (nameInput.value || '').trim().slice(0, 16);
  if (socket && name) socket.emit('setName', name);
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  controls.lock();
}

controls.addEventListener('unlock', () => {
  if (!menu.classList.contains('hidden')) return;
  // Optional: kleines Pausenverhalten - hier aber nichts tun
});

// --------------------------------------------------------------------------
// Haupt-Loop
// --------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (controls.isLocked && !chatting) updateMovement(dt);

  // Automatische Waffe halten
  if (mouseDown && controls.isLocked && !chatting) {
    const w = WEAPONS[state.weaponKey];
    if (w.auto) fireWeapon();
  }

  // Entfernte Spieler interpolieren
  for (const [, g] of state.remote) {
    g.position.lerp(g.userData.targetPos, Math.min(1, dt * 12));
    const targetRot = g.userData.targetRot || 0;
    const diff = ((targetRot - g.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
    g.rotation.y += diff * Math.min(1, dt * 12);
  }

  // Netzwerk: Position ~20x/s senden
  const now = performance.now();
  if (socket && state.selfId && now - state.lastNetSent > 50) {
    state.lastNetSent = now;
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    socket.emit('move', {
      position: [camera.position.x, camera.position.y, camera.position.z],
      rotation: [euler.x, euler.y],
      weapon: state.weaponKey,
    });
  }

  // Debug-HUD aktualisieren (einmal pro Sekunde reicht)
  if (!animate._lastDbg || now - animate._lastDbg > 200) {
    animate._lastDbg = now;
    updateDebugHud();
  }

  try {
    renderer.render(scene, camera);
  } catch (err) {
    showError('render: ' + err.message);
    throw err;
  }
}

function updateDebugHud() {
  const dbgRemote = document.getElementById('dbgRemote');
  const dbgNearest = document.getElementById('dbgNearest');
  const dbgCam = document.getElementById('dbgCam');
  const dbgLook = document.getElementById('dbgLook');
  if (!dbgRemote) return;
  dbgRemote.textContent = state.remote.size;
  let nearest = null;
  let nearestDist = Infinity;
  for (const [id, g] of state.remote) {
    const dx = g.position.x - camera.position.x;
    const dz = g.position.z - camera.position.z;
    const d = Math.hypot(dx, dz);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = { id, g };
    }
  }
  if (nearest) {
    dbgNearest.textContent = nearest.id + ' @ ' +
      nearest.g.position.x.toFixed(0) + ',' +
      nearest.g.position.y.toFixed(0) + ',' +
      nearest.g.position.z.toFixed(0) + ' (' + nearestDist.toFixed(0) + 'm)';
  } else {
    dbgNearest.textContent = '(keine geladen!)';
  }
  dbgCam.textContent =
    camera.position.x.toFixed(0) + ',' +
    camera.position.y.toFixed(0) + ',' +
    camera.position.z.toFixed(0);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  dbgLook.textContent =
    forward.x.toFixed(1) + ',' +
    forward.y.toFixed(1) + ',' +
    forward.z.toFixed(1);
}

function showError(msg) {
  console.error('[GAME ERROR]', msg);
  const el = document.getElementById('dbgError');
  if (el) el.textContent = 'FEHLER: ' + msg;
}

// Globale Fehler-Handler, damit Probleme sichtbar werden
window.addEventListener('error', (e) => {
  showError(e.message + ' @ ' + (e.filename || '?') + ':' + (e.lineno || '?'));
});
window.addEventListener('unhandledrejection', (e) => {
  showError('promise: ' + (e.reason?.message || e.reason));
});

animate();
