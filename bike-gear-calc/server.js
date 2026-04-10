'use strict';

const http = require('http');
const { gearTable, WHEEL_CIRCUMFERENCES_M } = require('./index');

const PORT = parseInt(process.env.PORT || '3000', 10);
const WHEEL_SIZES = Object.keys(WHEEL_CIRCUMFERENCES_M);

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseInts(str, fallback) {
  const nums = String(str).split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0 && n < 200);
  return nums.length ? nums : fallback;
}

function renderPage(params, rows) {
  const wheelOptions = WHEEL_SIZES.map(w =>
    `<option value="${w}"${params.wheel === w ? ' selected' : ''}>${w}</option>`
  ).join('');

  const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.chainring}</td><td>${r.cog}</td>
        <td>${r.ratio.toFixed(2)}</td><td>${r.developmentM.toFixed(2)}</td>
        <td>${r.kmh}</td><td>${r.mph}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bike Gear Calculator</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { margin-bottom: 0.25rem; }
    p.sub { color: #666; margin-top: 0; }
    form { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1.5rem 0; align-items: flex-end; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 0.875rem; font-weight: 500; }
    input, select { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; width: 200px; }
    input[type=number] { width: 90px; }
    button { padding: 7px 18px; background: #0070f3; color: #fff; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; }
    button:hover { background: #005ec4; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    thead th { background: #f4f4f5; text-align: right; padding: 8px 12px; border-bottom: 2px solid #ddd; }
    thead th:first-child { text-align: left; }
    td { padding: 6px 12px; border-bottom: 1px solid #eee; text-align: right; }
    td:first-child { text-align: left; }
    tr:hover td { background: #fafafa; }
  </style>
</head>
<body>
  <h1>Bicycle Gear Calculator</h1>
  <p class="sub">Sorted by gear ratio — low to high</p>
  <form method="GET" action="/">
    <label>Chainrings (teeth)
      <input name="chainrings" value="${escapeHtml(params.chainrings)}" placeholder="e.g. 50,34">
    </label>
    <label>Cassette (teeth)
      <input name="cogs" value="${escapeHtml(params.cogs)}" placeholder="e.g. 11,13,…,32">
    </label>
    <label>Cadence (RPM)
      <input name="cadence" type="number" value="${escapeHtml(params.cadence)}" min="40" max="200">
    </label>
    <label>Wheel size
      <select name="wheel">${wheelOptions}</select>
    </label>
    <button type="submit">Calculate</button>
  </form>
  <table>
    <thead>
      <tr>
        <th>Chainring</th><th>Cog</th><th>Ratio</th>
        <th>Dev (m)</th><th>km/h</th><th>mph</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }

  const url = new URL(req.url, `http://localhost`);
  const params = {
    chainrings: url.searchParams.get('chainrings') || '50,34',
    cogs:       url.searchParams.get('cogs')       || '11,13,15,17,19,22,25,28,32',
    cadence:    url.searchParams.get('cadence')    || '90',
    wheel:      url.searchParams.get('wheel')      || '700c',
  };

  const chainrings = parseInts(params.chainrings, [50, 34]);
  const cogs       = parseInts(params.cogs,       [11, 13, 15, 17, 19, 22, 25, 28, 32]);
  const cadence    = Math.min(200, Math.max(40, parseInt(params.cadence, 10) || 90));
  const wheel      = WHEEL_SIZES.includes(params.wheel) ? params.wheel : '700c';

  try {
    const rows = gearTable(chainrings, cogs, cadence, wheel);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage({ ...params, wheel }, rows));
  } catch (err) {
    res.writeHead(500).end('Error: ' + err.message);
  }
});

server.listen(PORT, () => console.log(`Bike gear calculator running on http://localhost:${PORT}`));
