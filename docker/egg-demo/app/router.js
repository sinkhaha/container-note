'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
    const { router, controller } = app;
    router.get('/', controller.home.index);

    router.get('/mongodb', controller.home.mongoTest);

    router.get('/redis', controller.home.redisTest);
};
