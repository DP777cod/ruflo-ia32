#!/usr/bin/env node
'use strict';

/**
 * ruflo-ia32 CLI
 * Usage: node bin/ruflo.js [command] [args]
 *
 * Commands:
 *   init                    — create .ruflo/ config
 *   start                   — start swarm REPL
 *   agent spawn <type>      — spawn agent
 *   agent list              — list agents
 *   task run <type> [payload]
 *   swarm state
 *   peer listen [port]      — start federation server
 *   peer connect <host> <port>
 *   help
 */

var path  = require('path');
var fs    = require('fs');
var readline = require('readline');

var lib   = require('../src/index');

// ── state ──────────────────────────────────────────────────────────────────

var memory = new lib.MemoryBackend({ persist: true });
var swarm  = new lib.SwarmCoordinator({ topology: 'hierarchical', memoryBackend: memory });
var peer   = null;

// ── CLI arg parsing ────────────────────────────────────────────────────────

var args = process.argv.slice(2);

if (args.length === 0) {
  startRepl();
} else {
  runCommand(args).then(function() { process.exit(0); }).catch(function(e) {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

// ── command dispatcher ─────────────────────────────────────────────────────

async function runCommand(parts) {
  var cmd = parts[0];

  if (cmd === 'init') return cmdInit();
  if (cmd === 'start') return startRepl();
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return cmdHelp();
  if (cmd === '--version' || cmd === 'version') { console.log('ruflo-ia32 v1.0.0'); return; }

  if (cmd === 'agent') {
    var sub = parts[1];
    if (sub === 'spawn') return cmdAgentSpawn(parts[2]);
    if (sub === 'list')  return cmdAgentList();
    if (sub === 'kill')  return cmdAgentKill(parts[2]);
  }

  if (cmd === 'task') {
    if (parts[1] === 'run') return cmdTaskRun(parts[2], parts[3]);
  }

  if (cmd === 'swarm') {
    if (parts[1] === 'state') return cmdSwarmState();
    if (parts[1] === 'scale') return cmdSwarmScale(parts[2], parseInt(parts[3], 10));
  }

  if (cmd === 'peer') {
    if (parts[1] === 'listen')  return cmdPeerListen(parseInt(parts[2], 10) || 7700);
    if (parts[1] === 'connect') return cmdPeerConnect(parts[2], parseInt(parts[3], 10));
  }

  if (cmd === 'memory') {
    if (parts[1] === 'list')  return cmdMemoryList();
    if (parts[1] === 'clear') return cmdMemoryClear();
  }

  console.log('Unknown command: ' + cmd + '. Run "ruflo help".');
}

// ── commands ───────────────────────────────────────────────────────────────

async function cmdInit() {
  var dir = path.join(process.cwd(), '.ruflo');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  var cfg = { topology: 'hierarchical', version: '1.0.0', created: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
  console.log('✓ Initialized .ruflo/ in ' + process.cwd());
  await swarm.initialize();
  // Spawn default coordinator
  await swarm.spawnAgent({ id: 'queen-0', type: 'coordinator', role: 'leader' });
  console.log('✓ Queen agent spawned (queen-0)');
}

async function cmdAgentSpawn(type) {
  type = type || 'coder';
  await swarm.initialize();
  var agent = await swarm.spawnAgent({ type: type });
  console.log('✓ Spawned ' + type + ' agent: ' + agent.id);
}

async function cmdAgentList() {
  await swarm.initialize();
  var agents = await swarm.listAgents();
  if (!agents.length) { console.log('No agents running.'); return; }
  console.log('\nAgents (' + agents.length + '):');
  agents.forEach(function(a) {
    var j = a.toJSON ? a.toJSON() : a;
    console.log('  ' + j.id + '  type=' + j.type + '  role=' + j.role + '  status=' + j.status);
  });
}

async function cmdAgentKill(id) {
  if (!id) { console.log('Usage: agent kill <id>'); return; }
  await swarm.terminateAgent(id);
  console.log('✓ Terminated ' + id);
}

async function cmdTaskRun(type, payloadStr) {
  type = type || 'code';
  var payload = {};
  if (payloadStr) { try { payload = JSON.parse(payloadStr); } catch (_) { payload = { input: payloadStr }; } }

  await swarm.initialize();
  var agents = await swarm.listAgents();
  if (!agents.length) {
    console.log('No agents. Run: ruflo agent spawn ' + type);
    return;
  }

  var task       = new lib.Task({ type: type, payload: payload, priority: 'high' });
  var assignments = await swarm.distributeTasks([task]);
  if (!assignments.length) {
    console.log('No suitable agent for task type: ' + type);
    return;
  }

  var result = await swarm.executeTask(assignments[0].agentId, task);
  console.log('Task result:', JSON.stringify(result, null, 2));
}

async function cmdSwarmState() {
  await swarm.initialize();
  var state = await swarm.getSwarmState();
  console.log('\nSwarm state:');
  console.log('  topology:    ' + state.topology);
  console.log('  leader:      ' + (state.leader || 'none'));
  console.log('  agents:      ' + state.agents.length);
  console.log('  connections: ' + state.activeConnections);
  if (state.agents.length) {
    console.log('\n  Agents:');
    state.agents.forEach(function(a) {
      console.log('    ' + a.id + '  [' + a.type + '/' + a.role + ']  ' + a.status);
    });
  }
}

async function cmdSwarmScale(type, count) {
  if (!type || !count) { console.log('Usage: swarm scale <type> <count>'); return; }
  await swarm.initialize();
  await swarm.scaleAgents({ type: type, count: count });
  var agents = (await swarm.listAgents()).filter(function(a) { return a.type === type; });
  console.log('✓ ' + type + ' agents: ' + agents.length);
}

async function cmdPeerListen(port) {
  peer = new lib.FederationPeer({
    port: port,
    onDispatch: function(sender, msg) {
      console.log('\n[Federation] from ' + sender + ':', JSON.stringify(msg));
    },
    onLog: function(level, text) { console.log('[' + level.toUpperCase() + '] ' + text); },
  });
  peer.listen();
}

async function cmdPeerConnect(host, port) {
  if (!host || !port) { console.log('Usage: peer connect <host> <port>'); return; }
  peer = new lib.FederationPeer({
    remoteHost: host,
    remotePort: port,
    onDispatch: function(sender, msg) {
      console.log('\n[Federation] from ' + sender + ':', JSON.stringify(msg));
    },
    onLog: function(level, text) { console.log('[' + level.toUpperCase() + '] ' + text); },
  });
  peer.connect();
}

async function cmdMemoryList() {
  var entries = await memory.search({ limit: 20 });
  if (!entries.length) { console.log('Memory empty.'); return; }
  console.log('\nMemory (' + memory.size() + ' entries, showing last 20):');
  entries.forEach(function(e) {
    console.log('  [' + e.type + '] ' + e.id + ' — ' + e.content.slice(0, 60));
  });
}

async function cmdMemoryClear() {
  await memory.clear();
  console.log('✓ Memory cleared.');
}

function cmdHelp() {
  console.log([
    '',
    'ruflo-ia32 — Multi-agent swarm for Node 14 ia32 (iSH)',
    '',
    'Commands:',
    '  init                      Initialize project',
    '  agent spawn [type]         Spawn agent (coder/tester/reviewer/security/coordinator)',
    '  agent list                 List agents',
    '  agent kill <id>            Terminate agent',
    '  task run <type> [payload]  Run a task',
    '  swarm state               Show swarm status',
    '  swarm scale <type> <n>    Scale agents',
    '  peer listen [port]        Start federation server (default: 7700)',
    '  peer connect <host> <port> Connect to remote peer',
    '  memory list               Show stored memories',
    '  memory clear              Clear memory',
    '  version                   Show version',
    '',
    'Interactive REPL: run with no arguments',
    '',
  ].join('\n'));
}

// ── REPL ───────────────────────────────────────────────────────────────────

function startRepl() {
  console.log('\n🌊 ruflo-ia32 v1.0.0  (Node ' + process.version + ' ia32-compatible)');
  console.log('Type "help" for commands, Ctrl+C to exit.\n');

  swarm.initialize().then(function() {
    var rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
      prompt: 'ruflo> ',
    });

    rl.prompt();
    rl.on('line', function(line) {
      var parts = line.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) { rl.prompt(); return; }
      runCommand(parts)
        .then(function() { rl.prompt(); })
        .catch(function(e) { console.error('Error:', e.message); rl.prompt(); });
    });
    rl.on('close', function() { console.log('\nBye.'); process.exit(0); });
  });
}
