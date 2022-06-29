/* eslint-disable max-lines */
'use strict';
const async = require('async');
const formstream = require('formstream');
const multer = require('multer');
const os = require('os');
const log = require('../common/log');
const utils = require('../common/utils');
const cluster = require('../model/cluster');
const appPackage = require('../model/app_package');

const callremote = utils.callremote;

/**
 * 获取app列表
 * @api {get} /api/app/list
 * @param req
 * @param callback
 */
exports.listApp = function (req, callback) {
  const clusterCode = req.query.clusterCode;
  const opt = cluster.getClusterCfgByCode(clusterCode);

  if (opt.code === 'ERROR') {
    return callback(opt);
  }
  const path = '/api/apps';

  callremote(path, opt, function (err, result) {
    if (err || result.code !== 'SUCCESS') {
      const errMsg = err && err.message || result.message;

      log.error('get apps from servers failed: ', errMsg);
      const code = (err && err.code) || (result && result.code) || 'ERROR';

      return callback({
        code: code,
        message: errMsg
      });
    } else {
      const ips = [];
      let apps = [];

      result.data.success.forEach((item) => {
        ips.push(item.ip);
        apps = apps.concat(item.apps);
      });

      apps = apps.filter((app) => {
        return req.user.containsApp(clusterCode, app.name);
      });

      return callback(null, {
        success: utils.mergeAppInfo(ips, apps),
        error: result.data.error
      });
    }
  });
};


const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fields: 1024,
    fileSize: 1024 * 1024 * 1024
  }
}).single('pkg');

/**
 * 发布一个app当当前集群
 * @api {post} /api/app/publish
 * @query
 *  clusterCode {String} 集群code
 *  recover {Enum} 作用位置 true/false
 * @body
 *  file {File} 文件tgz包
 * @nowrap
 */
exports.publishApp = function (req, res) {
  const clusterCode = req.query.clusterCode;
  const timeout = req.query.timeout;
  const recover = req.query.recover === 'true';

  async.waterfall([
    function receivePkg(cb) {
      upload(req, res, function (err) {
        req.oplog({
          clientId: req.ips.join('') || '-',
          opName: 'PUBLISH_APP',
          opType: 'PAGE_MODEL',
          opLogLevel: 'NORMAL',
          opItem: 'APP',
          opItemId: req.file && req.file.originalname || 'UNKNOW_FILE_NAME'
        });

        if (err) {
          err.code = 'ERROR_UPLOAD_APP_PACKAGE_FAILED';

          return cb(err);
        }
        if (!req.file) {
          const err = new Error('app package empty');

          err.code = 'ERROR_APP_PACKAGE_EMPTY';

          return cb(err);
        }
        /**
         {
            fieldname: 'pkg',
            originalname: 'simple-app.tgz',
            encoding: '7bit',
            mimetype: 'application/gzip',
            destination: '/var/folders/m5/x6j8n4hs7gjf9l8vm6bdms4w0000gn/T',
            filename: 'd417d59db835bf78f9f51605db354920',
            path: '/var/folders/m5/x6j8n4hs7gjf9l8vm6bdms4w0000gn/T/d417d59db835bf78f9f51605db354920',
            size: 729
          }
         */
        cb(null, req.file);
      });
    },
    function savePackage(file, cb) {
      const appId = file.originalname.replace(/.tgz$/, '');
      const appInfo = utils.parseAppId(appId);

      const obj = {
        clusterCode,
        appId: appInfo.id,
        appName: appInfo.name,
        weight: appInfo.weight,
        pkg: file.path,
        user: req.session.username
      };

      if (!recover) {
        appPackage.savePackage(obj, (err) => {
          cb(err, file);
        });
      } else {
        cb(null, file);
      }
    },
    function (file, cb) {
      const opt = cluster.getClusterCfgByCode(clusterCode);

      if (opt.code === 'ERROR') {
        return cb(opt);
      }
      log.info(`publish "${file.originalname}" to server: ${opt.endpoint}`);
      const form = formstream();

      form.file('pkg', file.path, file.originalname);
      const path = '/api/publish';

      opt.method = 'POST';
      opt.headers = form.headers();
      opt.stream = form;
      opt.timeout = timeout || 1000000;
      callremote(path, opt, cb);
    }
  ], function (err, results) {
    if (err || results.code !== 'SUCCESS') {
      const errMsg = err && err.message || results.message;

      log.error('publish app failed:', errMsg);
      log.error(err);
      const code = (err && err.code) || (results && results.code) || 'ERROR';

      return res.json({
        code: code,
        message: errMsg
      });
    } else {
      if (!recover) {
        cluster.saveSnapShot2(clusterCode, (err) => {
          if (err) {
            return res.json({
              code: err.code,
              message: err.message
            });
          } else {
            return res.json({
              code: 'SUCCESS',
              data: results.data
            });
          }
        });
      } else {
        res.json({
          code: 'SUCCESS',
          data: results.data
        });
      }
    }
  });
};

/**
 * 清理某个app的多余的版本
 * @api {POST} /api/app/:appId/clean_exit_record
 * @param req
 * @param callback
 */
exports.cleanAppExitRecord = function (req, callback) {
  let appId = req.params && req.params.appId;

  req.oplog({
    clientId: req.ips.join('') || '-',
    opName: 'CLEAN_APP_EXIT_RECORD',
    opType: 'PAGE_MODEL',
    opLogLevel: 'NORMAL',
    opItem: 'APP',
    opItemId: appId
  });
  const clusterCode = req.body.clusterCode;
  const opt = cluster.getClusterCfgByCode(clusterCode);

  if (opt.code === 'ERROR') {
    return callback(opt);
  }
  if (['__PROXY___0.0.0_0', '__ADMIN___0.0.0_0'].indexOf(appId) >= 0) {
    appId = appId.substring(0, appId.length - 8);
  }
  const path = `/api/clean_exit_record/${appId}`;

  opt.method = 'DELETE';
  callremote(path, opt, function (err, results) {
    if (err || results.code !== 'SUCCESS') {
      const errMsg = err && err.message || results.message;

      log.error(`clean appExitRecord of ${appId} failed: `, errMsg);
      const code = (err && err.code) || (results && results.code) || 'ERROR';

      return callback({
        code: code,
        message: errMsg
      });
    } else {
      log.debug('clean appExitRecord results:', results);

      return callback(null, results.data);
    }
  });
};

/**
 * 删除某一个app
 * @api {post} /api/app/:appId/delete
 * @param req
 * @param callback
 */
exports.deleteApp = function (req, callback) {
  const appId = req.params && req.params.appId;
  const timeout = req.query.timeout;

  req.oplog({
    clientId: req.ips.join('') || '-',
    opName: 'DELETE_APP',
    opType: 'PAGE_MODEL',
    // eslint-disable-next-line
    opLogLevel: 'RISKY', // HIGH_RISK / RISKY / LIMIT / NORMAL http://twiki.corp.taobao.com/bin/view/SRE/Taobao_Security/DataSecPolicy
    opItem: 'APP',
    opItemId: appId
  });
  const clusterCode = req.body.clusterCode;
  const opt = cluster.getClusterCfgByCode(clusterCode);

  if (opt.code === 'ERROR') {
    return callback(opt);
  }
  const path = `/api/delete/${appId}`;

  opt.timeout = timeout || 60000;
  opt.method = 'POST';
  callremote(path, opt, function (err, results) {
    if (err || results.code !== 'SUCCESS') {
      const errMsg = err && err.message || results.message;

      log.error(`delete app ${appId} failed: `, errMsg);
      const code = (err && err.code) || (results && results.code) || 'ERROR';

      return callback({
        code: code,
        message: errMsg
      });
    } else {
      log.debug(`delete app ${appId} results:`, results);
      appPackage.deletePackage(clusterCode, appId, (err) => {
        if (err) {
          log.error('delete apppackage failed', err.message);
        }
      });
      cluster.saveSnapShot2(clusterCode, (err) => {
        if (err) {
          callback(err);
        } else {
          callback(null, results.data);
        }
      });
    }
  });
};

/**
 * 重启某一个app
 * @api {post} /api/app/:appId/restart
 */
exports.restartApp = function (req, callback) {
  const appId = req.params && req.params.appId;

  req.oplog({
    clientId: req.ips.join('') || '-',
    opName: 'RESTART_APP',
    opType: 'PAGE_MODEL',
    opLogLevel: 'LIMIT',
    opItem: 'APP',
    opItemId: appId
  });
  const clusterCode = req.body.clusterCode;
  const opt = cluster.getClusterCfgByCode(clusterCode);

  if (opt.code === 'ERROR') {
    return callback(opt);
  }
  const path = `/api/restart/${appId}`;

  opt.method = 'POST';
  opt.timeout = 30000;
  callremote(path, opt, function (err, results) {
    if (err || results.code !== 'SUCCESS') {
      const errMsg = err && err.message || results.message;

      log.error(`restart app ${appId} failed: `, errMsg);
      const code = (err && err.code) || (results && results.code) || 'ERROR';

      return callback({
        code: code,
        message: errMsg
      });
    } else {
      log.debug(`restart app ${appId} results:`, results);

      return callback(null, results.data);
    }
  });
};

/**
 * 重载某一个app
 * @api {post} /api/app/:appId/reload
 * @param req
 * @param callback
 */
exports.reloadApp = function (req, callback) {
  const appId = req.params && req.params.appId;

  req.oplog({
    clientId: req.ips.join('') || '-',
    opName: 'RELOAD_APP',
    opType: 'PAGE_MODEL',
    opLogLevel: 'LIMIT',
    opItem: 'APP',
    opItemId: appId
  });
  const clusterCode = req.body.clusterCode;
  const opt = cluster.getClusterCfgByCode(clusterCode);

  if (opt.code === 'ERROR') {
    return callback(opt);
  }
  const path = `/api/reload/${appId}`;

  opt.method = 'POST';
  opt.timeout = 60000;
  callremote(path, opt, function (err, results) {
    if (err || results.code !== 'SUCCESS') {
      const errMsg = err && err.message || results.message;

      log.error(`reload app ${appId} failed: `, errMsg);
      const code = (err && err.code) || (results && results.code) || 'ERROR';

      return callback({
        code: code,
        message: errMsg
      });
    } else {
      log.debug(`reload app ${appId} results:`, results);

      return callback(null, results.data);
    }
  });
};

/**
 * 启动一个app
 * @api {post} /api/app/:appId/start
 * @param req
 * @param callback
 */
exports.startApp = function (req, callback) {
  const appId = req.params && req.params.appId;
  const timeout = req.query.timeout;

  req.oplog({
    clientId: req.ips.join('') || '-',
    opName: 'START_APP',
    opType: 'PAGE_MODEL',
    opLogLevel: 'LIMIT',
    opItem: 'APP',
    opItemId: appId
  });
  const clusterCode = req.body.clusterCode;
  const opt = cluster.getClusterCfgByCode(clusterCode);

  if (opt.code === 'ERROR') {
    return callback(opt);
  }
  const path = `/api/start/${appId}`;

  opt.method = 'POST';
  opt.timeout = timeout || 60000;
  callremote(path, opt, function (err, results) {
    if (err || results.code !== 'SUCCESS') {
      const errMsg = err && err.message || results.message;

      log.error(`start app ${appId} failed: `, errMsg);
      const code = (err && err.code) || (results && results.code) || 'ERROR';

      return callback({
        code: code,
        message: errMsg
      });
    } else {
      log.debug(`start app ${appId} results:`, results);
      cluster.saveSnapShot2(clusterCode, (err) => {
        if (err) {
          callback(err);
        } else {
          callback(null, results.data);
        }
      });
    }
  });
};

/**
 * 停止一个app
 * @api {post} /api/app/:appId/stop
 * @param req
 * @param callback
 */
exports.stopApp = function (req, callback) {
  const appId = req.params && req.params.appId;

  req.oplog({
    clientId: req.ips.join('') || '-',
    opName: 'STOP_APP',
    opType: 'PAGE_MODEL',
    opLogLevel: 'RISKY',
    opItem: 'APP',
    opItemId: appId
  });
  const clusterCode = req.body.clusterCode;
  const opt = cluster.getClusterCfgByCode(clusterCode);

  if (opt.code === 'ERROR') {
    return callback(opt);
  }
  const path = `/api/stop/${appId}`;

  opt.method = 'POST';
  opt.timeout = 30000;
  callremote(path, opt, function (err, results) {
    if (err || results.code !== 'SUCCESS') {
      const errMsg = err && err.message || results.message;

      log.error(`stop app ${appId} failed: `, errMsg);
      const code = (err && err.code) || (results && results.code) || 'ERROR';

      return callback({
        code: code,
        message: errMsg
      });
    } else {
      log.debug(`stop app ${appId} results:`, results);
      cluster.saveSnapShot2(clusterCode, (err) => {
        if (err) {
          callback(err);
        } else {
          callback(null, results.data);
        }
      });
    }
  });
};
