/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const async = require('async');
const _ = require('lodash');
const WebSocket = require('ws');
const debug = require('debug')('ws');
const engineUtil = require('artillery/core/lib/engine_util');
const template = engineUtil.template;

function GraphQLEngine(script) {
  this.config = script.config;
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
      whileTrue: self.config.processor
        ? self.config.processor[requestSpec.whileTrue]
        : undefined,
    });
  }

  if (requestSpec.think) {
    return engineUtil.createThink(
      requestSpec,
      _.get(self.config, 'defaults.think', {})
    );
  }

  if (requestSpec.function) {
    return function (context, callback) {
      let processFunc = self.config.processor[requestSpec.function];
      if (processFunc) {
        processFunc(context, ee, function () {
          return callback(null, context);
        });
      }
    };
  }

  let f = function (context, callback) {
    ee.emit('counter', 'engine.websocket.messages_sent', 1);
    ee.emit('rate', 'engine.websocket.send_rate');
    let startedAt = process.hrtime();

    let payload = template(requestSpec.send, context);
    if (typeof payload === 'object') {
      payload = JSON.stringify(payload);
    } else {
      payload = payload.toString();
    }

    debug('WS send: %s', payload);

    context.ws.send(payload, function (err) {
      if (err) {
        debug(err);
        ee.emit('error', err);
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

      let subprotocols = _.get(config, 'ws.subprotocols', []);
      const headers = _.get(config, 'ws.headers', {});
      const subprotocolHeader = _.find(headers, (value, headerName) => {
        return headerName.toLowerCase() === 'sec-websocket-protocol';
      });
      if (typeof subprotocolHeader !== 'undefined') {
        // NOTE: subprotocols defined via config.ws.subprotocols take precedence:
        subprotocols = subprotocols.concat(
          subprotocolHeader.split(',').map((s) => s.trim())
        );
      }

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
