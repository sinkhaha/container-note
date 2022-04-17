'use strict';

const Controller = require('egg').Controller;

class HomeController extends Controller {
    /**
     * 
     */
    async index() {
        const { ctx } = this;
        ctx.body = 'hello world';
    }

    /**
     * 
     */
    async mongoTest() {
        const { ctx } = this;
        let result = await ctx.model.User.findOne({ name: 'zhangsan'});
        if (!result) {
            result = await ctx.model.User.create({ name: 'zhangsan', age: 20 });
        }
        ctx.body = result;
    }

    /**
     * 
     */
    async redisTest() {
        const { ctx, app } = this;

        await app.redis.set('name', 'lisi');
        const result = await app.redis.get('name');

        ctx.body = result;
    }
}

module.exports = HomeController;
