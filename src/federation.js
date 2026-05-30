'use strict';

/**
 * FederationPeer
 * Pure-JS port of ruflo/v3/crates/ruflo-federation-peer/src/lib.rs
 * Transport: TCP sockets (built-in net module, no QUIC needed)
 * Safety gate: regex-based pattern matching (no aimds native lib)
 * Runs on Node 14 ia32
 */

var net          = require('net');
var EventEmitter = require('events').EventEmitter;

// ── Safety Gate ────────────────────────────────────────────────────────────

var BLOCK_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9\-_]{20,}/i,
  /secret\s*[:=]\s*["']?[a-zA-Z0-9\-_]{10,}/i,
  /password\s*[:=]\s*["']?\S{6,}/i,
  /Bearer\s+[A-Za-z0-9\-_\.]+/,
  /sk-[A-Za-z0-9]{20,}/,   // OpenAI-style keys
  /ghp_[A-Za-z0-9]{36}/,   // GitHub PATs
];

var REDACT_PATTERNS = [
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,           replace: '[IP]'    },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, replace: '[EMAIL]' },
];

function inspectMessage(msg) {
  var text = JSON.stringify(msg.payload || '');

  // Block pass
  for (var i = 0; i < BLOCK_PATTERNS.length; i++) {
    if (BLOCK_PATTERNS[i].test(text)) {
      return { verdict: 'block', reason: 'Pattern matched: ' + BLOCK_PATTERNS[i].source };
    }
  }

  // Redact pass
  var redacted = text;
  var modified = false;
  for (var j = 0; j < REDACT_PATTERNS.length; j++) {
    var replaced = redacted.replace(REDACT_PATTERNS[j].pattern, REDACT_PATTERNS[j].replace);
    if (replaced !== redacted) { modified = true; redacted = replaced; }
  }

  if (modified) {
    var cleanMsg = JSON.parse(JSON.stringify(msg)); // deep clone
    try { cleanMsg.payload = JSON.parse(redacted); } catch (_) { cleanMsg.payload = redacted; }
    return { verdict: 'redact', msg: cleanMsg };
  }

  return { verdict: 'pass' };
}

// ── FederationPeer ─────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {number}   opts.port          Port to listen on (server mode)
 * @param {string}   [opts.remoteHost]  Remote peer host (client mode)
 * @param {number}   [opts.remotePort]  Remote peer port (client mode)
 * @param {Function} [opts.onDispatch]  Called with (sender, msg) after gate pass
 * @param {Function} [opts.onLog]       Called with (level, text) for logging
 */
function FederationPeer(opts) {
  EventEmitter.call(this);
  opts = opts || {};

  this.port        = opts.port || 7700;
  this.remoteHost  = opts.remoteHost || null;
  this.remotePort  = opts.remotePort || null;
  this.onDispatch  = opts.onDispatch  || function(sender, msg) {};
  this.onLog       = opts.onLog       || function(level, text) {};

  this._server     = null;
  this._clientSock = null;
}

FederationPeer.prototype = Object.create(EventEmitter.prototype);
FederationPeer.prototype.constructor = FederationPeer;

/** Start server (listen for inbound peers) */
FederationPeer.prototype.listen = function() {
  var self = this;
  self._server = net.createServer(function(socket) {
    self._handleSocket(socket, socket.remoteAddress + ':' + socket.remotePort);
  });
  self._server.listen(self.port, '0.0.0.0', function() {
    self.onLog('info', 'FederationPeer listening on :' + self.port);
  });
};

/** Connect to remote peer */
FederationPeer.prototype.connect = function() {
  var self = this;
  var sock = net.connect(self.remotePort, self.remoteHost, function() {
    self._clientSock = sock;
    self._handleSocket(sock, self.remoteHost + ':' + self.remotePort);
    self.onLog('info', 'Connected to ' + self.remoteHost + ':' + self.remotePort);
    self.emit('connected');
  });
  sock.on('error', function(err) { self.onLog('error', 'Connect error: ' + err.message); });
};

/** Send a FederationMessage to connected peer */
FederationPeer.prototype.send = async function(addr, msg) {
  var self = this;
  var verdict = inspectMessage(msg);

  if (verdict.verdict === 'block') {
    self.onLog('warn', 'Outbound blocked [' + msg.id + ']: ' + verdict.reason);
    throw new Error('Gate blocked: ' + verdict.reason);
  }

  var outMsg = verdict.verdict === 'redact' ? verdict.msg : msg;
  var line   = JSON.stringify(outMsg) + '\n';
  var sock   = self._clientSock;
  if (!sock || sock.destroyed) throw new Error('Not connected to ' + addr);

  return new Promise(function(resolve, reject) {
    sock.write(line, 'utf8', function(err) {
      if (err) reject(err); else resolve();
    });
  });
};

/** Graceful close */
FederationPeer.prototype.close = async function() {
  if (this._clientSock) { this._clientSock.destroy(); this._clientSock = null; }
  if (this._server)     { this._server.close(); this._server = null; }
};

// ── private ────────────────────────────────────────────────────────────────

FederationPeer.prototype._handleSocket = function(socket, sender) {
  var self = this;
  var buf  = '';

  socket.setEncoding('utf8');
  socket.on('data', function(chunk) {
    buf += chunk;
    var lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line
    lines.forEach(function(line) {
      line = line.trim();
      if (!line) return;
      var msg;
      try { msg = JSON.parse(line); }
      catch (e) { self.onLog('warn', 'Malformed message from ' + sender); return; }

      var verdict = inspectMessage(msg);
      if (verdict.verdict === 'block') {
        self.onLog('warn', 'Inbound blocked [' + msg.id + '] from ' + sender + ': ' + verdict.reason);
        return; // quarantine — never reaches dispatch
      }
      if (verdict.verdict === 'redact') {
        self.onLog('info', 'Inbound redacted [' + msg.id + '] from ' + sender);
        self.onDispatch(sender, verdict.msg);
        return;
      }
      self.onDispatch(sender, msg);
    });
  });

  socket.on('close', function()  { self.onLog('info', 'Peer disconnected: ' + sender); });
  socket.on('error', function(e) { self.onLog('error', 'Socket error from ' + sender + ': ' + e.message); });
};

module.exports = { FederationPeer: FederationPeer, inspectMessage: inspectMessage };
