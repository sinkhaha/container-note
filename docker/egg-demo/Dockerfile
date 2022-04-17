# 设置node镜像，如果本地没有，会从Docker中拉取
FROM node:14

# 设置工作目录为/app
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

# 启动egg项目
CMD npm run start
