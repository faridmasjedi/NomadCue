// Built-in web remote: any phone/tablet/laptop browser on the network can run the show.
// Free replacement for a paid iOS remote app.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

class RemoteServer {
  constructor({ onCommand }) {
    this.onCommand = onCommand;
    this.server = null;
    this.wss = null;
    this.state = null;
    this.passcode = '';
    this.port = 0;
  }

  start(port, passcode = '') {
    this.stop();
    this.passcode = String(passcode || '');
    this.port = port;
    const page = path.join(__dirname, '..', 'remote', 'index.html');
    this.server = http.createServer((req, res) => {
      if (req.url === '/' || req.url.startsWith('/?')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(page).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => {
      ws.authed = !this.passcode;
      if (ws.authed && this.state) ws.send(JSON.stringify({ type: 'state', state: this.state }));
      ws.send(JSON.stringify({ type: 'hello', needsPasscode: !ws.authed }));
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch (_) { return; }
        if (msg.type === 'auth') {
          ws.authed = msg.passcode === this.passcode;
          ws.send(JSON.stringify({ type: 'auth', ok: ws.authed }));
          if (ws.authed && this.state) ws.send(JSON.stringify({ type: 'state', state: this.state }));
          return;
        }
        if (!ws.authed) return;
        if (msg.type === 'command') this.onCommand(msg);
      });
    });
    this.server.on('error', (e) => console.error('[remote]', e.message));
    this.server.listen(port, '0.0.0.0');
  }

  stop() {
    if (this.wss) { for (const c of this.wss.clients) c.terminate(); this.wss.close(); }
    if (this.server) this.server.close();
    this.server = null;
    this.wss = null;
  }

  broadcast(state) {
    this.state = state;
    if (!this.wss) return;
    const data = JSON.stringify({ type: 'state', state });
    for (const c of this.wss.clients) if (c.authed && c.readyState === 1) c.send(data);
  }

  urls() {
    if (!this.server) return [];
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${this.port}/`);
      }
    }
    out.push(`http://localhost:${this.port}/`);
    return out;
  }
}

module.exports = { RemoteServer };
