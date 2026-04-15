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

const SPAWN_RADIUS = 22;
const MOVE_SPEED = 4;
const SHOOT_RANGE = 55;
const FIRE_RATE_MS = 1400;
const ACCURACY_BASE = 0.45;
const DAMAGE_PER_SHOT = 14;

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

  _spawnBot(idx) {
    const def = BOT_DEFS[idx];
    const angle = (idx / BOT_DEFS.length) * Math.PI * 2;
    const r = SPAWN_RADIUS + (Math.random() - 0.5) * 4;
    const pos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    const bot = {
      id: 'local-bot-' + idx,
      name: def.name,
      color: def.color,
      position: pos.clone(),
      health: 100,
      kills: 0,
      deaths: 0,
      lastShotAt: 0,
      mesh: null,
    };
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

      // Bots verfolgen den Spieler, halten aber Distanz
      if (dist > 10) {
        const dir = toPlayer.clone().normalize();
        bot.position.x += dir.x * MOVE_SPEED * dt;
        bot.position.z += dir.z * MOVE_SPEED * dt;
      }

      // Mesh-Update (interpoliert in der Hauptschleife via targetPos)
      if (bot.mesh) {
        bot.mesh.userData.targetPos.set(bot.position.x, 0, bot.position.z);
        bot.mesh.userData.targetRot = Math.atan2(-toPlayer.x, -toPlayer.z);
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

    const headshot = Math.random() < 0.1;
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
      // Respawn nach 2,5s
      setTimeout(() => {
        bot.health = 100;
        const ang = Math.random() * Math.PI * 2;
        const r = SPAWN_RADIUS + (Math.random() - 0.5) * 4;
        bot.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
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
