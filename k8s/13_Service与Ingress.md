# Service

## 为什么要Service

1. Pod的IP不是固定的，对一组pod进行聚合，并且提供一个统一的外部接口地址
2. 一组Pod实例之间会有负载均衡的需求（Label selector）



# Service实现原理

实际上，Service是由` kube-proxy 组件`，加上 `iptables `来共同实现的。



每个节点都运行一个 `kube-proxy` 服务进程，它是真正起到转发数据作用。



当创建 `service` 后， `API Service` 会监听 `service` ，然后把service信息写入 `etcd` ，`kube-proxy` 会监听 `etcd` 中 `service` 的信息并且将 `service` 信息转发成对应的访问规则。

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/service_kube-proxy.drawio%20(1).png)





## kube-proxy支持三种代理模式

### userspace用户空间

当创建 `Service` 时，Kubernetes master 会给它指派一个virtual IP 地址(比如 10.0.0.1)， 假设 `Service` 的端口是 80，该 `Service` 会被集群中所有的 `kube-proxy` 实例监听到，kube-proxy会打开一个新的端口，建立一个从该 VIP 重定向到新端口的 iptables，并开始接收请求连接。



当一个客户端连接到一个 VIP，iptables 规则开始起作用，它会重定向该数据包到 `Service代理` 的端口。 Service 选择一个Pod，并将客户端的流量代理到Pod上。

这意味着 `Service` 的所有者能够选择任何他们想使用的端口，而不存在冲突的风险。 



在该模式下 `kube-proxy` 会为每一个 `service` 创建一个监听端口,发送给 `Cluseter IP` 请求会被 `iptable` 重定向给 `kube-proxy` 监听的端口上,其中 `kube-proxy` 会根据 `LB` 算法将请求转发到相应的pod之上。



该模式下，kube-proxy充当了一个四层负载均衡器的角色。由于kube-proxy运行在userspace中，在进行转发处理的时候会增加内核和用户空间之间的数据拷贝，虽然比较稳定，但是效率非常低下。

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/username.drawio.png)



### iptables模式

iptables模式下 `kube-proxy` 为每一个pod创建相对应的 `iptables` 规则,发送给 `ClusterIP` 的请求会被直接发送给后端pod之上。

在该模式下 `kube-proxy` 不承担负载均衡器的角色,其只会负责创建相应的转发策略,该模式的优点在于较userspace模式效率更高,但是不能提供灵活的LB策略，当后端Pod不可用的时候无法进行重试。

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/iptables.drawio.png)



**例子**

对于上面创建的名叫 hostnames 的 Service 来说，一旦它被提交给k8s，那么 kube-proxy 就可以通过 Service 的 Informer 感知到这样一个 Service 对象的添加。

而作为对这个事件的响应，它会在宿主机上`创建这样一条 iptables 规则`（可以通过 iptables-save 看到它），如下所示：

```bash
-A KUBE-SERVICES -d 10.0.1.175/32 -p tcp -m comment --comment "default/hostnames: cluster IP" -m tcp --dport 80 -j KUBE-SVC-NWV5X2332I4OT4T3
```

这条 iptables 规则的含义是：

凡是目的地址是 10.0.1.175、目的端口是 80 的 IP 包，都应该`跳转到另外一条名叫 KUBE-SVC-NWV5X2332I4OT4T3 的 iptables 链`进行处理。



而前面已经看到，10.0.1.175 正是这个 Service 的 VIP。所以这一条规则，`就为这个Service设置了一个固定的入口地址`。并且，由于 10.0.1.175 只是一条 iptables 规则上的配置，并没有真正的网络设备，所以你 ping 这个地址，是不会有任何响应的。



**那么，我们即将跳转到的 KUBE-SVC-NWV5X2332I4OT4T3 规则，又有什么作用呢？**

实际上，它是一组规则的集合，如下所示：

```bash
-A KUBE-SVC-NWV5X2332I4OT4T3 -m comment --comment "default/hostnames:" -m statistic --mode random --probability 0.33332999982 -j KUBE-SEP-WNBA2IHDGP2BOBGZ

-A KUBE-SVC-NWV5X2332I4OT4T3 -m comment --comment "default/hostnames:" -m statistic --mode random --probability 0.50000000000 -j KUBE-SEP-X3P2623AGDH6CDF3

-A KUBE-SVC-NWV5X2332I4OT4T3 -m comment --comment "default/hostnames:" -j KUBE-SEP-57KPRZ3JQVENLNBR
```

这一组规则，实际上是一组`随机模式（–mode random）的 iptables 链`。



而随机转发的目的地，分别是 KUBE-SEP-WNBA2IHDGP2BOBGZ、KUBE-SEP-X3P2623AGDH6CDF3 和 KUBE-SEP-57KPRZ3JQVENLNBR。

而这三条链指向的`最终目的地`，其实就是这个 Service 代理的三个 Pod。所以这一组规则，就是 Service 实现负载均衡的位置。



注意：iptables 规则的匹配是`从上到下`逐条进行的，所以为了保证上述三条规则每条被选中的概率都相同，要将它们的 probability 字段的值分别设置为 1/3（0.333…）、1/2 和 1。

> 这么设置的原理很简单：第一条规则被选中的概率就是 1/3；而如果第一条规则没有被选中，那么这时候就只剩下两条规则了，所以第二条规则的 probability 就必须设置为 1/2；类似地，最后一条就必须设置为 1。



通过查看上述三条链的明细，就很容易理解 Service 进行转发的具体原理了，如下所示：

```bash
-A KUBE-SEP-57KPRZ3JQVENLNBR -s 10.244.3.6/32 -m comment --comment "default/hostnames:" -j MARK --set-xmark 0x00004000/0x00004000
-A KUBE-SEP-57KPRZ3JQVENLNBR -p tcp -m comment --comment "default/hostnames:" -m tcp -j DNAT --to-destination 10.244.3.6:9376

-A KUBE-SEP-WNBA2IHDGP2BOBGZ -s 10.244.1.7/32 -m comment --comment "default/hostnames:" -j MARK --set-xmark 0x00004000/0x00004000
-A KUBE-SEP-WNBA2IHDGP2BOBGZ -p tcp -m comment --comment "default/hostnames:" -m tcp -j DNAT --to-destination 10.244.1.7:9376

-A KUBE-SEP-X3P2623AGDH6CDF3 -s 10.244.2.3/32 -m comment --comment "default/hostnames:" -j MARK --set-xmark 0x00004000/0x00004000
-A KUBE-SEP-X3P2623AGDH6CDF3 -p tcp -m comment --comment "default/hostnames:" -m tcp -j DNAT --to-destination 10.244.2.3:9376
```

可以看到，这三条链，其实是`三条 DNAT 规则`。但在 DNAT 规则之前，iptables 对流入的 IP 包还设置了一个“标志”（–set-xmark）。



**而DNAT规则的作用：**

就是在 PREROUTING 检查点之前，也就是在路由之前，将流入 IP 包的目的地址和端口，改成–to-destination 所指定的新的目的地址和端口。可以看到，这个目的地址和端口，正是被代理 Pod 的 IP 地址和端口。



这样，访问 Service VIP 的 IP 包经过上述 iptables 处理之后，就已经变成了访问具体某一个后端 Pod 的 IP 包了。这些 Endpoints 对应的 iptables 规则，正是 kube-proxy 通过监听 Pod 的变化事件，在宿主机上生成并维护的。



### IPVS模式

ipvs模式与iptable模式类型, `kube-proxy` 会根据pod的变化创建相应的 `ipvs` 转发规则,ipvs相对iptable来说转发效率更加高效,同时提供了大量的负责均衡算法。

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/ipvx.drawio.png)



其实，可以看到，kube-proxy 通过 iptables 处理 Service 的过程，其实需要在宿主机上设置相当多的 iptables 规则。而且，kube-proxy 还需要在控制循环里不断地刷新这些规则来确保它们始终是正确的。

> 使用ipvs模式必须安装ipvs内核模块,否则会自动降级为iptables

```bash
# 编辑配置文件 搜索43行mode将其修改为ipvs
kubectl edit cm kube-proxy -n kube-system

# 删除原有的代理
 kubectl delete pod -l k8s-app=kube-proxy -n kube-system

# 查看
 ipvsadm -Ln
```





当你的宿主机上有大量 Pod 时，成百上千条 iptables 规则不断地被刷新，`会大量占用该宿主机的 CPU 资源`，甚至会让宿主机“卡”在这个过程中。所以说，**一直以来，基于 iptables 的 Service 实现，都是制约k8s项目承载更多量级的 Pod 的主要障碍。**

> 而 IPVS 模式的 Service，就是解决这个问题的一个行之有效的方法。



**IPVS 模式的工作原理，其实跟 iptables 模式类似**

当创建了前面的 Service 之后，kube-proxy 首先会在宿主机上创建一个虚拟网卡（叫作：kube-ipvs0），并为它分配 Service VIP 作为 IP 地址，如下所示：

```bash
# ip addr
  ...
  73：kube-ipvs0：<BROADCAST,NOARP>  mtu 1500 qdisc noop state DOWN qlen 1000
  link/ether  1a:ce:f5:5f:c1:4d brd ff:ff:ff:ff:ff:ff
  inet 10.0.1.175/32  scope global kube-ipvs0
  valid_lft forever  preferred_lft forever
```

接下来，kube-proxy 就会通过 Linux 的 IPVS 模块，为这个 IP 地址设置三个 IPVS 虚拟主机，并设置这三个虚拟主机之间使用轮询模式 (rr) 来作为负载均衡策略。



可以通过 ipvsadm 查看到这个设置，如下所示：

```bash
# ipvsadm -ln
 IP Virtual Server version 1.2.1 (size=4096)
  Prot LocalAddress:Port Scheduler Flags
    ->  RemoteAddress:Port           Forward  Weight ActiveConn InActConn     
  TCP  10.102.128.4:80 rr
    ->  10.244.3.6:9376    Masq    1       0          0         
    ->  10.244.1.7:9376    Masq    1       0          0
    ->  10.244.2.3:9376    Masq    1       0          0
```

可以看到，这三个 IPVS 虚拟主机的 IP 地址和端口，对应的正是三个被代理的 Pod。



这时，任何发往 10.102.128.4:80 的请求，就都会被 IPVS 模块转发到某一个后端 Pod 上了。



而相比于 iptables，IPVS 在内核中的实现其实也是基于 Netfilter 的 NAT 模式，所以在转发这一层上，理论上 IPVS 并没有显著的性能提升。但是，IPVS 并不需要在宿主机上为每个 Pod 设置 iptables 规则，而是把对这些“规则”的处理放到了`内核态`，从而极大地降低了维护这些规则的代价。



注意：IPVS 模块只负责上述的负载均衡和代理功能。而一个完整的 Service 流程正常工作所需要的包过滤、SNAT 等操作，还是要靠 iptables 来实现。只不过，这些辅助性的 iptables 规则数量有限，也不会随着 Pod 数量的增加而增加。

所以，在大规模集群里，建议你为 kube-proxy 设置–proxy-mode=ipvs 来开启这个功能。它为k8s集群规模带来的提升，还是非常巨大的。



# Service与DNS 的关系

在k8s中，Service 和 Pod 都会被分配对应的 DNS A 记录（从域名解析 IP 的记录）。



## **ClusterIP模式的Service**

对于 ClusterIP 模式的 Service 

1. 它的 A 记录的格式是：..svc.cluster.local。当你访问这条 A 记录时，它解析到的就是`该 Service 的 VIP 地址`

2. 它代理的 Pod 被自动分配的 A 记录的格式是：..pod.cluster.local。这条记录指向 Pod 的 IP 地址



## **Headless Service**

对于指定了 clusterIP=None 的 Headless Service 

1. 它的 A 记录的格式也是：..svc.cluster.local。但是，当你访问这条 A 记录时，它返回的是`所有被代理的 Pod 的 IP 地址的集合`。当然，如果你的客户端没办法解析这个集合的话，它可能会只会拿到第一个 Pod 的 IP 地址。

2. 它代理的 Pod 被自动分配的 A 记录的格式是：...svc.cluster.local。这条记录也指向 Pod 的 IP 地址



但如果你为 Pod 指定了 Headless Service，并且 Pod 本身声明了 hostname 和 subdomain 字段，那么这时 Pod 的 A 记录就会变成：<pod的hostname>...svc.cluster.local，比如：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: default-subdomain
spec:
  selector:
    name: busybox
  clusterIP: None
  ports:
  - name: foo
    port: 1234
    targetPort: 1234
---
apiVersion: v1
kind: Pod
metadata:
  name: busybox1
  labels:
    name: busybox
spec:
  hostname: busybox-1
  subdomain: default-subdomain
  containers:
  - image: busybox
    command:
      - sleep
      - "3600"
    name: busybox
```

上面这个 Service 和 Pod 被创建之后，可以通过 busybox-1.default-subdomain.default.svc.cluster.local 解析到这个 Pod 的 IP 地址。



需要注意的是，在k8s里，/etc/hosts 文件是单独挂载的，这也是为什么 kubelet 能够对 hostname 进行修改并且 Pod 重建后依然有效的原因。这跟 Docker 的 Init 层是一个原理。



# k8s支持的4种Service

**注意：Service的访问信息在k8s集群之外，其实是无效的。**



**什么是Service 的访问入口**

就是每台宿主机上由 kube-proxy 生成的 iptables 规则，以及 kube-dns 生成的 DNS 记录。而一旦离开了这个集群，这些信息对用户来说，也就自然没有作用了。



参考：

https://zhuanlan.zhihu.com/p/157565821

https://www.cnblogs.com/SR-Program/p/15574213.html



## 第1种：ClusterIP

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/clusterIP.drawio%20(1).png)

1、定义Deployment先创建3个Pod，如下所示：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hostnames
spec:
  selector:
    matchLabels:
      app: hostnames
  replicas: 3
  template:
    metadata:
      labels:
        app: hostnames
    spec:
      containers:
      - name: hostnames
        image: k8s.gcr.io/serve_hostname
        ports:
        - containerPort: 9376
          protocol: TCP
```

这个pod的作用是每次访问 9376 端口时，返回它自己的 hostname



2、创建如下Service（ClusterIP模式）

```yaml
apiVersion: v1
kind: Service
metadata:
  name: hostnames
spec:
  selector:
    app: hostnames # 这个Service只代理携带了 app=hostnames 标签的Pod
  type: ClusterIP  
  # clusterIP: 10.244.5.1 # service IP地址，如果不写默认会生成一个
  # sessionAffinity: ClientIP # 修改分发策略为基于客户端地址的会话保持模式
  ports:
  - name: default
    protocol: TCP
    port: 80
    targetPort: 9376 # 这个service的80端口代理Pod的9376端口
```

使用 `kuebctl get svc` 可以查看service的信息。



这种类型的service 只能在集群内访问。



### Endpoints

被selector选中的Pod，称为` Service 的 Endpoints`。



Endpoint是k8s中的一个资源对象，存储在etcd中，用来记录一个service对应的所有Pod的访问地址，它是根据service配置文件中的selector描述产生的。

一个service由一组Pod组成，这些Pod通过Endpoints暴露出来，Endpoints是实现实际服务的端点集合。换言之，service和Pod之间的联系是通过Endpoints实现的。



![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/endpoint.drawio.png)





使用kubectl get ep查看：

```bash
$ kubectl get endpoints hostnames
NAME        ENDPOINTS
hostnames   10.244.0.5:9376,10.244.0.6:9376,10.244.0.7:9376
```

注意：只有处于 Running 状态，且 readinessProbe 检查通过的 Pod，才会出现在 Service 的 Endpoints 列表里。并且，当某一个 Pod 出现问题时，k8s会自动把它从 Service 里摘除掉。



此时，通过该 Service 的 VIP 地址 10.0.1.175，就可以访问到它所代理的 Pod 了。

> 这个VIP 地址是 k8s 自动为 Service 分配的

```bash
# 查看名为hostnames的service的信息
$ kubectl get svc hostnames
NAME        TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
hostnames   ClusterIP   10.0.1.175   <none>        80/TCP    5s

# 集群内任意一个节点访问
$ curl 10.0.1.175:80
hostnames-0uton

$ curl 10.0.1.175:80
hostnames-yp2kp

$ curl 10.0.1.175:80
hostnames-bvc05
```

通过3次连续不断地访问 Service 的 VIP 地址和代理端口 80，它依次返回了三个 Pod 的 hostname。 Service 提供的是 Round Robin 方式的负载均衡，这种方式，称为：`ClusterIP 模式的 Service`。



#### 负载分发策略

对Service的访问被分发到了后端的Pod上去，目前k8s提供了两种负载分发策略：

- 如果不定义，默认使用kube-proxy的策略，比如随机、轮询等。
- 基于客户端地址的会话保持模式，即来自同一个客户端发起的所有请求都会转发到固定的一个Pod上，这对于传统基于Session的认证项目来说很友好，此模式可以在spec中添加`sessionAffinity: ClusterIP`选项。





### **Headless Service**

在某些场景中，开发人员可能不想使用Service提供的负载均衡功能，而希望自己来控制负载均衡策略，针对这种情况，k8s提供了HeadLinesss Service，这类Service不会分配Cluster IP，如果想要访问Service，只能通过Service的域名进行查询。



```yaml
apiVersion: v1
kind: Service
metadata:
  name: hostnames
spec:
  selector:
    app: hostnames # 这个Service只代理携带了 app=hostnames 标签的Pod
  type: ClusterIP  
  clusterIP: None # 将clusterIP设置为None，即可创建headliness Service
  ports:
  - name: default
    protocol: TCP
    port: 80
    targetPort: 9376 # 这个service的80端口代理Pod的9376端口
```



**如何从外部（k8s 集群之外），访问到 k8s 里创建的 Service？有如下3种方式**

## 第2种：NodePort类型Service

NodePort service会将service 的端口与 node 的端口进行映射,当我们访问 node 的 `IP + Port` 即为访问 service 所对应的资源。



![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/nodeport.drawio.png)

### API定义

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-nginx
  labels:
    run: my-nginx
spec:
  type: NodePort # 这个service类型是NodePort类型
  ports:
  - nodePort: 8080
    targetPort: 80 # service的8080端口代理Pod的80端口
    protocol: TCP
    name: http
  - nodePort: 443 # service的443端口代理Pod的443端口
    protocol: TCP
    name: https
  selector:
    run: my-nginx
```

在 ports 字段里声明了 Service 的 8080 端口代理 Pod 的 80 端口，Service 的 443 端口代理 Pod 的 443 端口。

> 如果不显式地声明 nodePort 字段，k8s 会`分配随机的可用端口`来设置代理。这个端口的范围默认是 30000-32767，可以通过 kube-apiserver 的–service-node-port-range 参数来修改它。

这时要访问这个 Service，就可以访问到`某一个被代理的Pod`的 80 端口了，如下所示：

```bash
<任何一台宿主机的IP地址>:8080
```



显然，kube-proxy 要做的就是在每台`宿主机`上生成这样一条 iptables 规则：

```bash
-A KUBE-NODEPORTS -p tcp -m comment --comment "default/my-nginx: nodePort" -m tcp --dport 8080 -j KUBE-SVC-67RL4FN6JRUPOJYM
```

`KUBE-SVC-67RL4FN6JRUPOJYM `其实就是一组随机模式的 iptables 规则。所以接下来的流程，就跟 ClusterIP 模式完全一样了



### SNAT操作

注意：在 NodePort 方式下，k8s会在 IP 包离开宿主机发往目的 Pod 时，对这个 IP 包做一次 SNAT 操作，如下所示：

```bash
-A KUBE-POSTROUTING -m comment --comment "kubernetes service traffic requiring SNAT" -m mark --mark 0x4000/0x4000 -j MASQUERADE
```

这条规则设置在 POSTROUTING 检查点，也就是说，它给即将离开这台主机的 IP 包，进行了一次 SNAT 操作，将这个 IP 包的`源地址`替换成了这台宿主机上的 `CNI 网桥地址`，或者`宿主机本身的 IP 地址`（如果 CNI 网桥不存在的话）。



当然，这个 SNAT 操作只需要对 Service 转发出来的 IP 包进行（否则普通的 IP 包就被影响了）。而 iptables 做这个判断的依据，就是查看该 IP 包是否有一个“0x4000”的“标志”。这个标志正是在 IP 包被执行 DNAT 操作之前被打上去的。



### 为什么一定要对流出的包做 SNAT操作

原理其实很简单，如下所示：

```bash
           client
             \ ^
              \ \
               v \
   node 1 <--- node 2
    | ^   SNAT
    | |   --->
    v |
 endpoint
```

当一个外部的 client 通过 node 2 的地址访问一个 Service 时，node 2 上的负载均衡规则，就可能把这个 IP 包转发给一个在 node 1 上的 Pod。

> 而当 node 1 上的这个 Pod 处理完请求之后，它就会按照这个 IP 包的源地址发出回复。

可是，如果没有做 SNAT 操作的话，这时，被转发来的 IP 包的源地址就是 client 的 IP 地址。**所以此时，Pod 就会直接将回复发给client。**对于 client 来说，它的请求明明发给了 node 2，收到的回复却来自 node 1，这个 client 很可能会报错。



所以，在上流程图中，当 IP 包离开 node 2 之后，它的源 IP 地址就会被 SNAT 改成 node 2 的 CNI 网桥地址或者 node 2 自己的地址。这样，Pod 在处理完成之后就会先回复给 node 2（而不是 client），然后再由 node 2 发送给 client。



当然，这也就意味着这个 Pod 只知道该 IP 包来自于 node 2，而不是外部的 client。

> 对于 Pod 需要明确知道所有请求来源的场景来说，这是不可以的。

所以这时，你就可以将 Service 的` spec.externalTrafficPolicy `字段设置为 local，这就保证了所有 Pod 通过 Service 收到请求之后，一定可以看到真正的、外部 client 的源地址。



而这个机制的实现原理也非常简单：

**这时，一台宿主机上的 iptables 规则，会设置为只将 IP 包转发给运行在这台宿主机上的 Pod。**所以这时，Pod 就可以直接使用源地址将回复包发出，不需要事先进行 SNAT 了。



这个流程，如下所示：

```bash
       client
       ^ /   \
      / /     \
     / v       X
   node 1     node 2
    ^ |
    | |
    | v
 endpoint
```

当然，这也就意味着如果在一台宿主机上，没有任何一个被代理的 Pod 存在，比如上图中的 node 2，那么你使用 node 2 的 IP 地址访问这个 Service，就是无效的。此时，你的请求会直接被 DROP 掉。



## 第3种：LoadBalancer类型的Service

从外部访问 Service 的第二种方式，适用于公有云上的 Kubernetes 服务。

### API定义

指定一个 LoadBalancer 类型的 Service，如下所示：

```yaml
kind: Service
apiVersion: v1
metadata:
  name: example-service
spec:
  ports:
  - port: 8765
    targetPort: 9376
  selector:
    app: example
  type: LoadBalancer
```

在公有云提供的 k8s 服务里，都使用了一个叫作 CloudProvider 的转接层，来跟公有云本身的 API 进行对接。



在上述 LoadBalancer 类型的 Service 被提交后，k8s 就会调用 CloudProvider 在公有云上为你创建一个`负载均衡服务`，并且把被代理的 Pod 的 IP 地址配置给负载均衡服务做后端。

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/20220423183632.png)



## 第4种：ExternalName类型的Service

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/20220423184059.png)



ExternalName类型的Service用于引入集群外部的服务，它通过externalName属性指定一个服务的地址，然后在集群内部访问此Service就可以访问到外部的服务了。



### API定义

第三种方式，是 k8s 在 1.7 之后支持的一个新特性，叫作 ExternalName。如下所示：

```yaml
kind: Service
apiVersion: v1
metadata:
  name: my-service
spec:
  type: ExternalName
  externalName: my.database.example.com
```

在上述 Service 的 YAML 文件中，指定了一个 externalName=my.database.example.com 的字段。



**注意：**这个 YAML 文件里不需要指定 selector



这时，当你通过 Service 的 DNS 名字访问它时，比如访问：my-service.default.svc.cluster.local。

那么，k8s返回的就是my.database.example.com。



所以说，ExternalName 类型的 Service，其实是在 kube-dns 里为你添加了一条 CNAME 记录。这时，访问 my-service.default.svc.cluster.local 就和访问 my.database.example.com 这个域名是一个效果了。



此外，k8s 的 Service 还允许你为 Service 分配`公有 IP 地址`，如下：

```yaml
kind: Service
apiVersion: v1
metadata:
  name: my-service
spec:
  selector:
    app: MyApp
  ports:
  - name: http
    protocol: TCP
    port: 80
    targetPort: 9376
  externalIPs:
  - 80.11.12.10
```

上述Service指定的 externalIPs=80.11.12.10，那么此时，就可以通过访问 80.11.12.10:80 访问到被代理的 Pod 了。不过，在这里 k8s 要求 externalIPs 必须是至少能够路由到一个 Kubernetes 的节点。



实际上，很多与 Service 相关的问题，其实都可以通过分析 Service 在宿主机上对应的 iptables 规则（或者 IPVS 配置）得到解决。



## 实践总结

### 问题1

**问题：当你的 Service 没办法通过 DNS 访问到时**

此时需要区分到底是 Service 本身的配置问题，还是集群的 DNS 出了问题？

1. 一个有效的方法，就是检查 Kubernetes 自己的` Master 节点的 Service DNS `是否正常

```bash
# 在一个Pod里执行
$ nslookup kubernetes.default
Server:    10.0.0.10
Address 1: 10.0.0.10 kube-dns.kube-system.svc.cluster.local

Name:      kubernetes.default
Address 1: 10.0.0.1 kubernetes.default.svc.cluster.local
```

2. 如果上面访问 kubernetes.default 返回的值都有问题，那就需要`检查 kube-dns 的运行状态和日志了`。否则的话，应该去检查自己的` Service 定义`是不是有问题。



3. 而如果你的 Service 没办法通过 ClusterIP 访问到时，首先应该`检查的是这个 Service 是否有 Endpoints`

```bash
$ kubectl get endpoints hostnames
NAME        ENDPOINTS
hostnames   10.244.0.5:9376,10.244.0.6:9376,10.244.0.7:9376
```

注意：如果 Pod 的 readniessProbe 没通过，它也不会出现在 Endpoints 列表里。



4. 而如果 Endpoints 正常，那么就需要确认 kube-proxy 是否在正确运行。

在我们通过 kubeadm 部署的集群里，你应该看到 kube-proxy 输出的日志如下所示

```bash
I1027 22:14:53.995134    5063 server.go:200] Running in resource-only container "/kube-proxy"
I1027 22:14:53.998163    5063 server.go:247] Using iptables Proxier.
I1027 22:14:53.999055    5063 server.go:255] Tearing down userspace rules. Errors here are acceptable.
I1027 22:14:54.038140    5063 proxier.go:352] Setting endpoints for "kube-system/kube-dns:dns-tcp" to [10.244.1.3:53]
I1027 22:14:54.038164    5063 proxier.go:352] Setting endpoints for "kube-system/kube-dns:dns" to [10.244.1.3:53]
I1027 22:14:54.038209    5063 proxier.go:352] Setting endpoints for "default/kubernetes:https" to [10.240.0.2:443]
I1027 22:14:54.038238    5063 proxier.go:429] Not syncing iptables until Services and Endpoints have been received from master
I1027 22:14:54.040048    5063 proxier.go:294] Adding new service "default/kubernetes:https" at 10.0.0.1:443/TCP
I1027 22:14:54.040154    5063 proxier.go:294] Adding new service "kube-system/kube-dns:dns" at 10.0.0.10:53/UDP
I1027 22:14:54.040223    5063 proxier.go:294] Adding new service "kube-system/kube-dns:dns-tcp" at 10.0.0.10:53/TCP
```

5. 如果 kube-proxy 一切正常，就应该仔细查看宿主机上的 iptables 了。而一个 iptables 模式的 Service 对应的规则，它们包括：

* KUBE-SERVICES 或者 KUBE-NODEPORTS 规则对应的 Service 的入口链，这个规则应该与 VIP 和 Service 端口一一对应

* KUBE-SEP-(hash) 规则对应的 DNAT 链，这些规则应该与 Endpoints 一一对应

* KUBE-SVC-(hash) 规则对应的负载均衡链，这些规则的数目应该与 Endpoints 数目一致

* 如果是 NodePort 模式的话，还有 POSTROUTING 处的 SNAT 链



### 问题2

**问题：Pod 没办法通过 Service 访问到自己**

这往往就是因为 kubelet 的 hairpin-mode 没有被正确设置。只需要确保将 kubelet 的 hairpin-mode 设置为 hairpin-veth 或者 promiscuous-bridge 即可。



其中，在 hairpin-veth 模式下，你应该能看到 CNI 网桥对应的各个 VETH 设备，都将 Hairpin 模式设置为了 1，如下所示

```bash
$ for d in /sys/devices/virtual/net/cni0/brif/veth*/hairpin_mode; do echo "$d = $(cat $d)"; done
/sys/devices/virtual/net/cni0/brif/veth4bfbfe74/hairpin_mode = 1
/sys/devices/virtual/net/cni0/brif/vethfc2a18c5/hairpin_mode = 1
```

而如果是 promiscuous-bridge 模式的话，你应该看到 CNI 网桥的混杂模式（PROMISC）被开启，如下所示：

```bash
$ ifconfig cni0 |grep PROMISC
UP BROADCAST RUNNING PROMISC MULTICAST  MTU:1460  Metric:1
```



# Ingress负载均衡服务

## 什么是Ingress

LoadBalancer 类型的 Service，它会在Cloud Provider（比如：Google Cloud 或者 OpenStack）里创建一个与该 Service 对应的负载均衡服务。

> 由于每个 Service 都要有一个负载均衡服务，所以这个做法实际上既浪费成本又高。



作为用户，更希望看到 k8s 为我内置一个`全局的负载均衡器`。然后，通过我访问的 URL，把请求转发给不同的后端 Service。



这种全局的、为了代理不同后端 Service 而设置的负载均衡服务，就是k8s里的 Ingress 服务。



**所谓 Ingress，就是 Service 的“Service”。**



举个例子，假如现在有这样一个站点：https://cafe.example.com。

其中，https://cafe.example.com/coffee，对应的是“咖啡点餐系统”。

而，https://cafe.example.com/tea，对应的则是“茶水点餐系统”。

这两个系统，分别由名叫 coffee 和 tea 这样两个 Deployment 来提供服务



**如何能使用k8s的 Ingress 来创建一个统一的负载均衡器，从而实现当用户访问不同的域名时，能够访问到不同的 Deployment 呢？**





实际上 Ingress 类似于一个七层的负载均衡器,是由 K8S 对反向代理的抽象,其工作原理类似于 Nginx 可以理解为Ingress里面建立了诸多映射规则，Ingress Controller通过监听这些配置规则并转化为Nginx的反向代理配置，然后对外提供服务。

- Ingress:kubernetes中的一个对象，作用是定义请求如何转发到Service的规则。
- Ingress Controller:具体实现反向代理及负载均衡的程序，对Ingress定义的规则进行解析，根据配置的规则来实现请求转发，实现的方式有很多，比如Nginx，Contour，Haproxy等。
- 其工作原理如下
  - 用户编写 Ingress 规则说明那个域名对应那个 service
  - Ingress Contoller 动态感知 ingress 编写的规则,然后生成对应的反向代理规则
  - ingress 控制器会根据生成代理规则写入到代理服务中
  - 客户端请求代理服务,由代理服务转发到后端 pod 节点



![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/20220423184736.png)





## Ingress定义例子

上述功能，在k8s里就需要通过 Ingress 对象来描述，如下cafe-ingress.yaml 文件所示：

```yaml
apiVersion: extensions/v1beta1
kind: Ingress # Ingress服务
metadata:
  name: cafe-ingress
spec:
  tls:
  - hosts:
    - cafe.example.com
    secretName: cafe-secret
  rules:
  - host: cafe.example.com # Ingress的入口
    http:
      paths:
      - path: /tea # 每一个path对应后端一个Service
        backend:
          serviceName: tea-svc
          servicePort: 80
      - path: /coffee
        backend:
          serviceName: coffee-svc
          servicePort: 80
```

最值得关注的，是 rules 字段。在k8s里，这个字段叫作：IngressRule。



IngressRule 的 Key，就叫做：host。

> 它必须是一个标准的域名格式（Fully Qualified Domain Name）的字符串，而不能是 IP 地址。



而 host 字段定义的值，就是这个 Ingress 的入口。

> 当用户访问 cafe.example.com 时，实际上访问到的是这个 Ingress 对象。这样，Kubernetes 就能使用 IngressRule 来对你的请求进行下一步转发。



而接下来 IngressRule 规则的定义，则依赖于 path 字段。

> 可以简单地理解为，这里的每一个 path 都对应一个后端 Service。在上面的例子，定义了两个 path，它们分别对应 coffee 和 tea 这两个 Deployment 的 Service（即：coffee-svc 和 tea-svc）。



**所谓 Ingress 对象，其实就是k8s项目对“反向代理”的一种抽象。**



一个 Ingress 对象的主要内容，实际上就是一个`“反向代理”服务（比如：Nginx）的配置文件的描述`。而这个代理服务对应的转发规则，就是 IngressRule。



这就是为什么在每条 IngressRule 里，需要有一个 host 字段来作为这条 IngressRule 的入口，然后还需要有一系列 path 字段来声明具体的转发策略。这其实跟 Nginx、HAproxy 等项目的配置文件的写法是一致的。



而有了 Ingress 这样一个统一的抽象，k8s的用户就无需关心 Ingress 的具体细节了。



在实际的使用中，你只需要从社区里选择一个`具体的 Ingress Controller`，把它部署在k8s集群里即可。



然后，这个 Ingress Controller 会根据你定义的 Ingress 对象，提供对应的代理能力。目前，业界常用的各种反向代理项目，比如 Nginx、HAProxy、Envoy、Traefik 等，都已经为k8s专门维护了对应的 Ingress Controller。



## Nginx Ingress Controller

### 实践

以最常用的 Nginx Ingress Controller 为例，在我们前面用 kubeadm 部署的 Bare-metal 环境中，实践一下 Ingress 机制的使用过程。



#### 部署Nginx Ingress Controller

部署方法非常简单，如下所示：

```bash
$ kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/master/deploy/mandatory.yaml
```



其中，在mandatory.yaml文件里，是 Nginx 官方维护的 Ingress Controller 的定义，它的内容如下：

```yaml
kind: ConfigMap
apiVersion: v1
metadata:
  name: nginx-configuration
  namespace: ingress-nginx
  labels:
    app.kubernetes.io/name: ingress-nginx
    app.kubernetes.io/part-of: ingress-nginx
---
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: nginx-ingress-controller
  namespace: ingress-nginx
  labels:
    app.kubernetes.io/name: ingress-nginx
    app.kubernetes.io/part-of: ingress-nginx
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ingress-nginx
      app.kubernetes.io/part-of: ingress-nginx
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ingress-nginx
        app.kubernetes.io/part-of: ingress-nginx
      annotations:
        ...
    spec:
      serviceAccountName: nginx-ingress-serviceaccount
      containers:
        - name: nginx-ingress-controller
          image: quay.io/kubernetes-ingress-controller/nginx-ingress-controller:0.20.0
          args:
            - /nginx-ingress-controller
            - --configmap=$(POD_NAMESPACE)/nginx-configuration
            - --publish-service=$(POD_NAMESPACE)/ingress-nginx
            - --annotations-prefix=nginx.ingress.kubernetes.io
          securityContext:
            capabilities:
              drop:
                - ALL
              add:
                - NET_BIND_SERVICE
            # www-data -> 33
            runAsUser: 33
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: POD_NAMESPACE
            - name: http
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
          ports:
            - name: http
              containerPort: 80
            - name: https
              containerPort: 443
```

在上述 YAML 文件中，定义了一个使用 nginx-ingress-controller 镜像的 Pod。



需要注意的是，这个 Pod 的启动命令需要使用该 Pod 所在的 Namespace 作为参数。而这个信息，当然是通过 Downward API 拿到的，即：Pod 的 env 字段里的定义（env.valueFrom.fieldRef.fieldPath）。



而这个 Pod 本身，就是一个监听 Ingress 对象以及它所代理的后端 Service 变化的控制器。



当一个新的 Ingress 对象由用户创建后，nginx-ingress-controller 就会根据 Ingress 对象里定义的内容，`生成一份对应的 Nginx 配置文件（/etc/nginx/nginx.conf），并使用这个配置文件启动一个 Nginx 服务`。



而一旦 Ingress 对象被更新，nginx-ingress-controller 就会更新这个配置文件。

需要注意的是，如果这里只是被代理的 Service 对象被更新，nginx-ingress-controller 所管理的 Nginx 服务是不需要重新加载（reload）的。这当然是因为 nginx-ingress-controller 通过Nginx Lua方案实现了 Nginx Upstream 的动态配置。



此外，nginx-ingress-controller 还允许你通过 Kubernetes 的 ConfigMap 对象来对上述 Nginx 配置文件进行定制。这个 ConfigMap 的名字，需要以参数的方式传递给 nginx-ingress-controller。而你在这个 ConfigMap 里添加的字段，将会被合并到最后生成的 Nginx 配置文件当中。



**可以看到，一个 Nginx Ingress Controller 为你提供的服务，其实是一个可以根据 Ingress 对象和被代理后端 Service 的变化，来自动进行更新的 Nginx 负载均衡器。**



当然，为了让用户能够用到这个 Nginx，就需要创建一个 Service 来把 Nginx Ingress Controller 管理的 Nginx 服务暴露出去，如下所示：

```bash
$ kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/master/deploy/provider/baremetal/service-nodeport.yaml
```

由于我们使用的是 Bare-metal 环境，所以 service-nodeport.yaml 文件里的内容，就是一个 NodePort 类型的 Service，如下所示：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ingress-nginx
  namespace: ingress-nginx
  labels:
    app.kubernetes.io/name: ingress-nginx
    app.kubernetes.io/part-of: ingress-nginx
spec:
  type: NodePort
  ports:
    - name: http
      port: 80
      targetPort: 80
      protocol: TCP
    - name: https
      port: 443
      targetPort: 443
      protocol: TCP
  selector:
    app.kubernetes.io/name: ingress-nginx
    app.kubernetes.io/part-of: ingress-nginx
```

可以看到，这个 Service 的唯一工作，就是将所有携带 ingress-nginx 标签的 Pod 的 80 和 433 端口暴露出去。

> 而如果你是公有云上的环境，你需要创建的就是 LoadBalancer 类型的 Service 了。



**上述操作完成后，你一定要记录下这个 Service 的访问入口，即：宿主机的地址和 NodePort 的端口，**如下所示

```bash
$ kubectl get svc -n ingress-nginx
NAME            TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)                      AGE
ingress-nginx   NodePort   10.105.72.96   <none>        80:30044/TCP,443:31453/TCP   3h
```

为了后面方便使用，我会把上述访问入口设置为环境变量

```bash
$ IC_IP=10.168.0.2 # 任意一台宿主机的地址
$ IC_HTTPS_PORT=31453 # NodePort端口
```

在 Ingress Controller 和它所需要的 Service 部署完成后，我们就可以使用它了。

> 备注：这个“咖啡厅”Ingress 的所有示例文件，都在[这里](https://github.com/resouer/kubernetes-ingress/tree/master/examples/complete-example)。



#### 使用

首先，要在集群里部署我们的应用 Pod 和它们对应的 Service，如下所示：

```bash
$ kubectl create -f cafe.yaml
```

然后，需要创建 Ingress 所需的 SSL 证书（tls.crt）和密钥（tls.key），这些信息都是通过 Secret 对象定义好的，如下所示

```bash
$ kubectl create -f cafe-secret.yaml
```

这一步完成后，就可以创建前面一开始定义的示例 Ingress 对象了，如下所示：

```bash
$ kubectl create -f cafe-ingress.yaml
```

这时，可以查看一下这个 Ingress 对象的信息，如下所示：

```bash
$ kubectl get ingress
NAME           HOSTS              ADDRESS   PORTS     AGE
cafe-ingress   cafe.example.com             80, 443   2h

$ kubectl describe ingress cafe-ingress
Name:             cafe-ingress
Namespace:        default
Address:          
Default backend:  default-http-backend:80 (<none>)
TLS:
  cafe-secret terminates cafe.example.com
Rules:
  Host              Path  Backends
  ----              ----  --------
  cafe.example.com  
                    /tea      tea-svc:80 (<none>)
                    /coffee   coffee-svc:80 (<none>)
Annotations:
Events:
  Type    Reason  Age   From                      Message
  ----    ------  ----  ----                      -------
  Normal  CREATE  4m    nginx-ingress-controller  Ingress default/cafe-ingress
```

可以看到，这个 Ingress 对象最核心的部分，正是 Rules 字段。其中，定义的 Host 是cafe.example.com，它有两条转发规则（Path），分别转发给 tea-svc 和 coffee-svc。

> 当然，在 Ingress 的 YAML 文件里，你还可以定义多个 Host，比如restaurant.example.com、movie.example.com等等，来为更多的域名提供负载均衡服务。



接下来就可以通过访问这个 Ingress 的地址和端口，访问到我们前面部署的应用了，比如，当我们访问https://cafe.example.com:443/coffee时，应该是 coffee 这个 Deployment 负责响应我的请求。可以来尝试一下：

```bash
$ curl --resolve cafe.example.com:$IC_HTTPS_PORT:$IC_IP https://cafe.example.com:$IC_HTTPS_PORT/coffee --insecureServer address: 10.244.1.56:80
Server name: coffee-7dbb5795f6-vglbv
Date: 03/Nov/2018:03:55:32 +0000
URI: /coffee
Request ID: e487e672673195c573147134167cf898
```

可以看到，访问这个 URL 得到的返回信息是：Server name: coffee-7dbb5795f6-vglbv。这正是 coffee 这个 Deployment 的名字。



而当访问https://cafe.example.com:433/tea 时，则应该是 tea 这个 Deployment 负责响应我的请求（Server name: tea-7d57856c44-lwbnp），如下所示：

```bash
$ curl --resolve cafe.example.com:$IC_HTTPS_PORT:$IC_IP https://cafe.example.com:$IC_HTTPS_PORT/tea --insecure
Server address: 10.244.1.58:80
Server name: tea-7d57856c44-lwbnp
Date: 03/Nov/2018:03:55:52 +0000
URI: /tea
Request ID: 32191f7ea07cb6bb44a1f43b8299415c
```

可以看到，Nginx Ingress Controller 为我们创建的 Nginx 负载均衡器，已经成功地将请求转发给了对应的后端 Service。



以上，就是k8s里 Ingress 的设计思想和使用方法了。



#### 问题

**如果我的请求没有匹配到任何一条 IngressRule，那么会发生什么呢？**

首先，既然 Nginx Ingress Controller 是用 Nginx 实现的，那么它当然会为你返回一个 Nginx 的 404 页面。



不过，Ingress Controller 也允许你通过 Pod 启动命令里的–default-backend-service 参数，设置一条默认规则，比如：–default-backend-service=nginx-default-backend。



这样，任何匹配失败的请求，就都会被转发到这个名叫 nginx-default-backend 的 Service。所以，你就可以通过部署一个专门的 Pod，来为用户返回自定义的 404 页面了。



参考

https://zhuanlan.zhihu.com/p/157565821

https://www.cnblogs.com/SR-Program/p/15574213.html