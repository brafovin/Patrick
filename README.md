# Patrick Battle Royale

Ein Fortnite-inspiriertes Multiplayer-Shooter-Spiel im Browser.
Gebaut mit **Three.js** (3D-Rendering), **Node.js + Express** (Server)
und **Socket.IO** (Echtzeit-Multiplayer).

## Features

- Echte Multiplayer-Partien mit anderen Spielern ueber einen zentralen Server
- Free-Roaming 3D-Welt mit Gebaeuden, Kisten und Baeumen
- First-Person-Steuerung mit WASD, Maus, Sprung und Sprinten
- Drei Waffen: Pistole, Gewehr (Vollautomatik) und Schrotflinte
- Kopfschuss-Erkennung, Schaden, Kills und Respawn
- Scoreboard, Kill-Feed und In-Game-Chat
- Autoritative Server-Logik fuer Hit-Verrechnung

## Installation (lokal, mit echtem Multiplayer)

```bash
npm install
npm start
```

Server laeuft dann auf `http://localhost:3000`.
Oeffne die Adresse in mehreren Browserfenstern (oder lass Freunde im gleichen
Netzwerk `http://DEINE-IP:3000` aufrufen), um zusammen zu spielen. `npm install`
ruft per `postinstall` automatisch `scripts/vendor.js` auf und kopiert
Three.js sowie den socket.io-Client nach `public/vendor/`.

## Deployment auf Vercel (automatischer Offline-Modus)

Vercel ist ein Static-Host und kann **keinen** persistenten Socket.IO-Server
betreiben. Das Spiel erkennt das automatisch: Wenn nach 3 Sekunden kein
Server antwortet, springt es in den **Offline-Modus** und spawnt 5
Client-Side-Bots, gegen die du solo kaempfen kannst.

Die `vercel.json` sagt Vercel, dass `public/` als statischer Output
deployt werden soll und `node scripts/vendor.js` vorher ausgefuehrt wird
um Three.js und socket.io nach `public/vendor/` zu kopieren.

Um zu deployen:

```bash
npx vercel
```

oder via der Vercel-Web-UI das Repo verbinden. Keine Zusatzkonfiguration
noetig.

## Steuerung

| Taste | Aktion |
| --- | --- |
| W / A / S / D | Laufen |
| Maus | Umschauen / Zielen |
| Linke Maustaste | Schiessen |
| Leertaste | Springen |
| Shift | Sprinten |
| 1 / 2 / 3 | Pistole / Gewehr / Schrotflinte |
| R | Nachladen |
| T | Chat oeffnen |
| Tab | Scoreboard anzeigen |
| Esc | Maus freigeben |

## Projektstruktur

```
.
├── package.json
├── server.js           # Express + Socket.IO Server (autoritativ)
└── public/
    ├── index.html      # Startmenue + HUD
    ├── style.css       # Styling fuer Menue und HUD
    ├── game.js         # Hauptspiel (Rendering, Input, Netzwerk)
    ├── world.js        # Prozedurale Welt mit Collidern
    ├── player.js       # Remote-Spieler-Meshes, Kollision
    ├── weapons.js      # Waffendefinitionen, View-Model, Effekte
    └── hud.js          # UI-Updates (Leben, Munition, Feed, Chat)
```

## Hinweise

- Three.js und Addons werden per ES-Module-Imports von unpkg geladen.
  Eine aktive Internetverbindung ist daher beim Start noetig.
- Das Spiel nutzt Pointer-Lock fuer Maussteuerung; nach `Esc` einmal
  auf das Spielfenster klicken, um die Maus wieder zu fangen.
- Der Server ist autoritativ fuer Schaden. Clients schlagen Treffer vor,
  der Server verifiziert Reichweite und Existenz des Ziels.
