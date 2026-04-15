import * as THREE from 'three';
import { createRemotePlayer } from './player.js';
import { spawnTracer } from './weapons.js';

/**
 * Offline-Modus: voller Client-Side-Bot-Ablauf.
 *
 * Wird aktiviert, wenn der Socket.IO-Server nicht erreichbar ist
 * (z.B. auf statischen Hosts wie Vercel). Alle Bots laufen dann
 * komplett im Browser; Trefferberechnung, Respawn und Kill-Tracking
 * passieren lokal. Du kannst solo gegen die KI spielen.
 */

const BOT_DEFS = [
  { name: '[BOT] Zombie',  color: 0xef4444 },
  { name: '[BOT] Drohne',  color: 0xa855f7 },
  { name: '[BOT] Ninja',   color: 0xf97316 },
  { name: '[BOT] Bandit',  color: 0x14b8a6 },
  { name: '[BOT] Wolf',    color: 0x22d3ee },
];

const SPAWN_RADIUS = 80;          // weit am Kartenrand (vorher 50)
const MOVE_SPEED = 3;
const AGGRO_RANGE = 85;           // Bots jagen nur aus Aggro-Range
const SHOOT_RANGE = 45;
const FIRE_RATE_MS = 1800;
const ACCURACY_BASE = 0.28;
const DAMAGE_PER_SHOT = 10;
const HEADSHOT_CHANCE = 0.04;
const MIN_SEPARATION = 28;        // Deutlich groesser (vorher 14)
const SEPARATION_STRENGTH = 1.8;  // Staerker abstossen
// Sektoren: jeder Bot bekommt seinen eigenen Kuchenstueck-Sektor
const SECTOR_INNER = 45;
const SECTOR_OUTER = 115;

export class OfflineWorld {
  constructor({ scene, camera, state, HUD, WEAPONS, flashHurt }) {
    this.scene = scene;
    this.camera = camera;
    this.state = state;
    this.HUD = HUD;
    this.WEAPONS = WEAPONS;
    this.flashHurt = flashHurt;
    this.bots = [];
    this.enabled = false;
  }

  start(reason) {
    if (this.enabled) return;
    this.enabled = true;
    console.log('[offline] start (' + reason + ')');

    const dbgConn = document.getElementById('dbgConn');
    if (dbgConn) dbgConn.textContent = 'OFFLINE (' + reason + ')';
    const connStatus = document.getElementById('connStatus');
    if (connStatus) connStatus.textContent = 'Offline-Modus: solo gegen 5 Bots';

    this.state.selfId = 'local-player';
    this.state.alive = true;

    // Spieler auf Startposition setzen, damit er die Bots direkt sieht
    this.camera.position.set(35, 1.7, 0);
    this.camera.lookAt(0, 1.7, 0);

    for (let i = 0; i < BOT_DEFS.length; i++) {
      this._spawnBot(i);
    }
    this._updatePlayerCount();
    this.HUD.updateScoreboard(this._scoreRows(), this.state.selfId);
  }

  _pickSectorTarget(bot) {
    const base = bot.sectorIdx * bot.sectorWidth;
    const ang = base + Math.random() * bot.sectorWidth;
    const r = SECTOR_INNER + Math.random() * (SECTOR_OUTER - SECTOR_INNER);
    bot.wanderTarget.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    bot.wanderChangeAt = performance.now() + 4000 + Math.random() * 4000;
  }

  _spawnBot(idx) {
    const def = BOT_DEFS[idx];
    const sectorWidth = (Math.PI * 2) / BOT_DEFS.length;
    const sectorIdx = idx;
    // Spawn auf der Mittellinie des eigenen Sektors, nahe Aussenrand
    const spawnAngle = sectorIdx * sectorWidth + sectorWidth / 2;
    const r = SPAWN_RADIUS + (Math.random() - 0.5) * 6;
    const pos = new THREE.Vector3(Math.cos(spawnAngle) * r, 0, Math.sin(spawnAngle) * r);
    const bot = {
      id: 'local-bot-' + idx,
      name: def.name,
      color: def.color,
      sectorIdx,
      sectorWidth,
      position: pos.clone(),
      health: 100,
      kills: 0,
      deaths: 0,
      lastShotAt: 0,
      mesh: null,
      wanderTarget: new THREE.Vector3(),
      wanderChangeAt: 0,
    };
    this._pickSectorTarget(bot);
    const mesh = createRemotePlayer(bot.name, bot.color);
    mesh.position.copy(pos);
    mesh.userData.targetPos = pos.clone();
    mesh.userData.targetRot = 0;
    this.scene.add(mesh);
    bot.mesh = mesh;
    this.state.remote.set(bot.id, mesh);
    this.state.remoteData.set(bot.id, { name: bot.name, health: bot.health });
    this.bots.push(bot);
  }

  /**
   * Wird vom Hauptloop jeden Frame aufgerufen. Bewegt die Bots,
   * laesst sie schiessen und schadet dem Spieler ggf.
   */
  tick(dt) {
    if (!this.enabled) return;
    const now = performance.now();
    const playerPos = new THREE.Vector3(
      this.camera.position.x,
      0,
      this.camera.position.z,
    );

    for (const bot of this.bots) {
      if (bot.health <= 0) continue;

      // Richtung zum Spieler
      const toPlayer = playerPos.clone().sub(bot.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();

      // Zielauswahl: Aggro oder Wander
      let moveX = 0;
      let moveZ = 0;
      if (dist < AGGRO_RANGE && dist > 10) {
        // Verfolgen, aber Distanz halten
        const dir = toPlayer.clone().normalize();
        moveX = dir.x;
        moveZ = dir.z;
      } else if (dist >= AGGRO_RANGE) {
        // Wandern: Ziel innerhalb des eigenen Sektors waehlen
        if (now > bot.wanderChangeAt) this._pickSectorTarget(bot);
        const toW = bot.wanderTarget.clone().sub(bot.position);
        toW.y = 0;
        const wl = toW.length();
        if (wl < 3) {
          // Nahes Ziel - neues waehlen
          this._pickSectorTarget(bot);
        } else {
          moveX = toW.x / wl;
          moveZ = toW.z / wl;
        }
      }

      // Abstossung von anderen Bots
      for (const other of this.bots) {
        if (other === bot || other.health <= 0) continue;
        const odx = bot.position.x - other.position.x;
        const odz = bot.position.z - other.position.z;
        const od = Math.hypot(odx, odz);
        if (od > 0 && od < MIN_SEPARATION) {
          const s = (MIN_SEPARATION - od) / MIN_SEPARATION;
          moveX += (odx / od) * s * SEPARATION_STRENGTH;
          moveZ += (odz / od) * s * SEPARATION_STRENGTH;
        }
      }

      const mlen = Math.hypot(moveX, moveZ);
      if (mlen > 0.001) {
        bot.position.x += (moveX / mlen) * MOVE_SPEED * dt;
        bot.position.z += (moveZ / mlen) * MOVE_SPEED * dt;
        // In Karte halten
        bot.position.x = Math.max(-140, Math.min(140, bot.position.x));
        bot.position.z = Math.max(-140, Math.min(140, bot.position.z));
      }

      // Mesh-Update (interpoliert in der Hauptschleife via targetPos)
      if (bot.mesh) {
        bot.mesh.userData.targetPos.set(bot.position.x, 0, bot.position.z);
        // Schauen in Laufrichtung wenn der Spieler weit weg ist, sonst auf Spieler
        const lookX = (dist < AGGRO_RANGE) ? toPlayer.x : moveX;
        const lookZ = (dist < AGGRO_RANGE) ? toPlayer.z : moveZ;
        bot.mesh.userData.targetRot = Math.atan2(-lookX, -lookZ);
      }

      // Schiessen
      if (
        dist < SHOOT_RANGE &&
        now - bot.lastShotAt > FIRE_RATE_MS &&
        this.state.alive
      ) {
        bot.lastShotAt = now;
        this._botShoot(bot, toPlayer, dist);
      }
    }
  }

  _botShoot(bot, toPlayer, dist) {
    // Visual: Tracer vom Bot zum Spieler
    const origin = new THREE.Vector3(bot.position.x, 1.5, bot.position.z);
    const end = origin.clone().add(toPlayer.clone().setY(0).normalize().multiplyScalar(dist));
    spawnTracer(this.scene, origin, end, 90);

    // Treffer-Chance nach Entfernung
    const accuracy = ACCURACY_BASE * Math.max(0.3, 1 - dist / SHOOT_RANGE);
    if (Math.random() >= accuracy) return;

    const headshot = Math.random() < HEADSHOT_CHANCE;
    const damage = Math.round(DAMAGE_PER_SHOT * (headshot ? 2 : 1));
    this.state.health = Math.max(0, this.state.health - damage);
    this.HUD.setHealth(this.state.health);
    if (typeof this.flashHurt === 'function') this.flashHurt();

    if (this.state.health <= 0) {
      this._onPlayerDied(bot);
    }
  }

  _onPlayerDied(killer) {
    this.state.alive = false;
    this.state.deaths += 1;
    killer.kills += 1;
    this.HUD.addKillFeed(killer.name, 'DU', this.WEAPONS.rifle.name, false);
    this._updatePlayerCount();
    this.HUD.updateScoreboard(this._scoreRows(), this.state.selfId);
    this.HUD.showDeathScreen(true);

    let t = 3;
    this.HUD.setRespawnTimer(t);
    const iv = setInterval(() => {
      t -= 1;
      this.HUD.setRespawnTimer(Math.max(0, t));
      if (t <= 0) {
        clearInterval(iv);
        // Respawn in einer Ecke der Kampfzone
        const ang = Math.random() * Math.PI * 2;
        const r = 32;
        this.camera.position.set(Math.cos(ang) * r, 1.7, Math.sin(ang) * r);
        this.camera.lookAt(0, 1.7, 0);
        this.state.velocity.set(0, 0, 0);
        this.state.alive = true;
        this.state.health = 100;
        this.HUD.setHealth(100);
        this.HUD.showDeathScreen(false);
      }
    }, 1000);
  }

  /**
   * Wird aufgerufen, wenn der lokale Spieler einen Bot trifft.
   * `ownerId` ist die ID des getroffenen Bot-Meshes.
   */
  onPlayerHit(ownerId, weaponKey, headshot) {
    const bot = this.bots.find((b) => b.id === ownerId);
    if (!bot || bot.health <= 0) return;

    const w = this.WEAPONS[weaponKey];
    if (!w) return;
    let dmg = w.damage * (headshot ? 2 : 1);
    if (weaponKey === 'shotgun') {
      const d = Math.hypot(
        bot.position.x - this.camera.position.x,
        bot.position.z - this.camera.position.z,
      );
      dmg *= Math.max(0.2, 1 - d / w.range);
    }
    dmg = Math.round(dmg);
    bot.health = Math.max(0, bot.health - dmg);

    if (bot.health <= 0) {
      bot.deaths += 1;
      this.state.kills += 1;
      this.HUD.addKillFeed('DU', bot.name, w.name, headshot);
      this._updatePlayerCount();
      this.HUD.updateScoreboard(this._scoreRows(), this.state.selfId);
      // Respawn nach 2,5s in eigenem Sektor
      setTimeout(() => {
        bot.health = 100;
        const spawnAngle = bot.sectorIdx * bot.sectorWidth + bot.sectorWidth / 2;
        const r = SPAWN_RADIUS + (Math.random() - 0.5) * 6;
        bot.position.set(Math.cos(spawnAngle) * r, 0, Math.sin(spawnAngle) * r);
        this._pickSectorTarget(bot);
        if (bot.mesh) {
          bot.mesh.position.copy(bot.position);
          bot.mesh.userData.targetPos.copy(bot.position);
        }
      }, 2500);
    }
  }

  _updatePlayerCount() {
    this.HUD.setStats(this.state.kills, this.state.deaths, this.bots.length + 1);
  }

  _scoreRows() {
    const rows = [
      { id: 'local-player', name: 'DU', kills: this.state.kills, deaths: this.state.deaths },
      ...this.bots.map((b) => ({ id: b.id, name: b.name, kills: b.kills, deaths: b.deaths })),
    ];
    rows.sort((a, b) => b.kills - a.kills);
    return rows;
  }
}
