/**
 * Patrick Battle Royale - Multiplayer Server
 *
 * Ein simpler autoritativer Spiel-Server fuer einen Fortnite-inspirierten
 * Shooter. Spieler verbinden sich via Socket.IO, ihre Positionen werden
 * in Echtzeit synchronisiert und Schaden/Kills werden serverseitig
 * verrechnet, damit das Spiel fair bleibt.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 20000,
});

const PORT = process.env.PORT || 3000;

// Statische Dateien (Client) ausliefern
app.use(express.static(path.join(__dirname, 'public')));
// Three.js lokal ausliefern, damit der Client nicht von einem externen
// CDN abhaengig ist (Firewalls / Offline-Umgebungen).
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));

// --------------------------------------------------------------------------
// Spielzustand
// --------------------------------------------------------------------------

/**
 * @typedef {Object} Player
 * @property {string} id            - Socket-ID
 * @property {string} name          - Spielername
 * @property {number[]} position    - [x, y, z]
 * @property {number[]} rotation    - [pitch, yaw]
 * @property {number} health        - 0..100
 * @property {number} kills
 * @property {number} deaths
 * @property {string} weapon        - aktuelle Waffe
 * @property {number} lastShotAt
 * @property {number} color         - Farbcode fuer Skin
 */
const players = new Map();

const WEAPONS = {
  pistol: { name: 'Pistole',   damage: 18, fireRate: 280, range: 90,  spread: 0.015, ammo: 12,  reload: 900 },
  rifle:  { name: 'Gewehr',    damage: 14, fireRate: 110, range: 140, spread: 0.010, ammo: 30,  reload: 1600 },
  shotgun:{ name: 'Schrotflinte', damage: 9, fireRate: 650, range: 30, spread: 0.090, ammo: 6,  reload: 1400, pellets: 8 },
};

// Spieler spawnen in einem engen Ring um den Bot-Bereich, damit
// sie sie sofort sehen (aber nicht direkt drinstehen).
const SPAWN_POINTS = [
  [ 35, 2,   0],
  [-35, 2,   0],
  [  0, 2,  35],
  [  0, 2, -35],
  [ 25, 2,  25],
  [-25, 2,  25],
  [ 25, 2, -25],
  [-25, 2, -25],
];

function randomSpawn() {
  const p = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  return [p[0] + (Math.random() - 0.5) * 4, p[1], p[2] + (Math.random() - 0.5) * 4];
}

function serializePlayers() {
  const out = {};
  for (const [id, p] of players) {
    out[id] = {
      id: p.id,
      name: p.name,
      position: p.position,
      rotation: p.rotation,
      health: p.health,
      kills: p.kills,
      deaths: p.deaths,
      weapon: p.weapon,
      color: p.color,
    };
  }
  return out;
}

function broadcastScoreboard() {
  const board = Array.from(players.values())
    .map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths }))
    .sort((a, b) => b.kills - a.kills);
  io.emit('scoreboard', board);
}

// --------------------------------------------------------------------------
// Schaden / Kill Helper (geteilt zwischen Spielern und Bots)
// --------------------------------------------------------------------------

function applyDamage(target, attacker, weaponKey, headshot) {
  const weapon = WEAPONS[weaponKey];
  if (!weapon || !target || target.health <= 0) return;

  let dmg = weapon.damage * (headshot ? 2.0 : 1.0);
  if (weaponKey === 'shotgun') {
    const dx = target.position[0] - attacker.position[0];
    const dy = target.position[1] - attacker.position[1];
    const dz = target.position[2] - attacker.position[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dmg *= Math.max(0.2, 1 - dist / weapon.range);
  }
  dmg = Math.round(dmg);

  target.health = Math.max(0, target.health - dmg);
  io.emit('damage', {
    target: target.id,
    attacker: attacker.id,
    damage: dmg,
    headshot,
    health: target.health,
  });

  if (target.health <= 0) {
    target.deaths += 1;
    attacker.kills += 1;
    io.emit('kill', {
      killer: attacker.id,
      victim: target.id,
      killerName: attacker.name,
      victimName: target.name,
      weapon: weaponKey,
      headshot,
    });

    setTimeout(() => {
      const t = players.get(target.id);
      if (!t) return;
      t.health = 100;
      // Bots respawnen im Ring, Menschen an zufaelligen Punkten
      t.position = t.isBot
        ? botSpawnPoint(Math.floor(Math.random() * BOT_CONFIG.count))
        : randomSpawn();
      io.emit('respawn', {
        id: t.id,
        position: t.position,
        health: t.health,
      });
    }, 2500);

    broadcastScoreboard();
  }
}

// --------------------------------------------------------------------------
// Bot-KI
// --------------------------------------------------------------------------

const BOT_CONFIG = {
  count: 5,            // Ziel-Anzahl an Bots
  moveSpeed: 4,        // Einheiten pro Sekunde
  aggroRange: 400,     // praktisch immer den Spieler verfolgen
  shootRange: 55,      // ab wann Bots schiessen
  fireRate: 1400,      // ms zwischen Schuessen
  tickMs: 100,         // AI-Tick-Intervall
  accuracy: 0.45,      // Chance, dass ein Schuss trifft
  spawnRadius: 22,     // Bots spawnen in Ring um (0,0,0)
  names: [
    'Zombie', 'Drohne', 'Ninja', 'Bandit', 'Wolf',
    'Spectre', 'Jaeger', 'Phantom', 'Krieger', 'Shadow',
  ],
  colors: [0xef4444, 0xa855f7, 0xf97316, 0x14b8a6, 0x22d3ee, 0xeab308],
};

let nextBotIndex = 0;

function botSpawnPoint(idx) {
  // Verteile Bots in einem Ring um das Zentrum, damit der Spieler sie
  // beim Start auf jeden Fall sehen kann.
  const angle = (idx / BOT_CONFIG.count) * Math.PI * 2 + Math.random() * 0.2;
  const r = BOT_CONFIG.spawnRadius + (Math.random() - 0.5) * 6;
  return [Math.cos(angle) * r, 1.7, Math.sin(angle) * r];
}

function createBot() {
  const idx = ++nextBotIndex;
  const id = 'bot-' + idx;
  const namePool = BOT_CONFIG.names;
  const name = '[BOT] ' + namePool[(idx - 1) % namePool.length];
  const color = BOT_CONFIG.colors[(idx - 1) % BOT_CONFIG.colors.length];
  const spawn = botSpawnPoint((idx - 1) % BOT_CONFIG.count);

  const bot = {
    id,
    name,
    position: spawn,
    rotation: [0, Math.random() * Math.PI * 2],
    health: 100,
    kills: 0,
    deaths: 0,
    weapon: 'rifle',
    lastShotAt: 0,
    color,
    // Bot-interne Felder
    isBot: true,
    wanderTarget: randomWanderTarget(),
    wanderChangeAt: Date.now() + 3000 + Math.random() * 4000,
    targetId: null,
  };
  players.set(id, bot);
  io.emit('playerJoined', {
    id: bot.id,
    name: bot.name,
    position: bot.position,
    rotation: bot.rotation,
    health: bot.health,
    kills: bot.kills,
    deaths: bot.deaths,
    weapon: bot.weapon,
    color: bot.color,
  });
  console.log('[bot] spawn', bot.name);
  return bot;
}

function randomWanderTarget() {
  return [
    (Math.random() - 0.5) * 240,
    2,
    (Math.random() - 0.5) * 240,
  ];
}

function findClosestHuman(bot) {
  let best = null;
  let bestDist = Infinity;
  for (const [, p] of players) {
    if (p.isBot || p.health <= 0) continue;
    const dx = p.position[0] - bot.position[0];
    const dz = p.position[2] - bot.position[2];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { target: best, dist: bestDist } : null;
}

function botTick() {
  const now = Date.now();
  const dt = BOT_CONFIG.tickMs / 1000;

  // Bei Bedarf fehlende Bots nachspawnen
  let active = 0;
  for (const [, p] of players) if (p.isBot) active += 1;
  while (active < BOT_CONFIG.count) {
    createBot();
    active += 1;
  }

  for (const [, bot] of players) {
    if (!bot.isBot) continue;
    if (bot.health <= 0) continue;

    const closest = findClosestHuman(bot);

    // Zielauswahl + Bewegung
    let moveTo = null;
    if (closest && closest.dist < BOT_CONFIG.aggroRange) {
      bot.targetId = closest.target.id;
      // Behalte Distanz: wenn zu nah, nicht weiter ranlaufen
      if (closest.dist > 12) {
        moveTo = closest.target.position;
      }
    } else {
      bot.targetId = null;
      if (now > bot.wanderChangeAt) {
        bot.wanderTarget = randomWanderTarget();
        bot.wanderChangeAt = now + 4000 + Math.random() * 4000;
      }
      const wx = bot.wanderTarget[0] - bot.position[0];
      const wz = bot.wanderTarget[2] - bot.position[2];
      if (Math.sqrt(wx * wx + wz * wz) < 3) {
        bot.wanderTarget = randomWanderTarget();
        bot.wanderChangeAt = now + 4000 + Math.random() * 4000;
      }
      moveTo = bot.wanderTarget;
    }

    if (moveTo) {
      const dx = moveTo[0] - bot.position[0];
      const dz = moveTo[2] - bot.position[2];
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const step = Math.min(d, BOT_CONFIG.moveSpeed * dt);
      bot.position = [
        bot.position[0] + (dx / d) * step,
        bot.position[1],
        bot.position[2] + (dz / d) * step,
      ];
      bot.rotation = [0, Math.atan2(-dx, -dz)];
    }

    // Schiessen
    if (
      closest &&
      closest.dist < BOT_CONFIG.shootRange &&
      now - bot.lastShotAt > BOT_CONFIG.fireRate
    ) {
      bot.lastShotAt = now;
      const target = closest.target;
      // Blickrichtung auf den Gegner
      const dx = target.position[0] - bot.position[0];
      const dy = (target.position[1] + 1.5) - (bot.position[1] + 1.5);
      const dz = target.position[2] - bot.position[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const dir = [dx / len, dy / len, dz / len];
      bot.rotation = [0, Math.atan2(-dx, -dz)];

      io.emit('shot', {
        shooter: bot.id,
        origin: [bot.position[0], bot.position[1] + 1.5, bot.position[2]],
        direction: dir,
        weapon: bot.weapon,
      });

      // Distanz-abhaengige Trefferchance
      const accuracy = BOT_CONFIG.accuracy * Math.max(0.3, 1 - closest.dist / BOT_CONFIG.shootRange);
      if (Math.random() < accuracy) {
        const headshot = Math.random() < 0.1;
        applyDamage(target, bot, bot.weapon, headshot);
      }
    }

    // Bewegung broadcasten
    io.emit('playerMoved', {
      id: bot.id,
      position: bot.position,
      rotation: bot.rotation,
      weapon: bot.weapon,
    });
  }
}

// Initiale Bots + Tick-Schleife starten
for (let i = 0; i < BOT_CONFIG.count; i++) createBot();
setInterval(botTick, BOT_CONFIG.tickMs);

// --------------------------------------------------------------------------
// Socket.IO Handler
// --------------------------------------------------------------------------

io.on('connection', (socket) => {
  const spawn = randomSpawn();

  /** @type {Player} */
  const player = {
    id: socket.id,
    name: 'Spieler-' + socket.id.slice(0, 4),
    position: spawn,
    rotation: [0, 0],
    health: 100,
    kills: 0,
    deaths: 0,
    weapon: 'rifle',
    lastShotAt: 0,
    color: Math.floor(Math.random() * 0xffffff),
  };
  players.set(socket.id, player);

  console.log('[+] connect', player.name, 'total:', players.size);

  // Begruessungspaket an den neuen Spieler
  socket.emit('init', {
    selfId: socket.id,
    weapons: WEAPONS,
    players: serializePlayers(),
    spawn,
  });

  // Alle anderen Spieler informieren
  socket.broadcast.emit('playerJoined', players.get(socket.id));
  broadcastScoreboard();

  // Name setzen
  socket.on('setName', (name) => {
    if (typeof name !== 'string') return;
    const clean = name.trim().slice(0, 16) || player.name;
    player.name = clean;
    io.emit('playerRenamed', { id: socket.id, name: clean });
    broadcastScoreboard();
  });

  // Positions-Update: hochfrequente Bewegungsdaten
  socket.on('move', (data) => {
    if (!data || !Array.isArray(data.position) || !Array.isArray(data.rotation)) return;
    // leichte sanity-checks gegen offensichtlichen Unsinn
    const [x, y, z] = data.position;
    if (![x, y, z].every((n) => Number.isFinite(n))) return;
    player.position = [x, y, z];
    player.rotation = [Number(data.rotation[0]) || 0, Number(data.rotation[1]) || 0];
    if (typeof data.weapon === 'string' && WEAPONS[data.weapon]) {
      player.weapon = data.weapon;
    }

    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      position: player.position,
      rotation: player.rotation,
      weapon: player.weapon,
    });
  });

  // Schuss-Event: Server verrechnet Schaden
  socket.on('shoot', (data) => {
    if (!data) return;
    const weapon = WEAPONS[player.weapon];
    if (!weapon) return;
    const now = Date.now();
    if (now - player.lastShotAt < weapon.fireRate) return;
    player.lastShotAt = now;

    // Rueckmeldung fuer Effekt bei allen Clients
    io.emit('shot', {
      shooter: socket.id,
      origin: data.origin,
      direction: data.direction,
      weapon: player.weapon,
    });

    // Trefferberechnung: Client reicht einen potentiellen Treffer ein,
    // Server pruefts auf Plausibilitaet (Reichweite + Ziel existiert).
    if (data.hit && typeof data.hit.target === 'string') {
      const target = players.get(data.hit.target);
      if (!target || target.id === player.id || target.health <= 0) return;

      const dx = target.position[0] - player.position[0];
      const dy = target.position[1] - player.position[1];
      const dz = target.position[2] - player.position[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > weapon.range + 5) return;

      applyDamage(target, player, player.weapon, !!data.hit.headshot);
    }
  });

  // Chat-Nachrichten
  socket.on('chat', (text) => {
    if (typeof text !== 'string') return;
    const msg = text.trim().slice(0, 120);
    if (!msg) return;
    io.emit('chat', { from: player.name, text: msg, id: socket.id });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('playerLeft', socket.id);
    broadcastScoreboard();
    console.log('[-] disconnect', player.name, 'total:', players.size);
  });
});

server.listen(PORT, () => {
  console.log(`>> Patrick Battle Royale laeuft auf http://localhost:${PORT}`);
});
