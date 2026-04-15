#!/usr/bin/env node
/**
 * Kopiert die benoetigten Vendor-Dateien aus node_modules nach
 * public/vendor/, damit das Spiel auch auf statischen Hosts wie Vercel
 * funktioniert, wo kein Node-Server laeuft, der /vendor/* dynamisch
 * aus node_modules serviert.
 *
 * Wird beim "npm run build" und automatisch via "postinstall" ausgefuehrt.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const copies = [
  {
    from: 'node_modules/three/build/three.module.js',
    to: 'public/vendor/three/build/three.module.js',
  },
  {
    from: 'node_modules/three/build/three.core.js',
    to: 'public/vendor/three/build/three.core.js',
  },
  {
    from: 'node_modules/three/examples/jsm/controls/PointerLockControls.js',
    to: 'public/vendor/three/examples/jsm/controls/PointerLockControls.js',
  },
  {
    from: 'node_modules/socket.io/client-dist/socket.io.js',
    to: 'public/vendor/socket.io/socket.io.js',
  },
];

let copied = 0;
let skipped = 0;
for (const c of copies) {
  const src = path.join(root, c.from);
  const dst = path.join(root, c.to);
  if (!fs.existsSync(src)) {
    console.warn('[vendor] quelle fehlt, ueberspringe:', c.from);
    skipped += 1;
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied += 1;
  console.log('[vendor] copied', c.from, '->', c.to);
}

console.log(`[vendor] done (${copied} copied, ${skipped} skipped)`);
