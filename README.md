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

## Installation

```bash
npm install
npm start
```

Server laeuft dann auf `http://localhost:3000`.
Oeffne die Adresse in mehreren Browserfenstern (oder lass Freunde im gleichen
Netzwerk `http://DEINE-IP:3000` aufrufen), um zusammen zu spielen.

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
