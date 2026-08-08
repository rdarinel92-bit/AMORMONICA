import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'www');

const assets = [
  'index.html',
  'app.js',
  'styles.css',
  'manifest.json',
  'sw.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png'
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const asset of assets) {
  const source = join(root, asset);
  const destination = join(outDir, asset);

  if (!existsSync(source)) {
    throw new Error(`No se encontro el archivo requerido: ${asset}`);
  }

  copyFileSync(source, destination);
}

console.log('www listo para Capacitor.');
