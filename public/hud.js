/**
 * Kleines HUD-Modul: aktualisiert alle UI-Elemente.
 */

const $ = (id) => document.getElementById(id);

export const HUD = {
  setHealth(hp) {
    const fill = $('healthFill');
    const txt = $('healthText');
    const clamped = Math.max(0, Math.min(100, hp));
    fill.style.width = clamped + '%';
    fill.style.background = clamped > 50
      ? 'linear-gradient(90deg, #16a34a, #22c55e)'
      : clamped > 25
        ? 'linear-gradient(90deg, #ca8a04, #facc15)'
        : 'linear-gradient(90deg, #991b1b, #ef4444)';
    txt.textContent = Math.round(clamped);
  },
  setWeapon(name, ammo, mag) {
    $('weaponName').textContent = name;
    $('ammoText').textContent = ammo + ' / ' + mag;
  },
  setStats(kills, deaths, playerCount) {
    $('kCount').textContent = kills;
    $('dCount').textContent = deaths;
    $('pCount').textContent = playerCount;
  },
  addKillFeed(killerName, victimName, weapon, headshot) {
    const feed = $('killFeed');
    const el = document.createElement('div');
    el.className = 'killMsg' + (headshot ? ' head' : '');
    const icon = headshot ? '[KOPFSCHUSS]' : '[KILL]';
    el.textContent = `${icon} ${killerName} [${weapon}] ${victimName}`;
    feed.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  },
  addChat(from, text) {
    const log = $('chatLog');
    const line = document.createElement('div');
    line.className = 'chatLine';
    line.innerHTML = `<b>${escapeHtml(from)}:</b> ${escapeHtml(text)}`;
    log.appendChild(line);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => line.remove(), 10000);
  },
  showDeathScreen(show) {
    $('deathScreen').classList.toggle('hidden', !show);
  },
  setRespawnTimer(sec) {
    $('respawnTimer').textContent = sec;
  },
  showScoreboard(show) {
    $('scoreboard').classList.toggle('hidden', !show);
  },
  updateScoreboard(rows, selfId) {
    const body = $('scoreBody');
    body.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.id === selfId) tr.classList.add('me');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.kills}</td>
        <td>${r.deaths}</td>
      `;
      body.appendChild(tr);
    });
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
