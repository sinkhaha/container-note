'use strict';
let os = require('os');
const lodash = require('lodash');

/**
 * 获取本机信息
 */
function getServerInfo() {
	return `IP地址: ${getIpAddress()} \n主机名: ${os.hostname()}`;
}

/**
 * 获取本机的ipv4地址
 * @returns {*|string}
 */
function getIpAddress() {
  return lodash.chain(os.networkInterfaces())
    .values().flattenDeep()
    .filter(alias => (alias.family === 'IPv4' && !alias.address.startsWith('127') && !alias.internal))
    .head()
    .get('address')
    .value();
}

module.exports = {
    getServerInfo,
	getIpAddress
};
