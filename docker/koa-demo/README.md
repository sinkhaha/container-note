# 项目介绍

docker部署koa项目



# 项目技术栈

Koa2 + redis



# 非docker-compose方式启动

### 创建网络(名为koa-demo-net)

> 因为项目需要连接redis，所以要解决容器间通信的问题：容器共用同一个网络
>

```bash
docker network create koa-demo-net
```

### 部署redis

```bash
# 共享koa-demo-net网络
docker run -d -p 6379:6379 --name redis --network koa-demo-net --network-alias redis redis:latest
```

### 启动项目

1. 项目根目录建立Dockerfile文件

```bash
FROM node:14

# 复制当前目录的代码到app目录下
ADD . /app

# 设置容器启动后的默认运行目录
WORKDIR /app

# 安装依赖
RUN npm install --registry=https://registry.npm.taobao.org

# 容器启动后执行的命令
CMD node app.js
```

2. 构建启动项目

```bash
# 进入项目根目录，即dockerfile文件所在目录

# 构建镜像  koa-demo为镜像名 v1为版本 .为当前目录
docker build -t koa-demo:v1 .

# 启动容器
#    -p 映射容器内端口到宿主机 
#    --name容器名字 
#    -v挂载目录，容器的/app/log日志目录挂载到本机的/Users/docker-test-volume-dir目录，这样容器重启后日志不会消失
#    -d后台运行 
#    --net-work指定网络 此处和redis容器是同个网络
docker run -d -p 8080:8080 --name koa-demo-test  -v /Users/docker-test-volume-dir:/app/log --network koa-demo-net koa-demo:v1

# 测试
http://localhost:8080
http://localhost:8080/redis
```

# docker-compose方式启动

```bash
# 进入项目根目录
新建docker-compose.yml文件，具体内容看项目文件

# 在docker-compose.yml目录下(即根目录)运行如下命令启动
docker-compose up -d

# 访问
http://localhost:8080
http://localhost:8080/redis
```

