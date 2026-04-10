#!/usr/bin/env node
'use strict';

/**
 * GitHub webhook receiver.
 * Verifies the HMAC-SHA256 signature, then on a push to DEPLOY_BRANCH
 * runs: git pull → npm install → pm2 restart web
 *
 * Config (env vars):
 *   SECRET_FILE    path to file containing the webhook secret  (default /srv/app/.webhook-secret)
 *   REPO_DIR       path to the cloned repo                     (default /srv/app)
 *   DEPLOY_BRANCH  branch that triggers a deploy               (default main)
 *   PORT           port to listen on                           (default 9000)
 */

const http       = require('http');
const crypto     = require('crypto');
const fs         = require('fs');
const { execFile } = require('child_process');

const SECRET_FILE   = process.env.SECRET_FILE   || '/srv/app/.webhook-secret';
const REPO_DIR      = process.env.REPO_DIR      || '/srv/app';
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || 'main';
const PORT          = parseInt(process.env.PORT  || '9000', 10);

const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();

function verifySignature(payload, header) {
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch {
    return false;
  }
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, opts, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim())
    )
  );
}

async function deploy() {
  console.log('[deploy] pulling latest code…');
  const pulled = await run('git', ['-C', REPO_DIR, 'pull', 'origin', DEPLOY_BRANCH]);
  console.log('[deploy] git pull:', pulled);

  console.log('[deploy] installing dependencies…');
  await run('npm', ['install', '--omit=dev', '--prefix', `${REPO_DIR}/bike-gear-calc`]);

  console.log('[deploy] restarting web app…');
  const pm2out = await run('pm2', ['restart', 'web']);
  console.log('[deploy] pm2:', pm2out);

  console.log('[deploy] done');
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404).end('Not found');
    return;
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const sig  = req.headers['x-hub-signature-256'] || '';

    if (!verifySignature(body, sig)) {
      console.warn('[webhook] rejected — bad signature');
      res.writeHead(401).end('Unauthorized');
      return;
    }

    const event = req.headers['x-github-event'];
    if (event !== 'push') {
      res.writeHead(200).end('Ignored');
      return;
    }

    let payload;
    try { payload = JSON.parse(body); } catch { res.writeHead(400).end('Bad JSON'); return; }

    if (payload.ref !== `refs/heads/${DEPLOY_BRANCH}`) {
      res.writeHead(200).end(`Ignored — not ${DEPLOY_BRANCH}`);
      return;
    }

    const pusher  = payload.pusher?.name || 'unknown';
    const commits = payload.commits?.length || 0;
    console.log(`[webhook] push by ${pusher} (${commits} commit(s)) — deploying`);

    res.writeHead(202).end('Deploying');

    deploy().catch(err => console.error('[deploy] failed:', err.message));
  });
});

server.listen(PORT, () =>
  console.log(`Webhook receiver listening on :${PORT} (branch: ${DEPLOY_BRANCH})`)
);
