const _ = require('lodash');
const util = require('util');
const moment = require('moment');

const db = require('../common/db');

const OpLog = {};
const noop = (err) => err && console.log(err);

OpLog.add = (msg, callback = noop) => {
  const keys = Object.keys(msg).map(key => _.snakeCase(key));

  const values = Object.values(msg).map(v => typeof v === 'object' ?
    JSON.stringify(v) : v);

  const INSERT_OPLOG = util.format(`
  INSERT INTO
    hc_console_system_oplog (%s)
  VALUES
    (
      %s
    )`,
  keys.join(','),
  values.map(() => '?').join(',')
  );

  db.query(INSERT_OPLOG, values, callback);
};

/**
 * 获取一定时间范围的操作日志
 */
const GET_OPLOG = `
  SELECT 
    *
  FROM hc_console_system_oplog
  WHERE cluster_code = ? and gmt_create >= ? and gmt_create <= ? 
  ORDER BY gmt_create desc
`;

OpLog.getOpLog = (clusterCode, startTime, endTime, callback) => {
  console.log(startTime, endTime);

  db.query(
    GET_OPLOG,
    [
      clusterCode,
      moment(startTime).startOf('day').format('YYYY-MM-DD HH:mm:ss'),
      moment(endTime).endOf('day').format('YYYY-MM-DD HH:mm:ss')
    ],
    function (err, data) {
      if (err) {
        console.log(err);

        return callback(err);
      } else {
        callback(null, data.map(log => {
          log.detail && (log.detail = JSON.parse(log.detail));
          log.extends && (log.extends = JSON.parse(log.extends));
          log.socket && (log.socket = JSON.parse(log.socket));


          // eslint-disable-next-line
          for (const [k, v] of Object.entries(log)) {
            const newKey = _.camelCase(k);

            log[newKey] = v;
            k !== newKey && delete log[k];
          }

          return log;
        }));
      }
    }
  );
};

module.exports = OpLog;
