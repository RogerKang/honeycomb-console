const config = require('../config');
const meta = config.meta;

switch (meta.driver) {
  case 'mysql':
    module.exports = require('./mysql');
    break;
  case 'sqlite':
    module.exports = require('./sqlite');
    break;
  case 'sql.js':
    module.exports = require('./sql.js');
    break;
  default:
    throw new Error('unknow driver, meta config error');
}
