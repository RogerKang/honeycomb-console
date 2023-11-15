'use strict';
module.exports = {
  env: 'dev',
  debug: true,
  dumpConfig: true,
  logs: {
    sys: {
      level: 'DEBUG'
    },
    oplog: {
      level: 'INFO'
    }
  },
  envName: '本地环境',
  meta: {

    driver: 'mysql', // mysql or sql.js, default sql.js
    host: '127.0.0.1',
    user: 'root',
    password: 'root',
    database: 'honeycomb-console'

  },
  port: 9000,
  middleware: {
    appAuth: {
      enable: true
    },
  },
  extension: {
    redirect: {
      config: {
        allowDomains: []
      }
    },
    oplog: {
      enable: true
    }
  }
};
