'use strict';

/**
 * Agent — single agent entity
 * Pure JS, no native binaries, Node 14+ ia32 compatible
 */

const { EventEmitter } = require('events');

const CAPABILITIES_MAP = {
  coder:       ['code', 'refactor', 'debug'],
  tester:      ['test', 'validate', 'e2e'],
  reviewer:    ['review', 'analyze', 'security-audit'],
  coordinator: ['coordinate', 'manage', 'orchestrate'],
  security:    ['security-audit', 'cve-scan', 'pentest'],
  researcher:  ['research', 'summarize', 'analyze'],
};

class Agent extends EventEmitter {
  constructor(config) {
    super();
    this.id           = config.id || ('agent-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    this.type         = config.type || 'generic';
    this.role         = config.role || 'worker';
    this.parent       = config.parent || null;
    this.capabilities = config.capabilities || CAPABILITIES_MAP[config.type] || [];
    this.status       = 'active';
    this.createdAt    = Date.now();
    this._taskCount   = 0;
  }

  canExecute(taskType) {
    return this.capabilities.includes(taskType) || this.capabilities.includes('*');
  }

  async executeTask(task) {
    if (this.status !== 'active') {
      return { taskId: task.id, status: 'failed', error: 'Agent not active', agentId: this.id };
    }
    // Simulate execution — in production this calls Claude API
    await _sleep(10);
    this._taskCount++;
    return { taskId: task.id, status: 'completed', output: null, agentId: this.id };
  }

  terminate() {
    this.status = 'terminated';
    this.emit('terminated', { agentId: this.id });
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      role: this.role,
      status: this.status,
      capabilities: this.capabilities,
      taskCount: this._taskCount,
    };
  }
}

function _sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

module.exports = { Agent, CAPABILITIES_MAP };
