// Render build/icon.svg → build/icon.png at 1024x1024 using Electron's
// off-screen Chromium rasterizer. The SVG is the design source of truth;
// rerun this any time the SVG changes. Invoke via:
//   devbox run npx electron scripts/render-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Pin device scale to 1 so capturePage returns SIZExSIZE rather than 2x on Retina.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');

const SIZE = 1024;
const SVG_PATH = path.join(__dirname, '..', 'build', 'icon.svg');
const OUT_PATH = path.join(__dirname, '..', 'build', 'icon.png');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG_PATH, 'utf8');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin:0; padding:0; }
  body { width:${SIZE}px; height:${SIZE}px; background:#0D1226; }
  svg { display:block; width:${SIZE}px; height:${SIZE}px; }
</style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    useContentSize: true,
    backgroundColor: '#0D1226',
    webPreferences: { offscreen: false }
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 250));

  const captured = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  // capturePage scales by device pixel ratio on Retina; resize back to the canonical SIZE.
  const image = captured.getSize().width === SIZE
    ? captured
    : captured.resize({ width: SIZE, height: SIZE, quality: 'best' });
  fs.writeFileSync(OUT_PATH, image.toPNG());
  console.log(`Wrote ${OUT_PATH} (${image.getSize().width}x${image.getSize().height})`);

  win.close();
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
