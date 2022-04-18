# yaml和API对象的关系

用yaml文件(容器的定义、参数、配置等)方式运行容器

```bash
kubectl create -f <yaml配置文件> 
或
kubectl apply -f <yaml配置文件>
```



**一个 YAML文件对应 Kubernetes 中一个API 对象**

> k8s 会负责创建出yaml这些对象所定义的容器或者其他类型的 API 资源



**一个API 对象，大多可以分为两个部分**

1. Metadata 

   > 存放对象的元数据，对所有 API 对象来说，这一部分的字段和格式基本上是一样的

2. Spec 

   > 存放的是属于这个对象独有的定义，用来描述它所要表达的功能



# 部署无状态的nginx

可参考k8s文档：

https://kubernetes.io/zh/docs/tasks/run-application/run-stateless-application-deployment/



## 部署nginx

### 新建yaml文件

创建nginx-deployment.yaml文件

```yaml
apiVersion: apps/v1

# kind指定这个API对象的类型（Type），是一个 Deployment，是一个定义多副本应用（即多个副本 Pod）的对象
kind: Deployment  
metadata:
  name: nginx-deployment
spec:
  selector:
    matchLabels: # Deployment会把所有正在运行的、携带“app: nginx”标签的 Pod 识别为被管理的对象
      app: nginx
  replicas: 2 # 定义的 Pod 副本个数是2
  template: # 定义了一个 Pod 模版，描述了想要创建的 Pod 的细节
    metadata: # API对象的“标识”，即元数据，是我们从 Kubernetes 里找到这个对象的主要依据
      labels: # 是一组 key-value 格式的标签
        app: nginx  
    spec:
      containers:
      - name: nginx
        image: nginx:1.16.1 # 容器的镜像
        ports:
        - containerPort: 80 # 容器监听端口
```

**"控制器"模式（controller pattern）**：使用一种 API 对象（Deployment）管理另一种 API 对象（Pod）的方法



### 运行yaml创建Deployment对象

使用` kubectl create `把yaml文件“运行”起来

```bash
kubectl create -f nginx-deployment.yaml

# 输出如下
deployment.apps/nginx-deployment created
```



### 查看pod状态

 `kubectl get` 检查这个yaml运行的状态

```bash
# -l app=nginx即匹配lebels为app:nginx的pod
$ kubectl get pods -l app=nginx
NAME                                READY     STATUS    RESTARTS   AGE
nginx-deployment-67594d6bf6-9gdvr   1/1       Running   0          10m
nginx-deployment-67594d6bf6-v6j7w   1/1       Running   0          10m
```

> 有两个 Pod 处于 Running 状态，说明这个 Deployment 所管理的 Pod 都处于预期的状态



**查看deployment服务**

```text
kubectl get deployments
```



### 查看pod的细节

kubectl describe查看一个 API 对象的详细信息，比如 IP地址 等

```bash
# nginx-deployment-67594d6bf6-9gdvr为pod的名字
$ kubectl describe pod nginx-deployment-67594d6bf6-9gdvr 
Name:               nginx-deployment-67594d6bf6-9gdvr
Namespace:          default
Priority:           0
PriorityClassName:  <none>
Node:               node-1/10.168.0.3
Start Time:         Thu, 16 Aug 2018 08:48:42 +0000
Labels:             app=nginx
                    pod-template-hash=2315082692
Annotations:        <none>
Status:             Running
IP:                 10.32.0.23
Controlled By:      ReplicaSet/nginx-deployment-67594d6bf6
...
Events:

  Type     Reason                  Age                From               Message

  ----     ------                  ----               ----               -------
  
  Normal   Scheduled               1m                 default-scheduler  Successfully assigned default/nginx-deployment-67594d6bf6-9gdvr to node-1
  Normal   Pulling                 25s                kubelet, node-1    pulling image "nginx:1.16.1"
  Normal   Pulled                  17s                kubelet, node-1    Successfully pulled image "nginx:1.16.1"
  Normal   Created                 17s                kubelet, node-1    Created container
  Normal   Started                 17s                kubelet, node-1    Started container
```

#### events事件

在k8s执行的过程中，对 API 对象的所有`重要操作`，都会被记录在这个对象的 Events 里。



**最佳实践**：如果有异常发生，查看 Events，一般可看到详细的错误信息



### 进入pod的容器

```bash
# 此时pod只有一个容器
kubectl exec -it <pod名> -- /bin/bash

# 如
# kubectl exec -it nginx-deployment-5c678cfb6d-lg9lw -- /bin/bash

# 如果pod有多个容器，需要指定容器
kubectl exec -it <pod名> --container <容器名>  -- /bin/bash
```



### 访问nginx

浏览器访问 `<master节点公网ip>:80` 即可看访问到nginx



**删除Deployment **

如果要删除这个 Nginx Deployment ，直接执行：

```bash
$ kubectl delete -f nginx-deployment.yaml
```



## 通过service访问nginx

创建NodePort类型的服务service：此时可以通过 `<Node节点IP>:<NodePort>`的方式从`集群的外部`访问一个 NodePort 服务。



### 新建yaml

nginx-service.yaml文件如下：

```yaml
apiVersion: v1
kind: Service # Service类型
metadata:
  labels:
    app: nginx
  name: nginx-service
spec:
  ports:
  - port: 80
    protocol: TCP
    targetPort: 80
    nodePort: 32500 # 注意，service中的selector中的配置要与pod中的labels保持一致
  selector:
    app: nginx
  type: NodePort # NodePort类型
```

注意：修改NodePort的范围

在master节点，修改`/etc/kubernetes/manifests/kube-apiserver.yaml`文件，向其中添加 `--service-node-port-range=1-50000`（k8s默认使用NodePort对外映射端口为30000-50000）



### 创建service

```bash
# 创建service
kubectl apply -f nginx-service.yaml
```



### 查看服务

```bash
# -o wide 列出IP/Node等更多信息
kubectl get svc -o wide
```



### 访问nginx

浏览器访问 `<服务器公网ip地址>:32500`即可访问nginx



## 升级nginx服务

**目的：对Nginx服务进行升级，把它的镜像版本从 1.16.1 升级为 1.18.1**



1. **修改nginx-deployment.yaml的内容**

```bash
...    
    spec:
      containers:
      - name: nginx
        image: nginx:1.18.1 #这里被从1.16.1修改为1.18.1
        ports:
      - containerPort: 80
```



2. **使用kubectl apply命令(推荐)，来统一进行 Kubernetes 对象的创建和更新操作**

```bash
$ kubectl apply -f nginx-deployment.yaml 

# 也可以使用 kubectl replace 指令来完成这个更新，但不推荐，如kubectl replace -f nginx-deployment.yaml
```

kubectl apply是声明式 API的方法



## 声明一个 Volume

**在Deployment声明一个 Volume**



Volume 是属于 Pod 对象的一部分

> 修改这个 YAML 文件里的 template.spec 字段，如下所示：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
spec:
  selector:
    matchLabels:
      app: nginx
  replicas: 2
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.8
        ports:
        - containerPort: 80 #容器应用监控的端口号
        volumeMounts:
        - mountPath: "/usr/share/nginx/html"
          name: nginx-vol
      volumes: # 定义这个pod声明的volume，名字叫nginx-vol，类型是 emptyDir
      - name: nginx-vol
        emptyDir: {}
```



修改完后，使用 kubectl apply 更新这个Deployment

```bash
$ kubectl apply -f nginx-deployment.yaml
```



```bash
# 查看两个 Pod 被逐一更新的过程（新旧两个 Pod，被交替创建、删除，最后剩下的就是新版本的 Pod（滚动更新））
$ kubectl get pods
NAME                                READY     STATUS              RESTARTS   AGE
nginx-deployment-5c678cfb6d-v5dlh   0/1       ContainerCreating   0          4s
nginx-deployment-67594d6bf6-9gdvr   1/1       Running             0          10m
nginx-deployment-67594d6bf6-v6j7w   1/1       Running             0          10m
```



可以使用 kubectl exec 指令，进入到这个 Pod 当中（即容器的 Namespace 中）查看这个 Volume 目录

```bash
$ kubectl exec -it nginx-deployment-5c678cfb6d-lg9lw -- /bin/bash
# ls /usr/share/nginx/html
```



**volume类型**

1. emptyDir类型

等同于 Docker 的隐式 Volume 参数，即：不显式声明宿主机目录的 Volume。

> 所以，k8s 也会在宿主机上创建一个`临时目录`，这个目录将来就会被绑定挂载到容器所声明的 Volume 目录上

而 Pod 中的容器，使用的是 volumeMounts 字段来声明自己要挂载哪个 Volume，并通过 mountPath 字段来定义容器内的 Volume 目录，比如：/usr/share/nginx/html。



2. hostPath类型

显式的 Volume 定义，比如

```yaml
...   
    volumes:
      - name: nginx-vol
        hostPath: 
          path:  "/var/data"
```

容器 Volume 挂载的宿主机目录，就变成了 /var/data


