'use strict';

/**
 * ruflo-ia32 — main public API
 */

var Agent          = require('./agent').Agent;
var Task           = require('./task').Task;
var MemoryBackend  = require('./memory').MemoryBackend;
var SwarmCoordinator = require('./swarm').SwarmCoordinator;
var FederationPeer = require('./federation').FederationPeer;

module.exports = {
  Agent:            Agent,
  Task:             Task,
  MemoryBackend:    MemoryBackend,
  SwarmCoordinator: SwarmCoordinator,
  FederationPeer:   FederationPeer,
};
