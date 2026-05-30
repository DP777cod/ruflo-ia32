'use strict';

/**
 * SwarmCoordinator
 * Port of ruflo/v3/src/coordination/application/SwarmCoordinator.ts
 * Pure CommonJS — Node 14 ia32 compatible, zero native deps
 */

var EventEmitter = require('events').EventEmitter;
var Agent        = require('./agent').Agent;
var Task         = require('./task').Task;

/**
 * @param {object} options
 * @param {string}  options.topology       'hierarchical' | 'mesh' | 'pipeline'
 * @param {object}  [options.memoryBackend] MemoryBackend instance
 * @param {EventEmitter} [options.eventBus]
 */
function SwarmCoordinator(options) {
  EventEmitter.call(this);
  options = options || {};

  this.topology      = options.topology || 'hierarchical';
  this.memoryBackend = options.memoryBackend || null;
  this.eventBus      = options.eventBus || new EventEmitter();
  this._agents       = {};   // id → Agent
  this._metrics      = {};   // id → metrics object
  this._connections  = [];
  this._initialized  = false;
}

SwarmCoordinator.prototype = Object.create(EventEmitter.prototype);
SwarmCoordinator.prototype.constructor = SwarmCoordinator;

// ── lifecycle ──────────────────────────────────────────────────────────────

SwarmCoordinator.prototype.initialize = async function() {
  if (this._initialized) return;
  this._initialized = true;
  this.eventBus.emit('swarm:initialized');
};

SwarmCoordinator.prototype.shutdown = async function() {
  var self = this;
  Object.values(self._agents).forEach(function(a) { a.terminate(); });
  self._agents      = {};
  self._connections = [];
  self._metrics     = {};
  self._initialized = false;
  self.eventBus.emit('swarm:shutdown');
};

// ── agents ────────────────────────────────────────────────────────────────

SwarmCoordinator.prototype.spawnAgent = async function(config) {
  var agent = new Agent(config);
  this._agents[agent.id] = agent;

  this._metrics[agent.id] = {
    agentId:              agent.id,
    tasksCompleted:       0,
    tasksFailed:          0,
    averageExecutionTime: 0,
    successRate:          1.0,
    health:               'healthy',
  };

  this._updateConnections(agent);
  this.eventBus.emit('agent:spawned', { agentId: agent.id, type: agent.type });

  if (this.memoryBackend) {
    await this.memoryBackend.store({
      id:        'agent-spawn-' + agent.id,
      agentId:   'system',
      content:   'Agent ' + agent.id + ' spawned',
      type:      'event',
      timestamp: Date.now(),
      metadata:  { eventType: 'agent-spawn', agentId: agent.id, agentType: agent.type },
    });
  }

  return agent;
};

SwarmCoordinator.prototype.listAgents = async function() {
  return Object.values(this._agents);
};

SwarmCoordinator.prototype.terminateAgent = async function(agentId) {
  var agent = this._agents[agentId];
  if (!agent) return;
  agent.terminate();
  delete this._agents[agentId];
  delete this._metrics[agentId];
  this._connections = this._connections.filter(function(c) {
    return c.from !== agentId && c.to !== agentId;
  });
  this.eventBus.emit('agent:terminated', { agentId: agentId });
};

// ── task execution ────────────────────────────────────────────────────────

SwarmCoordinator.prototype.distributeTasks = async function(tasks) {
  var self        = this;
  var assignments = [];
  var loads       = {};

  Object.keys(self._agents).forEach(function(id) { loads[id] = 0; });

  var sorted = Task.sortByPriority(tasks.map(function(t) { return new Task(t); }));

  sorted.forEach(function(task) {
    var suitable = Object.values(self._agents).filter(function(a) {
      return a.status === 'active' && a.canExecute(task.type);
    });
    if (!suitable.length) return;

    var best      = suitable[0];
    var lowestLoad = loads[best.id] || 0;
    suitable.forEach(function(a) {
      if ((loads[a.id] || 0) < lowestLoad) {
        lowestLoad = loads[a.id] || 0;
        best       = a;
      }
    });

    assignments.push({
      taskId:     task.id,
      agentId:    best.id,
      assignedAt: Date.now(),
      priority:   task.priority,
    });
    loads[best.id] = (loads[best.id] || 0) + 1;
  });

  return assignments;
};

SwarmCoordinator.prototype.executeTask = async function(agentId, task) {
  var self  = this;
  var agent = self._agents[agentId];
  if (!agent) {
    return { taskId: task.id, status: 'failed', error: 'Agent ' + agentId + ' not found', agentId: agentId };
  }

  var start  = Date.now();
  var result;
  try {
    result = await agent.executeTask(task);
  } catch (err) {
    result = {
      taskId:  task.id,
      status:  'failed',
      error:   err && err.message ? err.message : String(err),
      agentId: agentId,
    };
  }
  var duration = Date.now() - start;

  var m = self._metrics[agentId];
  if (m) {
    if (result.status === 'completed') { m.tasksCompleted++; }
    else { m.tasksFailed = (m.tasksFailed || 0) + 1; }
    var total = m.tasksCompleted + (m.tasksFailed || 0);
    m.successRate          = m.tasksCompleted / total;
    m.averageExecutionTime = (m.averageExecutionTime * (total - 1) + duration) / total;
  }

  if (self.memoryBackend) {
    await self.memoryBackend.store({
      id:        'task-result-' + task.id,
      agentId:   agentId,
      content:   'Task ' + task.id + ' ' + result.status,
      type:      result.status === 'completed' ? 'task-complete' : 'event',
      timestamp: Date.now(),
      metadata:  { taskId: task.id, status: result.status, duration: duration, error: result.error },
    });
  }

  return result;
};

SwarmCoordinator.prototype.executeTasksConcurrently = async function(tasks) {
  var self        = this;
  var assignments = await self.distributeTasks(tasks);
  return Promise.all(assignments.map(function(a) {
    var task = tasks.find(function(t) { return t.id === a.taskId; });
    if (!task) return Promise.resolve({ taskId: a.taskId, status: 'failed', error: 'Task not found' });
    return self.executeTask(a.agentId, task);
  }));
};

// ── state / info ──────────────────────────────────────────────────────────

SwarmCoordinator.prototype.getSwarmState = async function() {
  var leader = this._getLeader();
  return {
    agents:            Object.values(this._agents).map(function(a) { return a.toJSON(); }),
    topology:          this.topology,
    leader:            leader ? leader.id : null,
    activeConnections: this._connections.length,
  };
};

SwarmCoordinator.prototype.getAgentMetrics = async function(agentId) {
  return this._metrics[agentId] || {
    agentId:              agentId,
    tasksCompleted:       0,
    averageExecutionTime: 0,
    successRate:          0,
    health:               'unhealthy',
  };
};

SwarmCoordinator.prototype.scaleAgents = async function(config) {
  var self    = this;
  var existing = Object.values(self._agents).filter(function(a) { return a.type === config.type; });
  var current  = existing.length;
  var target   = Math.max(0, Math.floor(config.count));

  if (target > current) {
    for (var i = current; i < target; i++) {
      await self.spawnAgent({ id: config.type + '-' + Date.now() + '-' + i, type: config.type });
    }
  } else if (target < current) {
    var toRemove = existing.slice(0, current - target);
    for (var j = 0; j < toRemove.length; j++) {
      await self.terminateAgent(toRemove[j].id);
    }
  }
};

SwarmCoordinator.prototype.sendMessage = async function(msg) {
  this.eventBus.emit('agent:message', Object.assign({}, msg, { timestamp: Date.now() }));
};

SwarmCoordinator.prototype.reachConsensus = async function(decision, agentIds) {
  var votes = agentIds.map(function(id) {
    return { agentId: id, vote: Math.random() > 0.5 ? 'approve' : 'reject' };
  });
  var approves       = votes.filter(function(v) { return v.vote === 'approve'; }).length;
  var consensusReached = approves > votes.length / 2;
  return { decision: consensusReached ? decision.payload : null, votes: votes, consensusReached: consensusReached };
};

SwarmCoordinator.prototype.resolveTaskDependencies = async function(tasks) {
  return Task.resolveExecutionOrder(tasks.map(function(t) { return new Task(t); }));
};

SwarmCoordinator.prototype.reconfigure = async function(config) {
  var self = this;
  self.topology    = config.topology;
  self._connections = [];
  Object.values(self._agents).forEach(function(a) { self._updateConnections(a); });
};

// ── private ───────────────────────────────────────────────────────────────

SwarmCoordinator.prototype._getLeader = function() {
  return Object.values(this._agents).find(function(a) { return a.role === 'leader'; }) || null;
};

SwarmCoordinator.prototype._updateConnections = function(agent) {
  var self = this;
  if (self.topology === 'mesh') {
    Object.values(self._agents).forEach(function(other) {
      if (other.id !== agent.id) {
        self._connections.push({ from: agent.id, to: other.id, type: 'peer' });
      }
    });
  } else if (self.topology === 'hierarchical') {
    var leader = self._getLeader();
    if (leader && agent.role !== 'leader') {
      self._connections.push({ from: agent.id, to: leader.id, type: 'leader' });
    }
  }
};

module.exports = { SwarmCoordinator: SwarmCoordinator };
