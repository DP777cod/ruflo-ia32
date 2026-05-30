'use strict';

/**
 * Task — priority-aware task entity
 */

const PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 };

class Task {
  constructor(cfg) {
    this.id           = cfg.id || ('task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
    this.type         = cfg.type || 'generic';
    this.priority     = cfg.priority || 'medium';
    this.payload      = cfg.payload || {};
    this.dependencies = cfg.dependencies || [];
    this.createdAt    = Date.now();
  }

  priorityValue() {
    return PRIORITY[this.priority] !== undefined ? PRIORITY[this.priority] : 2;
  }

  static sortByPriority(tasks) {
    return tasks.slice().sort(function(a, b) {
      return a.priorityValue() - b.priorityValue();
    });
  }

  /**
   * Topological sort — respects dependencies
   */
  static resolveExecutionOrder(tasks) {
    var byId = {};
    tasks.forEach(function(t) { byId[t.id] = t; });
    var visited = {};
    var order   = [];

    function visit(t) {
      if (visited[t.id]) return;
      visited[t.id] = true;
      (t.dependencies || []).forEach(function(depId) {
        if (byId[depId]) visit(byId[depId]);
      });
      order.push(t);
    }

    tasks.forEach(visit);
    return order;
  }
}

module.exports = { Task };
