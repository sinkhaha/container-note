# 项目技术栈
Egg.js + redis + mongoose


## QuickStart

<!-- add docs here for user -->

see [egg docs][egg] for more detail.

### Development

```bash
$ npm i
$ npm run dev
$ open http://localhost:7001/
```

### Deploy

```bash
$ npm start
$ npm stop
```

### npm scripts

- Use `npm run lint` to check code style.
- Use `npm test` to run unit test.
- Use `npm run autod` to auto detect dependencies upgrade, see [autod](https://www.npmjs.com/package/autod) for more detail.


[egg]: https://eggjs.org

# docker
```bash
docker network create egg-demo-net

docker run -d -p 6379:6379 --name redis --network egg-demo-net --network-alias redis redis:latest

# 共享的 Docker 网络,不需要将 Mongo 端口发布到主机，从而减少攻击面
# --auth需要密码才能访问容器服务
docker run -d -p 27017:27017 --name mongo --network egg-demo-net  --network-alias mongo mongo:4.4.13 --auth

docker exec -it mongo 
mongo admin

# 创建一个名为 admin，密码为 123456 的用户
db.createUser({ user:'admin',pwd:'123456',roles:[ { role:'userAdminAnyDatabase', db: 'admin'},"readWriteAnyDatabase"]});
# 尝试使用上面创建的用户信息进行连接。
> db.auth('admin', '123456')

# 进入项目根目录，构建
docker build -t egg-demo:v1 .

# 启动容器 network
docker run -d --name=egg-demo1 -v ~/egg-demo/logs:/app/logs -p 8080:7001 --network egg-demo-net egg-demo:v1

curl http://localhost:8080

curl http://localhost:8080/redis

curl http://localhost:8080/mongodb
```

# docker compose