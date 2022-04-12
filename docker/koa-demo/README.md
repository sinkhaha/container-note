# 项目技术栈
Koa2 + redis



# 非docker-compose方式启动

## 前提

此处项目跟redis分别用容器的方式启动，项目需要连接redis，所以要解决容器间通信的问题



1. 创建一个名为`koa-demo-net`的网络

```
docker network create koa-demo-net
```

2. docker方式运行redis 在 `koa-demo-net` 网络中，别名`redis`

```
docker run -d -p 6379:6379 --name redis --network koa-demo-net --network-alias redis redis:latest
```



## 方式一：原始方式启动项目

```bash
# 进入项目根目录
# 安装依赖
npm i

# 启动服务
node app.js notDocker

# 访问
http://localhost:8080
http://localhost:8080/redis
```


## 方式二：构建成镜像启动容器

```bash
# 项目根目录下新建dockerfile文件 

# 构建镜像  koa-demo为镜像名 v1为版本 .为当前目录
docker build -t koa-demo:v1 .

# 启动容器
#    -p 映射容器内端口到宿主机 
#    --name容器名字 
#    -v挂载目录，容器的/app/log日志目录挂载到本机的/Users/docker-test-volume-dir目录，这样容器重启后日志不会消失
#    -d后台运行 
#    --net-work指定网络 此处和redis容器是同个网络
docker run -d -p 8080:8080 --name koa-demo-test  -v /Users/docker-test-volume-dir:/app/log --network koa-demo-net koa-demo:v1

# 访问
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

