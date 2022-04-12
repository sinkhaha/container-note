'use strict';

const Koa = require('koa');
const Router = require('koa-router');
const { getRedisClient } = require('./redis');

const { getServerInfo } = require('./util');
const app = new Koa();
const router = new Router;

let log4js = require('log4js');
log4js.configure('./log4js.json');
log4js.level = 'DEBUG';
let logger = log4js.getLogger('app');

// 默认docker启动
let isDocker = true;
const runParams = process.argv[2];
if (runParams === 'notDocker') {
	isDocker = false;
}
const redisClient = getRedisClient(isDocker);

router.get('/', async ctx => {
	const serverInfo =  getServerInfo();
	logger.info(ctx.path, serverInfo);
	ctx.body = serverInfo;
});

router.get('/redis', async ctx => {
	let value = await redisClient.get('name');
    if (!value) {
		await redisClient.set('name', 'hello-world', { EX: 300 }); // 5分钟过期时间
		value = await redisClient.get('name');
	}
	logger.info(ctx.path, value);
	ctx.body = value;
});

app.use(router.routes());

let port = 8080;
app.listen(port, () => {
	logger.info('listening ' + port);
});

