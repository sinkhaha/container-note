# 有状态应用

指实例之间有`不对等`关系，以及实例对`外部数据`有依赖关系的应用。



1. 例子1：分布式应用，它的多个实例之间往往有依赖关系，比如：主从关系、主备关系

2. 例子2：数据存储类应用，它的多个实例，往往都会在本地磁盘上保存一份数据。而这些实例一旦被杀掉，即便重建出来，实例与数据之间的对应关系也已经丢失，从而导致应用失败。



# StatefulSet

StatefulSet是 k8s对“有状态应用”的初步支持

**StatefulSet其实可以认为是对 Deployment 的改良**



### 拓扑状态和存储状态

**StatefulSet 的设计把真实世界里的应用状态，抽象为了两种情况：**

1. 拓扑状态

   这种情况意味着，应用的多个实例之间不是完全对等的关系

   > 这些应用实例，必须按照某些顺序启动，比如应用的主节点 A 要先于从节点 B 启动。而如果你把 A 和 B 两个 Pod 删除掉，它们再次被创建出来时也必须严格按照这个顺序才行。并且，新创建出来的 Pod，必须和原来 Pod 的网络标识一样，这样原先的访问者才能使用同样的方法，访问到这个新 Pod

2. 存储状态

   这种情况意味着，应用的多个实例分别绑定了不同的存储数据

   > 对于这些应用实例来说，Pod A 第一次读取到的数据，和隔了十分钟之后再次读取到的数据，应该是同一份，哪怕在此期间 Pod A 被重新创建过。最典型的例子，就是一个数据库应用的多个存储实例



### 核心功能

StatefulSet 的核心功能，就是通过某种方式`记录这些状态`，然后在 Pod 被重新创建时，能够为新 Pod 恢复这些状态。



StatefulSet控制器的主要作用：就是使用 Pod 模板创建 Pod 时，对它们进行编号，并且按照编号顺序逐一完成创建工作。而当 StatefulSet 的“控制循环”发现 Pod 的“实际状态”与“期望状态”不一致，需要新建或者删除 Pod 进行“调谐”时，它会严格按照这些 Pod 编号的顺序，逐一完成这些操作。



# 补充：Service

Service 是用来将一组 Pod 暴露给外界访问的一种机制

> 比如，一个 Deployment 有 3 个 Pod，就可以定义一个 Service，用户只要能访问到这个 Service，它就能访问到某个具体的 Pod



### service是如何被访问的

1. 是以 Service 的 VIP（Virtual IP，即：虚拟 IP）方式

> 比如：访问 10.0.23.1 这个 Service 的 IP 地址时，10.0.23.1 其实就是一个 VIP，它会把请求转发到该 Service 所代理的某一个 Pod 上

2. 是以 Service 的 DNS 方式

> 比如：这时只要访问“my-svc.my-namespace.svc.cluster.local”这条 DNS 记录，就可以访问到名叫 my-svc 的 Service 所代理的某一个 Pod

**在第二种 Service DNS 的方式下，具体还可以分为两种处理方法：**

* 是 Normal Service

  > 这种情况下，访问“my-svc.my-namespace.svc.cluster.local”解析到的，正是 my-svc 这个 Service 的 VIP，后面的流程就跟 VIP 方式一致了

* 是 Headless Service

  > 这种情况下，访问“my-svc.my-namespace.svc.cluster.local”解析到的，直接就是 my-svc 代理的某一个 Pod 的 IP 地址。
  >
  > 这里的区别在于，Headless Service 不需要分配一个 VIP，而是可以直接以 DNS 记录的方式解析出被代理 Pod 的 IP 地址



### Headless Service的定义

 Headless Service其实仍是一个标准 Service 的 YAML 文件

> 它的 clusterIP 字段的值是：None，即：这个 Service，没有一个 VIP 作为“头”。所以这个 Service 被创建后并不会被分配一个 VIP，而是会以 DNS 记录的方式暴露出它所代理的 Pod



**一个标准的 Headless Service 对应的 YAML 文件**：svc.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx
  labels:
    app: nginx
spec:
  ports:
  - port: 80
    name: web
  clusterIP: None # None表示headless service
  selector:
    app: nginx
```

当创建了一个 Headless Service 之后，它所代理的所有 Pod 的 IP 地址，都会被绑定一个这样格式的 DNS 记录，如下所示：

```bash
<pod-name>.<svc-name>.<namespace>.svc.cluster.local
```

这个 DNS 记录，正是 Kubernetes 项目为 Pod 分配的唯一的“可解析身份”（Resolvable Identity）

> 有了这个“可解析身份”，只要知道了一个 Pod 的名字，以及它对应的 Service 的名字，就可以非常确定地通过这条 DNS 记录访问到 Pod 的 IP 地址



# 拓扑状态

### Pod的DNS记录

**StatefulSet是如何使用这个 DNS 记录来维持 Pod 的拓扑状态的？**

> 通过 Headless Service 的方式，StatefulSet 为每个 Pod 创建了一个固定并且稳定的 DNS 记录，来作为它的访问入口



1. 编写一个 StatefulSet 的 YAML 文件：statefulset.yaml

```yaml
apiVersion: apps/v1
kind: StatefulSet # 类型 这是一个有状态应用，
metadata:
  name: web
spec:
  serviceName: "nginx" # 指定使用 `名为nginx的headless service` 来访问这个pod
  replicas: 2
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.9.1
        ports:
        - containerPort: 80
          name: web
```

这个yaml文件比deployment的定义多了一个 serviceName=nginx 字段

> 这个字段的作用，就是告诉 StatefulSet 控制器，在执行控制循环（Control Loop）的时，请使用 nginx 这个 Headless Service 来保证 Pod 的“可解析身份”



2. 创建这个 Service 和 StatefulSet 之后，会看到如下两个对象：

```bash
$ kubectl create -f svc.yaml
$ kubectl get service nginx
NAME      TYPE         CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
nginx     ClusterIP    None         <none>        80/TCP    10s

$ kubectl create -f statefulset.yaml
$ kubectl get statefulset web
NAME      DESIRED   CURRENT   AGE
web       2         1         19s
```

如果手比较快的话，还可以通过 kubectl 的 -w 参数，即：Watch 功能，实时查看 StatefulSet 创建两个有状态实例的过程：

> 备注：可以通过这个 StatefulSet 的 Events 看到这些信息

```bash
$ kubectl get pods -w -l app=nginx
NAME      READY     STATUS    RESTARTS   AGE
web-0     0/1       Pending   0          0s
web-0     0/1       Pending   0         0s
web-0     0/1       ContainerCreating   0         0s
web-0     1/1       Running   0         19s
web-1     0/1       Pending   0         0s
web-1     0/1       Pending   0         0s
web-1     0/1       ContainerCreating   0         0s
web-1     1/1       Running   0         20s
```

通过上面这个 Pod 的创建过程，可以看到，StatefulSet 给它所管理的所有 Pod 的名字，进行了编号(从0累加)，编号规则是：`<statefulset name>- <ordinal index>`。



更重要的是，这些 Pod 的创建，也是严格按照编号顺序进行的。比如，在 web-0 进入到 Running 状态、并且细分状态（Conditions）成为 Ready 之前，web-1 会一直处于 Pending 状态。



3. 当这两个 Pod 都进入了 Running 状态之后，可以查看到它们各自唯一的“网络身份”了。

> 使用 kubectl exec 命令进入到容器中查看它们的 hostname：

```bash
$ kubectl exec web-0 -- sh -c 'hostname'
web-0
$ kubectl exec web-1 -- sh -c 'hostname'
web-1
```

看到这两个 Pod 的 hostname 与 Pod 名字是一致的，都被分配了对应的编号。接下来再试着以 DNS 的方式，访问一下这个 Headless Service：

```bash
$ kubectl run -i --tty --image busybox:1.28.4 dns-test --restart=Never --rm /bin/sh 
```

通过这条命令，启动了一个一次性的 Pod，因为 --rm 意味着 Pod 退出后就会被删除掉。然后，在这个 Pod 的容器里面，尝试用 nslookup 命令，解析一下 Pod 对应的 Headless Service：

```bash
$ kubectl run -i --tty --image busybox:1.28.4 dns-test --restart=Never --rm /bin/sh
$ nslookup web-0.nginx
Server:    10.0.0.10
Address 1: 10.0.0.10 kube-dns.kube-system.svc.cluster.local

Name:      web-0.nginx
Address 1: 10.244.1.7

$ nslookup web-1.nginx
Server:    10.0.0.10
Address 1: 10.0.0.10 kube-dns.kube-system.svc.cluster.local

Name:      web-1.nginx
Address 1: 10.244.2.7
```

从 nslookup 命令的输出结果中，可以看到，在访问 web-0.nginx 时，最后解析到的，正是 web-0 这个 Pod 的 IP 地址；而当访问 web-1.nginx时，解析到的则是 web-1 的 IP 地址。



这时如果你在另外一个 Terminal 里把这两个“有状态应用”的 Pod 删掉：

```bash
$ kubectl delete pod -l app=nginx
pod "web-0" deleted
pod "web-1" deleted
```

然后，再在当前 Terminal 里 Watch 一下这两个 Pod 的状态变化，就会发现一个有趣的现象：

```bash
$ kubectl get pod -w -l app=nginx
NAME      READY     STATUS              RESTARTS   AGE
web-0     0/1       ContainerCreating   0          0s
NAME      READY     STATUS    RESTARTS   AGE
web-0     1/1       Running   0          2s
web-1     0/1       Pending   0         0s
web-1     0/1       ContainerCreating   0         0s
web-1     1/1       Running   0         32s
```

可以看到，当把这两个 Pod 删除之后，Kubernetes 会按照原先编号的顺序，创建出了两个新的 Pod。并且，Kubernetes 依然为它们分配了与原来相同的“网络身份”：web-0.nginx 和 web-1.nginx。



**通过这种严格的对应规则，StatefulSet 就保证了 Pod 网络标识的稳定性。**



比如，如果 web-0 是一个需要先启动的主节点，web-1 是一个后启动的从节点，那么只要这个 StatefulSet 不被删除，你访问 web-0.nginx 时始终都会落在主节点上，访问 web-1.nginx 时，则始终都会落在从节点上，这个关系绝对不会发生任何变化。



所以，如果再用 nslookup 命令，查看一下这个新 Pod 对应的 Headless Service 的话：

```bash
$ kubectl run -i --tty --image busybox dns-test --restart=Never --rm /bin/sh 
$ nslookup web-0.nginx
Server:    10.0.0.10
Address 1: 10.0.0.10 kube-dns.kube-system.svc.cluster.local

Name:      web-0.nginx
Address 1: 10.244.1.8

$ nslookup web-1.nginx
Server:    10.0.0.10
Address 1: 10.0.0.10 kube-dns.kube-system.svc.cluster.local

Name:      web-1.nginx
Address 1: 10.244.2.8
```

可以看到，在这个 StatefulSet 中，这两个新 Pod 的“网络标识”（比如：web-0.nginx 和 web-1.nginx），再次解析到了正确的 IP 地址（比如：web-0 Pod 的 IP 地址 10.244.1.8）。



通过这种方法，Kubernetes 就成功地将 Pod 的拓扑状态（比如：哪个节点先启动，哪个节点后启动），按照 Pod 的“名字 + 编号”的方式固定了下来。此外，Kubernetes 还为每一个 Pod 提供了一个固定并且唯一的访问入口，即：这个 Pod 对应的 DNS 记录。



这些状态，在 StatefulSet 的整个生命周期里都会保持不变，绝不会因为对应 Pod 的删除或者重新创建而失效。



注意：尽管 web-0.nginx 这条记录本身不会变，但它解析到的 Pod 的 IP 地址，并不是固定的。这就意味着，对于“有状态应用”实例的访问，你必须使用 DNS 记录或者 hostname 的方式，而绝不应该直接访问这些 Pod 的 IP 地址。



# 存储状态

## 存储状态的管理

**PVC和PV 的设计，使得StatefulSet对存储状态的管理成为了可能**

> PVC和PV可参考另一章的内容

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "nginx"
  replicas: 2
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.9.1
        ports:
        - containerPort: 80
          name: web
        volumeMounts:
        - name: www
          mountPath: /usr/share/nginx/html
  volumeClaimTemplates: # pvc的模板
  - metadata:
      name: www
    spec:
      accessModes:
      - ReadWriteOnce
      resources:
        requests:
          storage: 1Gi
```

这个 StatefulSet添加了一个 volumeClaimTemplates 字段，它跟 Deployment 里 Pod 模板（PodTemplate）的作用类似

> 凡是被这个 StatefulSet 管理的 Pod，都会声明一个对应的 PVC；
>
> 而这个 PVC 的定义，就来自于 volumeClaimTemplates 这个模板字段。
>
> 更重要的是，这个 PVC 的名字，会被分配一个与这个 Pod 完全一致的编号

这个自动创建的 PVC，与 PV 绑定成功后，就会进入 Bound 状态，这就意味着这个 Pod 可以挂载并使用这个 PV 了。



所以，在创建了 StatefulSet 之后，会看到k8s集群里出现了两个 PVC：

```bash
$ kubectl create -f statefulset.yaml
$ kubectl get pvc -l app=nginx
NAME        STATUS    VOLUME                                     CAPACITY   ACCESSMODES   AGE
www-web-0   Bound     pvc-15c268c7-b507-11e6-932f-42010a800002   1Gi        RWO           48s
www-web-1   Bound     pvc-15c79307-b507-11e6-932f-42010a800002   1Gi        RWO           48s
```

这些 PVC，都以`“<PVC名字>-<StatefulSet名字>-< 编号 >”`的方式命名，并且处于 Bound 状态。



这个 StatefulSet 创建出来的所有 Pod，都会声明使用编号的 PVC。

> 比如，在名叫 web-0 的 Pod 的 volumes 字段，它会声明使用名叫 www-web-0 的 PVC，从而挂载到这个 PVC 所绑定的 PV。



使用如下所示的命令，在 Pod 的 Volume 目录里写入一个文件，来验证一下上述 Volume 的分配情况

```bash
$ for i in 0 1; do kubectl exec web-$i -- sh -c 'echo hello $(hostname) > /usr/share/nginx/html/index.html'; done
```

如上所示，通过 kubectl exec 指令，在每个 Pod 的 Volume 目录里，写入了一个 index.html 文件。这个文件的内容，正是 Pod 的 hostname。比如，我们在 web-0 的 index.html 里写入的内容就是"hello web-0"。



此时，如果在这个 Pod 容器里访问“http://localhost”，你实际访问到的就是 Pod 里 Nginx 服务器进程，而它会为你返回 /usr/share/nginx/html/index.html 里的内容。这个操作的执行方法如下所示：

```bash
$ for i in 0 1; do kubectl exec -it web-$i -- curl localhost; done
hello web-0
hello web-1
```

如果使用 kubectl delete 命令删除这两个 Pod，这些 Volume 里的文件会不会丢失呢？

```bash
$ kubectl delete pod -l app=nginx
pod "web-0" deleted
pod "web-1" deleted
```

可以看到，在被删除之后，这两个 Pod 会被按照编号的顺序被重新创建出来。而这，如果在新创建的容器里通过访问“http://localhost”的方式去访问 web-0 里的 Nginx 服务：

```bash
# 在被重新创建出来的Pod容器里访问http://localhost
$ kubectl exec -it web-0 -- curl localhost
hello web-0
```

就会发现，这个请求依然会返回：hello web-0。也就是说，原先与名叫 web-0 的 Pod 绑定的 PV，在这个 Pod 被重新创建之后，`依然同新的名叫 web-0 的 Pod 绑定在了一起`。对于 Pod web-1 来说，也是完全一样的情况。



**这是怎么做到的呢？**

分析一下 StatefulSet 控制器恢复这个 Pod 的过程，就可以很容易理解了。



1. 首先，当把一个 Pod，比如 web-0，删除之后，这个 Pod 对应的 PVC 和 PV，`并不会被删除`，而这个 Volume 里已经写入的数据，也依然会保存在远程存储服务里（比如，我们在这个例子里用到的 Ceph 服务器）



2. 此时，StatefulSet 控制器发现，一个名叫 web-0 的 Pod 消失了。所以，控制器就会重新创建一个新的、名字还是叫作 web-0 的 Pod 来，“纠正”这个不一致的情况



3. 需要注意的是，在这个新的 Pod 对象的定义里，它声明使用的 PVC 的名字，还是叫作：www-web-0。这个 PVC 的定义，还是来自于 PVC 模板（volumeClaimTemplates），这是 StatefulSet 创建 Pod 的标准流程

   

4. 所以，在这个新的 web-0 Pod 被创建出来之后，Kubernetes 为它查找名叫 www-web-0 的 PVC 时，就会直接找到旧 Pod 遗留下来的同名的 PVC，进而找到跟这个 PVC 绑定在一起的 PV

   

5. 这样，新的 Pod 就可以挂载到旧 Pod 对应的那个 Volume，并且获取到保存在 Volume 里的数据



**通过这种方式，k8s 的 StatefulSet 就实现了对应用存储状态的管理。**



## StatefulSet的工作原理

**StatefulSet 的工作原理**

1. 首先，StatefulSet 的控制器直接管理的是 Pod

> 这是因为，StatefulSet 里的不同 Pod 实例，不再像 ReplicaSet 中那样都是完全一样的，而是有了细微区别的。
>
> 比如，每个 Pod 的 hostname、名字等都是不同的、携带了编号的。而 StatefulSet 区分这些实例的方式，就是通过在 Pod 的名字里加上事先约定好的编号。

2. 其次，Kubernetes 通过 Headless Service，为这些有编号的 Pod，在 DNS 服务器中生成带有同样编号的 DNS 记录

> 只要 StatefulSet 能够保证这些 Pod 名字里的编号不变，那么 Service 里类似于 web-0.nginx.default.svc.cluster.local 这样的 DNS 记录也就不会变，而这条记录解析出来的 Pod 的 IP 地址，则会随着后端 Pod 的删除和再创建而自动更新。这当然是 Service 机制本身的能力，不需要 StatefulSet 操心

3. 最后，StatefulSet 还为每一个 Pod 分配并创建一个同样编号的 PVC

> 这样，Kubernetes 就可以通过 Persistent Volume 机制为这个 PVC 绑定上对应的 PV，从而保证了每一个 Pod 都拥有一个独立的 Volume



**在这种情况下，即使 Pod 被删除，它所对应的 PVC 和 PV 依然会保留下来。**所以当这个 Pod 被重新创建出来之后，Kubernetes 会为它找到同样编号的 PVC，挂载这个 PVC 对应的 Volume，从而获取到以前保存在 Volume 里的数据。



## StatefulSet滚动更新流程

1. 只要修改 StatefulSet 的 Pod 模板，就会自动触发StatefulSet的“滚动更新”

```bash
$ kubectl patch statefulset mysql --type='json' -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/image", "value":"mysql:5.7.23"}]'
statefulset.apps/mysql patched
```

**kubectl patch 命令**：

表示以“补丁”的方式（JSON 格式）修改一个 API 对象的指定字段（即后面指定的`“spec/template/spec/containers/0/image”`）



2. 此时StatefulSet Controller 就会按照与` Pod 编号相反`的顺序，从最后一个 Pod 开始，逐一更新这个 StatefulSet 管理的每个 Pod

   

3. 如果更新发生了错误，这次“滚动更新”就会停止



## 更精细的控制(金丝雀/灰度发布)

StatefulSet 的“滚动更新”可以进行更精细的控制，比如`金丝雀发布（Canary Deploy）或者灰度发布`。



这意味着应用的多个实例中被指定的一部分不会被更新到最新的版本。

> 通过 StatefulSet 的 spec.updateStrategy.rollingUpdate 的 partition 字段控制



比如，将前面这个 StatefulSet 的 partition 字段设置为 2：

```bash
$ kubectl patch statefulset mysql -p '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"partition":2}}}}'
statefulset.apps/mysql patched
```

kubectl patch后面的参数（JSON 格式的），就是 partition 字段在 API 对象里的路径。

> 上述操作等同于直接使用 kubectl edit 命令，打开这个对象，把 partition 字段修改为 2

表示当 Pod 模板发生变化时，比如 MySQL 镜像更新到 5.7.23，那么只有序号大于或者等于 2 的 Pod 会被更新到这个版本。并且，如果你删除或者重启了序号小于 2 的 Pod，等它再次启动后，也会保持原先的 5.7.2 版本，绝不会被升级到 5.7.23 版本。

