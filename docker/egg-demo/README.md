# 项目技术栈
Egg.js + redis + mongoose

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

# 发布到docker hub
docker login -u <用户名>

# 标记本地egg-demo:v1镜像，将其标记为sinkhaha/egg-demo:v1镜像  sinkhaha为用户名
docker tag egg-demo:v1 sinkhaha/egg-demo:v1

# 推送sinkhaha/egg-demo:v1镜像到docker hub
docker push sinkhaha/egg-demo:v1

docker run -dp 8080:7001 sinkhaha/egg-demo:v1
```

# docker compose