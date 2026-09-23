const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.cwd();
const { Client } = require(path.join(root, 'node_modules/pg'));
(async () => {
  const mainUrl = process.env.TEST_MAIN_POSTGRES_URL;
  const dataUrl = process.env.TEST_DATA_POSTGRES_URL;
  if (!mainUrl || !dataUrl)
    throw new Error('Provide TEST_MAIN_POSTGRES_URL and TEST_DATA_POSTGRES_URL for migrated disposable test databases');
  const main = new URL(mainUrl),
    data = new URL(dataUrl);
  for (const url of [main, data]) {
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !url.pathname.includes('test'))
      throw new Error('Smoke test permits only local databases with test in their name');
  }

  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'waply-two-node-'));
  const client = new Client({ connectionString: mainUrl });
  const key = 'owa_test_' + crypto.randomBytes(32).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const children = [];
  let socket;
  try {
    await client.connect();
    await client.query('INSERT INTO api_keys (name,"keyHash","keyPrefix",role) VALUES ($1,$2,$3,$4)', [
      'isolated two-node smoke',
      crypto.createHash('sha256').update(key).digest('hex'),
      key.slice(0, 12),
      'admin',
    ]);
    for (let i = 0; i < 2; i++) {
      const cwd = path.join(testRoot, String(i));
      fs.mkdirSync(cwd);
      const log = fs.openSync(path.join(cwd, 'boot.log'), 'w', 0o600);
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'test',
        PORT: String(28441 + i),
        MAIN_DATABASE_TYPE: 'postgres',
        MAIN_DATABASE_URL: mainUrl,
        MAIN_DATABASE_SYNCHRONIZE: 'false',
        DATABASE_TYPE: 'postgres',
        DATABASE_HOST: data.hostname,
        DATABASE_PORT: data.port || '5432',
        DATABASE_USERNAME: decodeURIComponent(data.username),
        DATABASE_PASSWORD: decodeURIComponent(data.password) || secret,
        DATABASE_NAME: data.pathname.slice(1),
        DATABASE_SYNCHRONIZE: 'false',
        REDIS_ENABLED: process.env.TEST_REDIS_PORT ? 'true' : 'false',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: process.env.TEST_REDIS_PORT || '55440',
        QUEUE_ENABLED: 'false',
        AUTO_START_SESSIONS: 'false',
        MCP_ENABLED: 'false',
        API_MASTER_KEY: key,
        LOG_LEVEL: 'error',
        NODE_ID: 'smoke-' + i,
        NODE_URL: 'http://127.0.0.1:' + String(28441 + i),
      };
      children.push(
        spawn(process.execPath, [path.join(root, 'dist/main.js')], { cwd, env, stdio: ['ignore', log, log] }),
      );
      fs.closeSync(log);
    }
    for (let i = 0; i < 2; i++) {
      let ready = false;
      for (let n = 0; n < 30; n++) {
        if (children[i].exitCode !== null) throw new Error('Node ' + i + ' exited; logs: ' + testRoot);
        try {
          const r = await fetch('http://127.0.0.1:' + String(28441 + i) + '/api/health/ready', {
            signal: AbortSignal.timeout(1000),
          });
          if (r.ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
      if (!ready) throw new Error('Node ' + i + ' not ready; logs: ' + testRoot);
    }
    const lists = [];
    for (let i = 0; i < 2; i++) {
      const r = await fetch('http://127.0.0.1:' + String(28441 + i) + '/api/auth/api-keys', {
        headers: { 'x-api-key': key },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error('Auth rejected on node ' + i + ': ' + r.status);
      lists.push(await r.json());
    }
    if (JSON.stringify(lists[0]) !== JSON.stringify(lists[1])) throw new Error('Shared auth list differs');
    if (process.env.TEST_REDIS_PORT) {
      const { io } = require(path.join(root, 'dashboard/node_modules/socket.io-client'));
      const operatorKey = 'owa_test_' + crypto.randomBytes(32).toString('hex');
      const inserted = await client.query(
        'INSERT INTO api_keys (name,"keyHash","keyPrefix",role) VALUES ($1,$2,$3,$4) RETURNING id',
        [
          'isolated peer socket',
          crypto.createHash('sha256').update(operatorKey).digest('hex'),
          operatorKey.slice(0, 12),
          'admin',
        ],
      );
      socket = io('http://127.0.0.1:28442/events', {
        transports: ['websocket'],
        auth: { apiKey: operatorKey },
        reconnection: false,
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Peer socket did not authenticate')), 5000);
        socket.on('connect_error', reject);
        socket.on('connect', () =>
          setTimeout(
            () =>
              socket.emit('message', { type: 'subscribe', sessionId: '*', events: ['session.status'] }, reply => {
                clearTimeout(timer);
                if (reply?.type === 'subscribed') resolve();
                else reject(new Error('Subscription acknowledgement: ' + JSON.stringify(reply)));
              }),
            200,
          ),
        );
        socket.on('message', message => {
          if (message.type === 'subscribed') {
            clearTimeout(timer);
            resolve();
          }
          if (message.type === 'error') {
            clearTimeout(timer);
            reject(new Error('Peer subscription rejected'));
          }
        });
      });
      const disconnected = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Revoked key still connected on peer')), 5000);
        socket.once('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const revoked = await fetch('http://127.0.0.1:28441/api/auth/api-keys/' + inserted.rows[0].id + '/revoke', {
        method: 'POST',
        headers: { 'x-api-key': key },
        signal: AbortSignal.timeout(5000),
      });
      if (!revoked.ok) throw new Error('Cross-node revoke failed: ' + revoked.status);
      await disconnected;
      console.log('PASS: key revoked on node A disconnected its authenticated WebSocket on node B through Redis.');
    }
    console.log(
      'PASS: two complete app processes ready; same credential authenticates on both; shared auth records match. Test logs: ' +
        testRoot,
    );
  } finally {
    socket?.close();
    for (const c of children) c.kill('SIGTERM');
    await Promise.all(
      children.map(
        c =>
          new Promise(resolve => {
            if (c.exitCode !== null) return resolve();
            const timeout = setTimeout(() => {
              c.kill('SIGKILL');
              resolve();
            }, 10000);
            c.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          }),
      ),
    );
    await client.end();
  }
})().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
