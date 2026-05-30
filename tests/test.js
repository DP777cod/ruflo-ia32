'use strict';
var lib = require('../src/index');
var passed = 0; var failed = 0;

async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch(e) { console.log('  ✗ ' + name + ': ' + e.message); failed++; }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

(async function() {
  console.log('\nruflo-ia32 test suite\n');

  // Agent
  await test('Agent spawns with defaults', async function() {
    var a = new lib.Agent({ type: 'coder' });
    assert(a.id, 'has id');
    assert(a.status === 'active');
    assert(a.canExecute('code'));
  });

  await test('Agent executes task', async function() {
    var a = new lib.Agent({ type: 'coder' });
    var r = await a.executeTask({ id: 't1', type: 'code' });
    assert(r.status === 'completed');
    assert(r.taskId === 't1');
  });

  await test('Agent terminates', async function() {
    var a = new lib.Agent({ type: 'coder' });
    a.terminate();
    assert(a.status === 'terminated');
    var r = await a.executeTask({ id: 't2', type: 'code' });
    assert(r.status === 'failed');
  });

  // Task
  await test('Task sorts by priority', async function() {
    var tasks = [
      new lib.Task({ id: '1', priority: 'low' }),
      new lib.Task({ id: '2', priority: 'critical' }),
      new lib.Task({ id: '3', priority: 'medium' }),
    ];
    var sorted = lib.Task.sortByPriority(tasks);
    assert(sorted[0].priority === 'critical');
    assert(sorted[2].priority === 'low');
  });

  await test('Task resolves dependencies', async function() {
    var tasks = [
      new lib.Task({ id: 'b', dependencies: ['a'] }),
      new lib.Task({ id: 'a', dependencies: [] }),
    ];
    var ordered = lib.Task.resolveExecutionOrder(tasks);
    assert(ordered[0].id === 'a');
    assert(ordered[1].id === 'b');
  });

  // Memory
  await test('MemoryBackend stores and retrieves', async function() {
    var m = new lib.MemoryBackend();
    await m.store({ id: 'e1', agentId: 'a1', content: 'hello', type: 'event', timestamp: Date.now() });
    var e = await m.retrieve('e1');
    assert(e && e.content === 'hello');
  });

  await test('MemoryBackend searches by type', async function() {
    var m = new lib.MemoryBackend();
    await m.store({ id: 'e2', agentId: 'a1', content: 'task done', type: 'task-complete', timestamp: Date.now() });
    await m.store({ id: 'e3', agentId: 'a1', content: 'event',     type: 'event',         timestamp: Date.now() });
    var results = await m.search({ type: 'task-complete' });
    assert(results.length === 1 && results[0].id === 'e2');
  });

  // SwarmCoordinator
  await test('SwarmCoordinator spawns and lists agents', async function() {
    var s = new lib.SwarmCoordinator({ topology: 'hierarchical' });
    await s.initialize();
    await s.spawnAgent({ type: 'coder' });
    await s.spawnAgent({ type: 'tester' });
    var agents = await s.listAgents();
    assert(agents.length === 2);
    await s.shutdown();
  });

  await test('SwarmCoordinator distributes and executes tasks', async function() {
    var s = new lib.SwarmCoordinator({ topology: 'hierarchical' });
    await s.initialize();
    await s.spawnAgent({ type: 'coder' });
    var results = await s.executeTasksConcurrently([
      { id: 'tx1', type: 'code', priority: 'high' },
    ]);
    assert(results.length === 1);
    assert(results[0].status === 'completed');
    await s.shutdown();
  });

  await test('SwarmCoordinator scales agents', async function() {
    var s = new lib.SwarmCoordinator({ topology: 'mesh' });
    await s.initialize();
    await s.scaleAgents({ type: 'coder', count: 3 });
    var agents = await s.listAgents();
    assert(agents.filter(function(a) { return a.type === 'coder'; }).length === 3);
    await s.scaleAgents({ type: 'coder', count: 1 });
    var agents2 = await s.listAgents();
    assert(agents2.filter(function(a) { return a.type === 'coder'; }).length === 1);
    await s.shutdown();
  });

  // Federation safety gate
  await test('FederationPeer gate blocks API keys', async function() {
    var inspect = require('../src/federation').inspectMessage;
    var msg = { id: 'f1', kind: 'task', payload: { text: 'api_key: sk-abc123456789012345678901234567890' } };
    var v = inspect(msg);
    assert(v.verdict === 'block', 'should block');
  });

  await test('FederationPeer gate redacts IPs', async function() {
    var inspect = require('../src/federation').inspectMessage;
    var msg = { id: 'f2', kind: 'task', payload: { text: 'host is 192.168.1.100' } };
    var v = inspect(msg);
    assert(v.verdict === 'redact', 'should redact');
  });

  await test('FederationPeer gate passes clean messages', async function() {
    var inspect = require('../src/federation').inspectMessage;
    var msg = { id: 'f3', kind: 'task', payload: { text: 'deploy the frontend' } };
    var v = inspect(msg);
    assert(v.verdict === 'pass', 'should pass');
  });

  // Summary
  console.log('\n' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed > 0 ? 1 : 0);
})();
