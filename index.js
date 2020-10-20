/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const async = require('async');
const _ = require('lodash');
const WebSocket = require('ws');
const debug = require('debug')('engine:ws');
const engineUtil = require('artillery/core/lib/engine_util');
const template = engineUtil.template;

function GraphQLEngine(script, ee, helpers) {
  this.script = script;
  this.ee = ee;
  this.helpers = helpers;
  console.log(script);
  console.log(ee);
  console.log(helpers);
  return this;
}

GraphQLEngine.prototype.createScenario = function (scenarioSpec, ee) {
  var self = this;
  let tasks = _.map(scenarioSpec.flow, function (rs) {
    if (rs.think) {
      return engineUtil.createThink(
        rs,
        _.get(self.config, 'defaults.think', {})
      );
    }
    return self.step(rs, ee);
  });

  console.log(tasks);

  return self.compile(tasks, scenarioSpec.flow, ee);
};

GraphQLEngine.prototype.step = function (requestSpec, ee) {
  let self = this;

  if (requestSpec.loop) {
    let steps = _.map(requestSpec.loop, function (rs) {
      return self.step(rs, ee);
    });

    return engineUtil.createLoopWithCount(requestSpec.count || -1, steps, {
      loopValue: requestSpec.loopValue || '$loopCount',
      overValues: requestSpec.over,
    });
  }

  if (requestSpec.think) {
    return engineUtil.createThink(
      requestSpec,
      _.get(self.config, 'defaults.think', {})
    );
  }

  let f = function (context, callback) {
    ee.emit('request');
    let startedAt = process.hrtime();

    if (requestSpec.function) {
      let processFunc = self.config.processor[requestSpec.function];
      if (processFunc) {
        processFunc(context, ee, function () {
          return callback(null, context);
        });
      }
    }

    let payload = template(requestSpec.send, context);
    if (typeof payload === 'object') {
      payload = JSON.stringify(payload);
    } else {
      payload = payload.toString();
    }
    console.log('WS send: %s', payload);
    debug('WS send: %s', payload);

    context.ws.send(payload, function (err) {
      if (err) {
        console.log(err);
        debug(err);
        ee.emit('error', err);
      } else {
        let endedAt = process.hrtime(startedAt);
        let delta = endedAt[0] * 1e9 + endedAt[1];
        ee.emit('response', delta, 0, context._uid);
      }
      return callback(err, context);
    });
  };

  return f;
};

GraphQLEngine.prototype.compile = function (tasks, scenarioSpec, ee) {
  let config = this.config;

  return function scenario(initialContext, callback) {
    function zero(callback) {
      let tls = config.tls || {}; // TODO: config.tls is deprecated
      let options = _.extend(tls, config.ws);

      ee.emit('started');

      let ws = new WebSocket(config.target, 'graphql-ws');

      ws.on('open', function () {
        const message = {
          type: 'connection_init',
          payload: { portalId: 22, culture: 'de-CH' },
        };
        const result = ws.send(JSON.stringify(message), function (err) {
          if (err) {
            console.error(err);
          }
        });
        initialContext.ws = ws;
        return callback(null, initialContext);
      });
      //  ws.on('message', function(msg) {
      //    console.log('RECEIVED MSG!', msg)
      //  })
      ws.once('error', function (err) {
        debug(err);
        console.log(err);
        ee.emit('error', err.code);
        return callback(err, {});
      });
    }

    initialContext._successCount = 0;
    initialContext._pendingRequests = _.size(
      _.reject(scenarioSpec, function (rs) {
        return typeof rs.think === 'number';
      })
    );

    let steps = _.flatten([zero, tasks]);

    async.waterfall(steps, function scenarioWaterfallCb(err, context) {
      if (err) {
        console.log(err);
        debug(err);
      }

      if (context && context.ws) {
        context.ws.close();
      }

      return callback(err, context);
    });
  };
};

module.exports = GraphQLEngine;
