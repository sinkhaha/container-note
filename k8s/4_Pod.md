# 一、Pod

## 什么是Pod

Pod是对容器的进一步抽象和封装。它对容器进行了组合，添加了更多的属性和字段。

> Docker容器类似集装箱，Pod类似给集装箱增加了吊环，使得k8s这台吊车更好操作(通过控制器Controller完成)



![](https://sink-blog-pic.oss-cn-shenzhen.aliyuncs.com/img/CICD/Pod.png)



## 亲密关系容器

有亲密关系的容器才要放在同一个pod中。



**具有“亲密关系”容器的特征包括但不限于：互相之间会发生**

1. 直接的文件交换
2. 使用 localhost 或者 Socket 文件进行`本地通信`
3. 会发生非常频繁的`远程调用`
4. 需要共享某些 Linux Namespace（比如一个容器要加入另一个容器的 Network Namespace）

>  比如，Java Web应用容器和 MySQL 虽然会发生访问关系，但并没有必要部署在同一台机器上，它们更适合做成两个 Pod，它们不属于亲密关系



## Pod的实现

#### Infra中间容器

Pod是通过Infra中间容器实现的，它是一个永远处于"暂停"状态的容器，只占用网络和磁盘等极小资源，使用的镜像是`k8s.gcr.io/pause`。



#### **Infra容器和用户容器的关系**

1. 在Pod中，Infra容器是第一个被创建的容器

2. 在Pod中，用户定义的容器是通过 `Join Network Namespace `的方式，与Infra容器关联在一起

   > Infra容器创建Network Namespace和Volume Namespace 后，用户容器就可以加入到 Infra 容器的 Network Namespace 当中。所以，查看同一Pod的容器在宿主机上的Network Namespace 文件，它们指向的值一定是完全一样的

3. 同一个Pod里的所有用户容器的进出流量，也可以认为都是通过Infra容器完成的



如下图这个Pod里有2个用户容器 A 和 B，还有1个Infra容器：



![](https://sink-blog-pic.oss-cn-shenzhen.aliyuncs.com/img/CICD/Infra%E5%92%8C%E5%AE%B9%E5%99%A8%E7%9A%84%E5%85%B3%E7%B3%BB.png)



**对于Pod里的容器A和容器B：**

1. 它们可以直接使用 `localhost `进行通信

2. 它们看到的`网络设备`跟 Infra 容器看到的完全一样

3. `一个Pod只有一个 IP 地址`，也就是这个 Pod 的 Network Namespace 对应的 IP 地址

4. 其他的所有`网络资源`，都是一个 Pod 一份，并且被该 `Pod 中的所有容器共享`

5. Pod 的生命周期只跟 Infra 容器一致，而与 容器A 和 容器B 无关




**共享Volume：**

一个Volume对应的宿主机目录对于Pod来说只有一个，Pod里的容器只要声明挂载这个 Volume，就一定可以共享这个 Volume 对应的宿主机目录。

例如：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: two-containers
spec:
  restartPolicy: Never
  volumes: # 声明一个存储卷
  - name: shared-data
    hostPath:      
      path: /data
  containers:
  - name: nginx-container
    image: nginx
    volumeMounts:
    - name: shared-data # 挂载shared-data存储卷
      mountPath: /usr/share/nginx/html
  - name: debian-container
    image: debian
    volumeMounts:
    - name: shared-data # 挂载shared-data存储卷
      mountPath: /pod-data
    command: ["/bin/sh"]
    args: ["-c", "echo Hello from the debian container > /pod-data/index.html"]
```

1、debian-container 和 nginx-container 都声明挂载了 shared-data 这个 Volume。

2、shared-data 是 `hostPath 类型`，对应宿主机的/data目录，而这个目录被同时绑定挂载进debian-container 和 nginx-container 两个容器当中，所以nginx-container 可以从它的 /usr/share/nginx/html 目录中，读取到 debian-container 生成的 index.html 文件。



# 二、容器设计模式

没有Pod时，用户想在一个容器跑多个不相关的应用时，需要考虑怎么去处理比较好；有了Pod之后，用户只需要考虑放到同一个Pod中，其他的东西交给Pod处理，相当于抽象出了一种设计模式。



## Pod中多个容器的例子

### 例1：war包与Tomcat

需求：有一个 Java Web 应用的 WAR 包需要被放在 Tomcat 的 webapps 目录下运行起来

##### 一、用docker实现

* 方法1：把 WAR 包直接放在 Tomcat 镜像的 webapps 目录下，做成一个新的镜像运行起来

  > 缺点：当要更新 WAR 包的内容或者 升级Tomcat镜像时，需要重新制作一个新的发布镜像，非常麻烦

* 方法2：不管 WAR 包，永远只发布一个 Tomcat 容器

  > Tomcat容器的 webapps 目录就必须声明一个 hostPath 类型的 Volume，从而把宿主机上的 WAR 包挂载进 Tomcat 容器当中运行起来。
  >
  > 缺点：要让每一台宿主机，都预先准备好这个存储有 WAR 包的目录，此时只能独立维护一套分布式存储系统了

  

##### 二、用Pod实现(推荐)

方法：可以把 WAR 包和 Tomcat 分别做成镜像，然后把它们作为`一个 Pod 里的两个容器`组合在一起。

> 优点：用Pod可以轻松解决上面docker出现的问题



这个 Pod 的配置文件如下：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: javaweb-2
spec:
  initContainers: # 初使化类型的容器
  - image: geektime/sample:v2
    name: war
    command: ["cp", "/sample.war", "/app"]
    volumeMounts:
    - mountPath: /app
      name: app-volume
  containers: # 用户容器
  - image: geektime/tomcat:7.0
    name: tomcat
    command: ["sh","-c","/root/apache-tomcat-7.0.42-v2/bin/start.sh"]
    volumeMounts:
    - mountPath: /root/apache-tomcat-7.0.42-v2/webapps
      name: app-volume
    ports:
    - containerPort: 8080
      hostPort: 8001 
  volumes:
  - name: app-volume
    emptyDir: {}
```

**文件中定义了两个容器**

1. 第一个容器使用的是geektime/sample:v2镜像，这个镜像里只有一个 WAR 包（sample.war）放在根目录下

   > 注意：WAR包容器是一个 Init Container 类型的容器

   > WAR 包容器启动后，执行`"cp /sample.war /app"`，把应用的 WAR 包拷贝到 /app 目录下，然后退出。最后这个 /app 目录，挂载了一个名叫 app-volume 的 Volume。

2. 第二个容器使用的Tomcat镜像

   > Tomcat 容器同样声明了挂载 app-volume 到自己的 webapps 目录下。所以等Tomcat 容器启动时，它的 webapps目录下一定会存在 sample.war 文件。(这个文件是 WAR 包容器启动时拷贝到这个 Volume 里的，这个 Volume 是被这两个容器`共享`的)




###### Init容器

1. init容器会比用户容器先启动
2. Init容器会按顺序逐一启动，而直到它们都启动并且退出了，用户容器才会启动



**Init容器应用场景**

例如上面的例子，以Init Container的方式优先运行WAR包容器，扮演了一个 sidecar 的角色。

> sidecar指可以在一个 Pod 中，启动一个辅助容器，来完成一些独立于主进程（主容器）之外的工作。
>
> 比如，在这个Pod 中，Tomcat容器是我们要使用的主容器，而 WAR包容器的存在，只是为了给它提供一个 WAR包而已



### 例2：容器的日志收集

需求：有一个应用，需要不断地把日志文件输出到`容器的/var/log目录`中

1. 可以把一个 Pod 里的 Volume 挂载到`应用容器的/var/log目录`上

2. 接下来 `sidecar容器`就只需要做一件事儿，就是不断地从自己的 `/var/log 目录里读取日志文件`，转发到 MongoDB 或者 Elasticsearch 中存储起来



# 三、Pod对象的基本概念

 Pod级别的字段：凡是调度、网络、存储，以及安全相关的属性

> 可以阅读 https://github.com/kubernetes/api/blob/master/core/v1/types.go 里，`type Pod struct `，尤其是 `PodSpec 部分`的内容，了解一个 Pod 的 YAML 文件的常用字段及其作用




## Pod级别的字段

**NodeSelector**

> 将 Pod 与 Node(k8s节点) 进行绑定

```yml
apiVersion: v1
kind: Pod
...
spec:
 nodeSelector: # 表示这个Pod永远只能运行在携带了`disktype: ssd`标签的节点上，否则它将调度失败
   disktype: ssd
```

**NodeName**

> pod经过调度后被赋予k8s节点名

一旦 Pod 的这个字段被赋值，k8s会被认为这个 Pod 已经经过了调度，调度的结果就是赋值的节点名字。

> 这个字段一般由`调度器`负责设置，但用户也可以设置它来“骗过”调度器，当然这个做法一般是在测试或者调试时才会用到



**HostAliases**

> 定义了 Pod 的 hosts 文件（比如 /etc/hosts）内容

用法如下：在Pod 中设置了一组 IP 和 hostname 的数据

```yaml
apiVersion: v1
kind: Pod
...
spec:
  hostAliases:
  - ip: "10.1.2.3"
    hostnames:
    - "foo.remote"
    - "bar.remote"
...
```

这个 Pod 启动后，/etc/hosts 文件的内容将如下所示：

```shell
cat /etc/hosts
# Kubernetes-managed hosts file.
127.0.0.1 localhost
...
10.244.135.10 hostaliases-pod
10.1.2.3 foo.remote  # 通过 HostAliases 字段为Pod中设置的
10.1.2.3 bar.remote  # 通过 HostAliases 字段为Pod中设置的
```

**作用**

在k8s项目中，一定要通过这种方法设置 hosts 文件里的内容。否则，如果直接修改了 hosts 文件的话，在 Pod 被删除重建之后，kubelet 会自动覆盖掉被修改的内容。



**shareProcessNamespace**

凡是跟`容器的 Linux Namespace 相关的属性`，也一定是 Pod 级别的

> 因为Pod 的设计，就是要让它里面的容器尽可能多地共享 Linux Namespace，仅保留必要的隔离和限制能力

如yaml文件设置shareProcessNamespace: true

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  shareProcessNamespace: true
  containers:
  - name: nginx
    image: nginx
  - name: shell
    image: busybox
    stdin: true
    tty: true
```

意味着这个 Pod 里的容器要共享 PID Namespace

>  文件中定义了两个容器：
>
>  1. nginx 容器
>  2. 开启了 tty 和 stdin 的 shell 容器
>
>  tty 就是 Linux 给用户提供的一个常驻小程序，用于接收用户的标准输入，返回操作系统的标准输



**hostNetwork/hostIPC/hostPID**

凡是 Pod 中的容器要共享宿主机的 Namespace，也一定是 Pod 级别的定义

比如：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  hostNetwork: true # 共享宿主机的 Network
  hostIPC: true # 共享宿主机的 IPC
  hostPID: true # 共享宿主机的 PID Namespace
  containers:
  - name: nginx
    image: nginx
  - name: shell
    image: busybox
    stdin: true
    tty: true
```

在这Pod中，定义了共享宿主机的 Network、IPC 和 PID Namespace

> 表示这个 Pod 里的所有容器，会直接使用宿主机的网络、直接与宿主机进行 IPC 通信、看到宿主机里正在运行的所有进程



## Container容器级别的字段

### 常见的字段

1. Image（镜像）

2. Command（启动命令）

3. workingDir（容器的工作目录）

4. Ports（容器要开发的端口）

5. volumeMounts（容器要挂载的 Volume）

   

### ImagePullPolicy字段

定义了镜像拉取的策略

> 因为容器镜像本来就是 Container 定义中的一部分

其值为

1. Always：每次创建 Pod 都重新拉取一次镜像，默认值
2. Never：Pod 永远不会主动拉取这个镜像
3. IfNotPresent：只在宿主机上不存在这个镜像时才拉取



### Lifecycle字段*

作用是在`容器状态发生变化时`触发一系列“钩子”

如下：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: lifecycle-demo
spec:
  containers:
  - name: lifecycle-demo-container
    image: nginx
    lifecycle: # 生命周期
      postStart:
        exec:
          command: ["/bin/sh", "-c", "echo Hello from the postStart handler > /usr/share/message"]
      preStop:
        exec:
          command: ["/usr/sbin/nginx","-s","quit"]
```

定义了一个 nginx 镜像的容器，分别设置了一个 postStart 和 preStop 参数。



容器成功启动之后，在 /usr/share/message 里写入了一句“欢迎信息”（即 postStart 定义的操作）。

而在这个容器被删除之前，先调用了 nginx 的退出指令（即 preStop 定义的操作），从而实现了容器的`“优雅退出”`。



1. postStart参数

>表示在`容器启动后`，立刻执行一个指定的操作。
>
>
>
>注意：postStart 定义的操作，虽然是在 Docker 容器 ENTRYPOINT 执行之后，但它并不严格保证顺序。
>
>也就是在 postStart 启动时，ENTRYPOINT 有可能还没有结束。
>
>
>
>当然，如果 `postStart 执行超时或者错误`，k8s会在该 Pod 的 Events 中报出该容器启动失败的错误信息，导致 Pod 也处于`失败`的状态。

2. preStop参数

>发生在`容器被杀死之前`（比如收到了 SIGKILL 信号）。
>
>注意：preStop 操作的执行，是同步的。所以它会`阻塞`当前的容器杀死流程，直到这个 Hook 定义操作完成之后，才允许容器被杀死，这跟 postStart 不一样。




## Pod生命周期status

Pod 生命周期的变化，主要体现在 `Pod API 对象的 Status 部分`，这是它除了 `Metadata` 和 `Spec` 之外的第三个重要字段。



### Pod.status.phase字段*

`pod.status.phase`，就是Pod的当前状态，有如下几种情况：

1. Pending

>表示Pod 的 YAML 文件已经提交给了k8s，API对象已经被创建并保存在 Etcd 当中。但是，这个 Pod 里`有些容器`因为某种原因而不能被顺利创建。比如，`调度不成功`

2. Running

>表示Pod已经`调度成功`，跟`一个具体的节点绑定`。它包含的容器都已经创建成功，并且至少有一个正在运行中

3. Succeeded

>表示Pod 里的`所有容器`都正常运行完毕，并且`已经退出了`。这种情况在`运行一次性任务`时最为常见

4. Failed

>表示Pod 里`至少有一个容器以不正常的状态（非 0 的返回码）退出`。这个状态的出现，意味着你得想办法 Debug 这个容器的应用，比如查看 Pod 的 Events 和日志

5. Unknown

>这是一个`异常状态`，意味着 Pod 的状态不能持续地被 kubelet 汇报给 kube-apiserver，这很有可能是`主从节点（Master 和 Kubelet）间的通信`出现了问题



### Conditions字段*

Pod 对象的 `Status 字段`，还可以再细分出一组 `Conditions`，主要用于描述造成当前 Status 的具体原因是什么。

这些细分状态的值包括：

1. PodScheduled
2. Ready

>Ready 这个细分状态非常值得我们关注：它意味着 Pod 不仅已经`正常启动（Running 状态）`，而且已经可以`对外提供服务了`

3. Initialized

4. Unschedulable

   

比如Pod 当前的 Status 是 Pending，对应的 Condition 是 Unschedulable，这就意味着它的调度出现了问题。

**Pod的这些状态信息，是我们`判断应用运行情况的重要标准`，尤其是 Pod 进入了`非“Running”状态`后，快速根据它所代表的异常情况开始跟踪和定位。**



## 补充：Pod非Running状态的例子

举出一些Pod的状态是 `Running`，但是应用其实已经停止服务的例子？

1. 程序本身有 bug，本来应该返回 200，但因为代码问题，返回的是500
2. 程序因为内存问题，已经僵死，但进程还在，但无响应
3. Dockerfile 写的不规范，应用程序不是主进程，那么主进程出了什么问题都无法发现
4. 程序出现死循环



# 四、Pod对象使用进阶

## Projected Volume是什么

特殊的 Volume，叫作Projected Volume，可以翻译为`'投射数据卷'`。

> 是 Kubernetes v1.11 之后的新特性



**作用**

为容器提供预先定义好的数据；它们不是为了存放容器里的数据，也不是用来进行`容器和宿主机`之间的数据交换。

> 从容器的角度来看，这些 Volume 里的信息仿佛是被k8s“投射”（Project）进入容器当中的。



## 4种Projected Volume


### 1、Secret

##### 作用

把Pod要访问的加密数据（例如数据库的账密信息）存放到 Etcd 中，然后在Pod的容器里挂载Volume，可以访问Secret里保存的信息。

如果Etcd里的Secret对象的数据被更新，Pod挂载的Sectet文件内容也会被更新（kubelet组件在定时维护这些 Volume）



##### 创建secret对象

**方式一：通过txt文件创建**

1. 把用户名存放在username.txt里，把密码存放在password.txt里

2. 使用kubectl create secret创建secret对象（名为user的Secret对象存放用户名，名为pass的Secret对象存放密码）

```shell
# 先创建账密文件
$ cat ./username.txt
admin
$ cat ./password.txt
c1oudc0w!

# 创建secret对象，user的值是username.txt文件的内容，pass的值是password.txt文件的内容
$ kubectl create secret generic user --from-file=./username.txt
$ kubectl create secret generic pass --from-file=./password.txt
```



**方式二：通过yaml文件创建(推荐)**

```YAML
apiVersion: v1
kind: Secret
metadata:
  name: mysecret
type: Opaque
data:
  user: YWRtaW4= # base64格式
  pass: MWYyZDFlMmU2N2Rm
```

注意，Secret 对象要求这些数据必须是经过 `Base64 转码的`，避免明文安全隐患。

```shell
# 命令行base64转码
$ echo -n 'admin' | base64
YWRtaW4=
$ echo -n '1f2d1e2e67df' | base64
MWYyZDFlMmU2N2Rm
```

在生产环境中，需要在k8s中开启Secret的加密插件，增强数据的安全性。



**查看Secret对象**

```bash
$ kubectl get secrets
NAME           TYPE                                DATA      AGE
user          Opaque                                1         51s
pass          Opaque                                1         51s
```



##### **通过Pod使用secret对象**

如test-projected-volume.yaml

```yaml
apiVersion: v1
kind: Pod # Pod类型
metadata:
  name: test-projected-volume 
spec:
  containers:
  - name: test-secret-volume
    image: busybox
    args:
    - sleep
    - "86400"
    volumeMounts:
    - name: mysql-cred
      mountPath: "/projected-volume" # 挂载的路径
      readOnly: true
  volumes:
  - name: mysql-cred
    projected:
      sources:
      - secret:
          name: user
      - secret:
          name: pass
```

上面Pod声明挂载的 Volume是 projected 类型，它的数据来源（sources）是名为 user 和 pass 的 Secret 对象，分别对应的是 数据库的用户名和密码。

```bash
# 创建Pod
kubectl apply -f test-projected-volume.yaml

# 进入pod内，可以看到文件已经存在，并且内容和设置的一样
kubectl exec -it test-projected-volume -- /bin/sh

ls /projected-volume/
password.txt username.txt

cat /projected-volume/username.txt
admin
```



### 2、ConfigMap

与Secret类似，区别在于ConfigMap保存的是不需要加密的、应用所需的配置信息。

> 用法几乎与 Secret 完全相同：可以使用 kubectl create configmap 从文件 或者 目录创建 ConfigMap，也可以直接编写 ConfigMap 对象的 YAML 文件。



### 3、Downward API

作用：让 Pod 里的容器能够直接获取到这个 Pod API 对象本身的信息

> Downward API 能够获取到的信息，一定是 Pod 里的容器进程启动之前就能够确定下来的信息。
>
> 如果要获取 Pod 容器运行后才会出现的信息（比如容器进程的 PID），肯定不能使用 Downward API 了，应该考虑在 Pod 里定义一个sidecar容器。



### 4、ServiceAccountToken

**Service Account和ServiceAccountToken**

* Service Account：是k8s系统内置的一种`“服务账户”`，是k8s进行权限分配的对象，绑定了ServiceAccountToken

* ServiceAccountToken：一个特殊的 Secret 对象，存Service Account 的授权信息和文件

> 任何运行在k8s集群上的应用，都必须使用这个ServiceAccountToken里保存的授权信息，也就是Token，才可以合法地访问 API Server



k8s已经提供了一个默认“服务账户”（default Service Account），任何一个运行在k8s里的 Pod，都可以直接使用这个默认的 Service Account，而无需显示地声明挂载它，靠的正是Projected Volume 机制。



查看一下任意一个运行在k8s集群里的 Pod，可以发现，每一个 Pod都已经自动声明一个类型是 Secret、名为 default-token-xxxx 的 Volume，然后自动挂载在每个容器的一个固定目录`/var/run/secrets/kubernetes.io/serviceaccount`上。

比如：

```shell
$ kubectl describe pod nginx-deployment-5c678cfb6d-lg9lw
Containers:
...
  Mounts:
    /var/run/secrets/kubernetes.io/serviceaccount from default-token-s8rbq (ro)
Volumes:
  default-token-s8rbq:
  Type:       Secret (a volume populated by a Secret)
  SecretName:  default-token-s8rbq
  Optional:    false
```

这个Secret类型的 Volume，正是默认 Service Account 对应的 ServiceAccountToken。



1. k8s在每个 Pod 创建的时，自动在它的 spec.volumes 部分添加上了默认 ServiceAccountToken 的定义，然后自动给每个容器加上了对应的 volumeMounts 字段。这个过程对于用户来说是完全透明的。

2. 一旦 Pod 创建完成，容器里的应用就可以直接从这个默认 ServiceAccountToken 的挂载目录里访问到授权信息和文件，进而访问并操作 Kubernetes API 。



参考：https://time.geekbang.org/column/article/14252

