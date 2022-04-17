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

    config.keys = appInfo.name + '_1650174072352_6499';

    config.middleware = [];

    const userConfig = {
    };

    config.mongoose = {
        client: {
            url: 'mongodb://admin:123456@mongo/admin', // mongo为容器network别名
            options: {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            }
        },
    };

    config.redis = {
        client: {
          port: 6379,         
          host: 'redis', // redis为容器network别名
          password: '',
          db: 0,
        },
      }

    return {
        ...config,
        ...userConfig,
    };
};
