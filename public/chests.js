import * as THREE from 'three';

/**
 * Truhen-System: verstreute Truhen in der Welt, die der Spieler mit
 * "E" oeffnen kann. Aus jeder kommt ein Heiltrank der beim Aufsammeln
 * Leben wieder herstellt.
 */

const INTERACTION_RANGE = 3.5;    // Meter
const HEAL_AMOUNT = 35;           // HP pro Trank
const RESPAWN_AFTER_MS = 25000;   // Truhe kommt nach 25s zurueck
const OPEN_ANIM_MS = 450;         // Deckelanimation
const PICKUP_RANGE = 1.5;         // Meter, auto-pickup

// Feste Truhen-Positionen, bewusst ausserhalb der Kampfzone und nicht in
// Gebaeuden, damit sie auch erreichbar sind.
const CHEST_POSITIONS = [
  [  45,   0,  45],
  [ -45,   0,  45],
  [  45,   0, -45],
  [ -45,   0, -45],
  [  80,   0,   0],
  [ -80,   0,   0],
  [   0,   0,  80],
  [   0,   0, -80],
  [  30,   0,  65],
  [ -30,   0, -65],
];

export class ChestSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{ onHeal: (amount:number)=>number }} hooks onHeal gibt den
   *   tatsaechlich angewendeten Heilwert zurueck (fuer HUD-Feedback).
   */
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;
    this.chests = [];
    this.drinks = [];
    this.promptEl = null;
    this._buildChests();
  }

  _buildChests() {
    for (const pos of CHEST_POSITIONS) {
      const chest = this._makeChest(pos);
      this.scene.add(chest.group);
      this.chests.push(chest);
    }
  }

  _makeChest([x, y, z]) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    // Korpus (Holzkiste, dunkles Braun)
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x6b3f1a });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0xcca24a });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), bodyMat);
    body.position.y = 0.45;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Goldbeschlag um den Korpus
    const trim1 = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.06, 1.05), trimMat);
    trim1.position.y = 0.1;
    group.add(trim1);
    const trim2 = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.06, 1.05), trimMat);
    trim2.position.y = 0.85;
    group.add(trim2);

    // Deckel (separates Pivot-Objekt, damit er sich am hinteren Rand oeffnet)
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.9, -0.5);
    group.add(lidPivot);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 1.0), bodyMat);
    lid.position.set(0, 0.125, 0.5);
    lid.castShadow = true;
    lidPivot.add(lid);
    const lidTrim = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.05, 1.05), trimMat);
    lidTrim.position.set(0, 0.25, 0.5);
    lidPivot.add(lidTrim);

    // Leuchtendes Schloss, damit man die Truhe schon von weitem sieht
    const lockMat = new THREE.MeshBasicMaterial({ color: 0xffdd55 });
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.1), lockMat);
    lock.position.set(0, 0.55, 0.55);
    group.add(lock);

    // Schimmer als PointLight, schwach, damit sie im Dunkeln glueht
    const glow = new THREE.PointLight(0xffcc66, 0.8, 6, 2);
    glow.position.set(0, 1.5, 0);
    group.add(glow);

    return {
      group,
      lidPivot,
      lock,
      glow,
      position: new THREE.Vector3(x, y, z),
      state: 'closed',      // 'closed' | 'opening' | 'opened'
      openStartedAt: 0,
      respawnAt: 0,
    };
  }

  _makeDrink(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y + 0.9, z);

    // Glasflasche (Zylinder, blau, halbtransparent)
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.5, 16),
      new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.85 }),
    );
    glass.position.y = 0;
    group.add(glass);

    // Deckel
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.12, 12),
      new THREE.MeshLambertMaterial({ color: 0xc42b2b }),
    );
    cap.position.y = 0.3;
    group.add(cap);

    // Label
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.2, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    label.position.set(0, 0, 0.18);
    group.add(label);

    // Pulsierendes Licht
    const light = new THREE.PointLight(0x66ddff, 1.5, 5, 2);
    light.position.y = 0;
    group.add(light);

    return {
      group,
      spawnedAt: performance.now(),
      collected: false,
      baseY: y + 0.9,
    };
  }

  /**
   * Versucht, die naechstgelegene geschlossene Truhe zu oeffnen.
   * Wird ausgeloest wenn der Spieler "E" drueckt.
   * Gibt true zurueck wenn etwas passiert ist (fuer ggf. HUD-Feedback).
   */
  tryOpen(playerPos) {
    const chest = this._findNearestOpenable(playerPos);
    if (!chest) return false;
    chest.state = 'opening';
    chest.openStartedAt = performance.now();
    return true;
  }

  _findNearestOpenable(playerPos) {
    let best = null;
    let bestDist = INTERACTION_RANGE;
    for (const c of this.chests) {
      if (c.state !== 'closed') continue;
      const d = c.position.distanceTo(playerPos);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * Pruefe ob in Reichweite einer oeffenbaren Truhe - fuer die
   * "Drueck E"-Anzeige im HUD.
   */
  nearestOpenableDistance(playerPos) {
    const c = this._findNearestOpenable(playerPos);
    if (!c) return null;
    return c.position.distanceTo(playerPos);
  }

  /**
   * Jeden Frame aufrufen: animiert Deckel, laesst Tranks auf und ab
   * schweben, prueft Pickup, und respawnt geleerte Truhen.
   */
  tick(dt, camera) {
    const now = performance.now();
    const playerPos = camera.position;

    // Truhen animieren
    for (const c of this.chests) {
      if (c.state === 'opening') {
        const t = Math.min(1, (now - c.openStartedAt) / OPEN_ANIM_MS);
        c.lidPivot.rotation.x = -t * (Math.PI / 2 - 0.15);
        if (t >= 1) {
          c.state = 'opened';
          // Trank spawnen
          const drink = this._makeDrink(c.position.x, c.position.y, c.position.z);
          drink.chestRef = c;
          this.scene.add(drink.group);
          this.drinks.push(drink);
          // Licht der Truhe dimmen
          c.glow.intensity = 0.1;
          c.lock.material = new THREE.MeshBasicMaterial({ color: 0x444444 });
          c.respawnAt = now + RESPAWN_AFTER_MS;
        }
      } else if (c.state === 'opened' && now > c.respawnAt) {
        // Truhe schliessen und bereit fuer erneute Nutzung
        c.lidPivot.rotation.x = 0;
        c.glow.intensity = 0.8;
        c.lock.material = new THREE.MeshBasicMaterial({ color: 0xffdd55 });
        c.state = 'closed';
      }
    }

    // Tranks: pulsierendes Schweben + Pickup-Check
    for (let i = this.drinks.length - 1; i >= 0; i--) {
      const d = this.drinks[i];
      if (d.collected) continue;
      const t = (now - d.spawnedAt) / 1000;
      d.group.position.y = d.baseY + Math.sin(t * 2.5) * 0.15;
      d.group.rotation.y += dt * 1.4;

      // Pickup?
      const dx = d.group.position.x - playerPos.x;
      const dz = d.group.position.z - playerPos.z;
      const distXZ = Math.hypot(dx, dz);
      if (distXZ < PICKUP_RANGE) {
        const healed = this.hooks.onHeal ? this.hooks.onHeal(HEAL_AMOUNT) : 0;
        if (healed > 0) {
          d.collected = true;
          this.scene.remove(d.group);
          this.drinks.splice(i, 1);
        }
      }
    }
  }
}
