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

const SPAWN_POINTS = [
  [  0, 2,   0],
  [ 40, 2,  40],
  [-40, 2,  40],
  [ 40, 2, -40],
  [-40, 2, -40],
  [ 70, 2,   0],
  [-70, 2,   0],
  [  0, 2,  70],
  [  0, 2, -70],
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
    // Server pruefts auf Plausibilitaet (Reichweite + Spieler existiert).
    if (data.hit && typeof data.hit.target === 'string') {
      const target = players.get(data.hit.target);
      if (!target || target.id === player.id || target.health <= 0) return;

      const dx = target.position[0] - player.position[0];
      const dy = target.position[1] - player.position[1];
      const dz = target.position[2] - player.position[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > weapon.range + 5) return;

      const headshot = !!data.hit.headshot;
      let dmg = weapon.damage * (headshot ? 2.0 : 1.0);
      // Distanz-Falloff fuer Schrotflinte
      if (player.weapon === 'shotgun') {
        dmg *= Math.max(0.2, 1 - dist / weapon.range);
      }
      dmg = Math.round(dmg);

      target.health = Math.max(0, target.health - dmg);
      io.emit('damage', {
        target: target.id,
        attacker: player.id,
        damage: dmg,
        headshot,
        health: target.health,
      });

      if (target.health <= 0) {
        target.deaths += 1;
        player.kills += 1;
        io.emit('kill', {
          killer: player.id,
          victim: target.id,
          killerName: player.name,
          victimName: target.name,
          weapon: player.weapon,
          headshot,
        });

        // Respawn nach kurzer Zeit
        setTimeout(() => {
          const t = players.get(target.id);
          if (!t) return;
          t.health = 100;
          t.position = randomSpawn();
          io.emit('respawn', {
            id: t.id,
            position: t.position,
            health: t.health,
          });
        }, 2500);

        broadcastScoreboard();
      }
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
