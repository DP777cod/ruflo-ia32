'use strict';

/**
 * MemoryBackend — simple in-memory key-value store
 * No SQLite, no native binaries → runs on ia32
 * Optional JSON file persistence for cross-session storage
 */

var fs   = require('fs');
var path = require('path');

var DEFAULT_FILE = path.join(
  process.env.HOME || '/tmp',
  '.ruflo-memory.json'
);

class MemoryBackend {
  constructor(opts) {
    opts = opts || {};
    this._store   = {};       // id → entry
    this._maxSize = opts.maxSize || 10000;
    this._file    = opts.persist ? (opts.file || DEFAULT_FILE) : null;
    if (this._file) this._load();
  }

  /** Store or update an entry */
  async store(entry) {
    if (Object.keys(this._store).length >= this._maxSize) {
      // Evict oldest
      var oldest = Object.keys(this._store)
        .sort(function(a, b) {
          return (this._store[a].timestamp || 0) - (this._store[b].timestamp || 0);
        }.bind(this))[0];
      delete this._store[oldest];
    }
    this._store[entry.id] = entry;
    this._flush();
    return entry;
  }

  /** Retrieve by id */
  async retrieve(id) {
    return this._store[id] || null;
  }

  /** Search entries — supports type, agentId, text filters */
  async search(query) {
    query = query || {};
    var entries = Object.values(this._store);

    if (query.type)    entries = entries.filter(function(e) { return e.type    === query.type;    });
    if (query.agentId) entries = entries.filter(function(e) { return e.agentId === query.agentId; });
    if (query.text)    entries = entries.filter(function(e) {
      return (e.content || '').toLowerCase().indexOf(query.text.toLowerCase()) !== -1;
    });

    entries.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    if (query.limit) entries = entries.slice(0, query.limit);
    return entries;
  }

  /** Delete an entry */
  async delete(id) {
    var existed = !!this._store[id];
    delete this._store[id];
    if (existed) this._flush();
    return existed;
  }

  /** Number of stored entries */
  size() { return Object.keys(this._store).length; }

  /** Clear everything */
  async clear() {
    this._store = {};
    this._flush();
  }

  // ── private ──────────────────────────────────────────────────────────────

  _load() {
    try {
      var raw = fs.readFileSync(this._file, 'utf8');
      this._store = JSON.parse(raw);
    } catch (_) {
      this._store = {};
    }
  }

  _flush() {
    if (!this._file) return;
    try {
      fs.writeFileSync(this._file, JSON.stringify(this._store), 'utf8');
    } catch (_) { /* ignore write errors in restricted envs */ }
  }
}

module.exports = { MemoryBackend };
