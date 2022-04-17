/* eslint valid-jsdoc: "off" */

'use strict';

/**
 * @param {Egg.EggAppInfo} appInfo app info
 */
module.exports = appInfo => {
    /**
     * built-in config
     * @type {Egg.EggAppConfig}
     **/
    const config = exports = {};

    // use for cookie sign key, should change to your own and keep security
    config.keys = appInfo.name + '_1650174072352_6499';

    // add your middleware config here
    config.middleware = [];

    // add your user config here
    const userConfig = {
        // myAppName: 'egg',
    };

    config.mongoose = {
        client: {
            url: 'mongodb://127.0.0.1/test',
            options: {}
        },
    };

    config.redis = {
        client: {
          port: 6379,         
          host: '127.0.0.1',
          password: '123456',
          db: 0,
        },
      }

    return {
        ...config,
        ...userConfig,
    };
};
