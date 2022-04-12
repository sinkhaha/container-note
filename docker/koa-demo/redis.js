'use strict';

const redis = require('redis');

function getRedisClient(isDocker) {
    // 如果是docker启动时，redis为地址别名
    let redisClient = redis.createClient({url: isDocker ? 'redis://redis:6379' : 'redis://localhost:6379'});
    redisClient.on('connect', () => {
        console.log('redis connect success');
    });
    redisClient.connect();
    return redisClient;
}

module.exports = {
    getRedisClient
};

