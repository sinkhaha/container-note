# 项目介绍

docker部署Egg.js项目



# 项目技术栈

Egg.js + redis + mongoose



# 非docker-compose方式启动

###  创建网络(名为egg-demo-net)

> 用于解决项目容器间通信的问题，如项目容器跟redis容器通信，项目容器跟mongodb容器通信

```bash
docker network create egg-demo-net
```

### 部署redis

```bash
# 共享egg-demo-net网络，别名为redis
docker run -d -p 6379:6379 --name redis --network egg-demo-net --network-alias redis redis:latest
```

### 部署mongodb

```bash
# 共享egg-demo-net网络，别名为mongo
# --auth表示需要密码才能访问容器服务
docker run -d -p 27017:27017 --name mongo --network egg-demo-net  --network-alias mongo mongo:4.4.13 --auth

# 进入mongo容器
docker exec -it mongo 
# 连接mongo
mongo admin

# 创建一个名为 admin，密码为 123456 的用户
db.createUser({ user:'admin',pwd:'123456',roles:[ { role:'userAdminAnyDatabase', db: 'admin'},"readWriteAnyDatabase"]});

# 尝试使用上面创建的用户信息进行
db.auth('admin', '123456')
```

### 启动项目

1. 项目根目录建立Dockerfile文件

   > Dockerfile就是使用一些标准的原语，描述要构建的 Docker 镜像。并且这些原语，都是按顺序处理的。(RUN 原语就是在容器里执行 shell 命令的意思)。
   >
   > 
   >
   > 注意：Dockerfile中每个原语执行后，都会生成一个对应的镜像层。即使原语本身并没有明显地修改文件的操作（比如，ENV 原语），它对应的层也会存在，只不过在外界看来，这个层是空的。

```bash
# 设置node镜像，如果本地没有，会从Docker中拉取
FROM node:14

# 设置工作目录为/app
# 在这一句之后，Dockerfile后面的操作都以这一句指定的 /app 目录作为当前目录
WORKDIR /app

# 拷贝package.json文件到工作目录
# Docker构建镜像时，是一层一层构建的，仅当这一层有变化时，重新构建对应的层
# 如果package.json和源代码一起添加到镜像，则每次修改源码都需要重新安装npm模块
# 所以，先添加package.json安装npm模块；然后添加源代码
COPY package.json /app/package.json

# 安装npm依赖(淘宝的镜像源)
RUN npm i --registry=https://registry.npm.taobao.org

# 拷贝所有源代码到工作目
COPY . /app

# 允许外界访问容器的7001端口
EXPOSE 7001

# 启动egg项目 注意：此处用npm run start命令，egg项目里的package.json文件里要去掉--daemon参数
# CMD意思是Dockerfile指定npm run dev为这个容器的进程，此语句等价于"docker run npm run dev"
CMD npm run start
```

> 默认情况下，Docker会提供一个隐含的 ENTRYPOINT，即：/bin/sh -c
>
> 所以，在不指定 ENTRYPOINT 时，比如在这个例子里，实际上运行在容器里的完整进程是：/bin/sh -c "npm run dev"，即 CMD 的内容就是 ENTRYPOINT 的参数。



2. 构建启动项目

```bash
# 进入项目根目录，即Dockerfile文件所在目录

# 构建
docker build -t egg-demo:v1 .

# 启动容器 共享egg-demo-net网络
# 挂载日志目录 ~/egg-demo/logs为主机目录，/app/logs为egg项目中写入的日志目录（因为docker容器一旦挂掉，容器中的文件也会访问不了）宿主主机目录不存在时会自动建
# 主机的8080端口映射到容器中的7001端口
docker run -d --name=egg-demo1 -v ~/egg-demo/logs:/app/logs -p 8080:7001 --network egg-demo-net egg-demo:v1

# 测试
curl http://localhost:8080

curl http://localhost:8080/redis

curl http://localhost:8080/mongodb

# 列出容器  -a可以看到终止的容器
docker container ls -a

# 进入容器
docker exec -it 容器id /bin/sh

# 终止容器
docker container stop 容器id

# 删除终止的容器
docker container rm 容器id

# 查看容器的信息 输出结果的Mounts即挂载数据卷的信息
docker inspect 容器id

# 查看当前正在运行的 Docker 容器的进程号（PID）
docker inspect --format '{{ .State.Pid }}' 容器id


# 删除镜像
docker image rm 镜像id或镜像名
```

### 发布镜像到docker hub

```bash
# 登陆
docker login -u <用户名>

# 标记本地egg-demo:v1镜像，将其标记为sinkhaha/egg-demo:v1镜像  sinkhaha为用户名
docker tag egg-demo:v1 sinkhaha/egg-demo:v1

# 推送sinkhaha/egg-demo:v1镜像到docker hub
docker push sinkhaha/egg-demo:v1

# 拉取sinkhaha/egg-demo:v1镜像，并启动项目
docker run -d --name=egg-demo1 -v ~/egg-demo/logs:/app/logs -p 8080:7001 --network egg-demo-net sinkhaha/egg-demo:v1
```



# docker-compose方式

```bash
# 项目下新建docker-compose.yml，文件内容见项目

# 启动 -d表示后台运行
docker-compose up -d

# 测试
curl http://localhost:8080

curl http://localhost:8080/redis

curl http://localhost:8080/mongodb
```

