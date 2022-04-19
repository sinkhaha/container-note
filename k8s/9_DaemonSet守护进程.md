# DaemonSet

DaemonSet的主要作用，是在k8s集群里，运行一个 Daemon Pod。



## Daemon Pod特征

1. 这个Pod运行在k8s集群里的每一个节点（Node）上

2. 且每个节点上只有一个这样的Pod

3. 当有新节点加入k8s集群后，该 Pod 会自动地在新节点上被创建出来；而当旧节点被删除后，节点上的 Pod 也相应地会被回收掉

   

## Daemon Pod使用场景

1. 各种网络插件的 Agent 组件

   > 都必须运行在每一个节点上，用来处理这个节点上的容器网络

2. 各种存储插件的 Agent 组件

   > 也必须运行在每一个节点上，用来在这个节点上挂载远程存储目录，操作容器的 Volume 目录

3. 各种监控组件和日志组件

   > 也必须运行在每一个节点上，负责这个节点上的监控信息和日志搜集



## DaemonSet运行时机

跟其他编排对象不一样，DaemonSet开始运行的时机，很多时候比整个k8s集群出现的时机都要早。



**例如在网络插件还没安装时，要先启动一个网络插件的Agent组件？**

这时，k8s集群还没有安装网络插件，即整个集群没有可用的容器网络，所有Worker节点的状态都是 NotReady（NetworkReady=false），这种情况普通的Pod不能运行在集群上，此时网络插件的Agent就要以DaemonSet Pod启动。之所以Daemon Pod能运行，其实就是依靠 Toleration实现的



## DaemonSet和Deployment的区别

1. DaemonSet 跟 Deployment 非常相似，只不过是`没有 replicas 字段`

2. 也使用 selector 选择管理所有携带了 name=xxx 标签的 Pod

3. 而这些 Pod 的模板，也是用 template 字段定义的




### DaemonSet对象例子

fluentd-elasticsearch.yaml

```yaml
apiVersion: apps/v1
kind: DaemonSet # 类型
metadata:
  name: fluentd-elasticsearch
  namespace: kube-system
  labels:
    k8s-app: fluentd-logging
spec:
  selector:
    matchLabels:
      name: fluentd-elasticsearch
  template:
    metadata:
      labels:
        name: fluentd-elasticsearch
    spec:
      tolerations: # 表示这个Pod允许运行在master节点
      - key: node-role.kubernetes.io/master
        effect: NoSchedule
      containers:
      - name: fluentd-elasticsearch
        # fluentd-elasticsearch镜像功能：通过fluentd将Docker容器里的日志转发到ElasticSearch 中
        image: k8s.gcr.io/fluentd-elasticsearch:1.20
        resources:
          limits:
            memory: 200Mi
          requests:
            cpu: 100m
            memory: 200Mi
        volumeMounts:
        - name: varlog
          mountPath: /var/log
        - name: varlibdockercontainers
          mountPath: /var/lib/docker/containers
          readOnly: true
      terminationGracePeriodSeconds: 30
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
      - name: varlibdockercontainers
        hostPath:
          path: /var/lib/docker/containers
```

文件的含义：

* 定义了一个DaemonSet对象，管理着一个Daemon Pod，这个Pod使用 fluentd-elasticsearch:1.20镜像启动了一个容器，这个容器挂载了两个 hostPath 类型的 Volume，分别对应宿主机的 /var/log 目录和 /var/lib/docker/containers 目录，这个fluentd容器启动之后，它会从这两个目录里搜集日志信息，并转发给 ElasticSearch 保存



**注意**：因为Docker容器里应用的日志，默认会保存在宿主机的 /var/lib/docker/containers/{{. 容器 ID}}/{{. 容器 ID}}-json.log 文件里，所以这个目录正是 fluentd 的搜集目标。



## DaemonSet控制器原理

1. DaemonSet控制循环会遍历所有节点，然后根据节点上是否有被管理 Pod 的情况，来决定是否要创建或者删除一个 Pod
2. 在创建每个 Pod 时，DaemonSet 会自动给这个 Pod 加上一个 nodeAffinity，从而保证这个 Pod 只会在指定节点上启动。同时，它还会自动给这个 Pod 加上一个 Toleration，从而忽略节点的 unschedulable“污点”



### 如何保证每个Node只有一个Pod

**DaemonSet 是如何保证每个 Node 上有且只有一个被管理的 Pod 呢？**

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/DaemonSet%E6%8E%A7%E5%88%B6%E5%99%A8.png)



### 如何在指定Node创建新Pod

#### 1、nodeSelector的方式

```bash
nodeSelector: # 在Pod中，指定Node的名字即可，不过这是一个`将要被废弃`的字段
    name: <Node名字>
```

#### 2、nodeAffinity的方式(推荐)

> 新的、功能更完善的、可以代替nodeSelector字段

优点：支持更加丰富的语法（比如 operator: In即部分匹配、而operator: Equal即完全匹配）



**举例**

```yaml
apiVersion: v1
kind: Pod # Pod类型
metadata:
  name: with-node-affinity
spec:
  affinity: # 是 Pod 里跟调度相关的一个字段
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
        - matchExpressions:
          - key: metadata.name
            operator: In
            values:
            - node-test
```

nodeAffinity的含义：

1. requiredDuringSchedulingIgnoredDuringExecution：表示这个 nodeAffinity 必须在每次调度时予以考虑。意味着可以设置在某些情况下不考虑这个 nodeAffinity

2. 这个 Pod，将来只允许运行在“metadata.name”是“node-test”的节点上




所以，DaemonSet 控制器会在创建 Pod 时，自动在这个 Pod 的 API 对象里，加上nodeAffinity定义。其中，需要绑定的节点名字，正是当前正在遍历的这个 Node。



### 允许调度tolerations

DaemonSet会给它管理的Pod自动加上另外一个`与调度相关的字段`，叫作 tolerations。

表示这个Pod，会“容忍”（Toleration）某些 Node 的“污点”（Taint），容忍”的效果是允许调度。

> “污点”可以简单理解为一种特殊的标签



#### 1、容忍unschedulable污点

前提：

正常情况下，被标记了unschedulable“污点”的节点，是不会有任何 Pod 被调度上去的（effect: NoSchedule）。



例子：

Pod要容忍”所有被标记为 unschedulable“污点”的 Node，意味着Pod可以运行在被标记为unschedulable的节点上。



DaemonSet 自动地给被管理的 Pod 加上了这个特殊的 Toleration，就使得这些 Pod 可以忽略这个限制，继而保证每个节点上都会被调度一个 Pod。格式如下：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: with-toleration
spec:
  tolerations:
  - key: node.kubernetes.io/unschedulable
    operator: Exists
    effect: NoSchedule
```

如果这个节点有故障的话，这个 Pod 可能会启动失败，而 DaemonSet 则会始终尝试下去，直到 Pod 启动成功。



#### 2、容忍network-unavailable污点

前提：在k8s中，当一个节点的网络插件尚未安装时，这个节点会被自动加上名为node.kubernetes.io/network-unavailable的“污点”。



例子：

假如DaemonSet 管理的是一个网络插件的 Agent Pod，那必须给它的 Pod 模板加上一个能够“容忍”node.kubernetes.io/network-unavailable“污点”的 Toleration，使得这个网络插件的Agent Pod可以在这个节点上运行。格式如下：

```yaml
...
template:
    metadata:
      labels:
        name: network-plugin-agent
    spec:
      tolerations:
      - key: node.kubernetes.io/network-unavailable
        operator: Exists
        effect: NoSchedule
```



#### 3、容忍master污点

前提：

在默认情况下，k8s 集群不允许用户在 Master 节点部署 Pod。

因为Master 节点默认携带了一个叫作node-role.kubernetes.io/master的“污点”。



例子：

为了能在 Master 节点上部署 DaemonSet 的 Pod，就必须让这个 Pod“容忍”node-role.kubernetes.io/master这个“污点”。在上面例子的 fluentd-elasticsearch DaemonSet 里，就加上了Toleration，表示允许运行在master节点上，：

```yaml
...
tolerations:
- key: node-role.kubernetes.io/master
  effect: NoSchedule
...  
```



## 实践

#### 创建Daemon Pod

1. 创建上面这个日志收集的DaemonSet 对象

```bash
$ kubectl create -f fluentd-elasticsearch.yaml
```

> 注意：在 DaemonSet 上，一般都应该加上 resources 字段，来限制它的 CPU 和内存使用，防止它占用过多的宿主机资源

创建成功后，可以看到，如果有 N 个节点，就会有 N 个 fluentd-elasticsearch Pod 在运行，此时有2个Pod

```bash
$ kubectl get pod -n kube-system -l name=fluentd-elasticsearch
NAME                          READY     STATUS    RESTARTS   AGE
fluentd-elasticsearch-dqfv9   1/1       Running   0          53m
fluentd-elasticsearch-pf9z5   1/1       Running   0          53m
```

2. 查看DaemonSet对象

```bash
# ds是DaemonSet的简写，如deploy是Deployment的简写
$ kubectl get ds -n kube-system fluentd-elasticsearch
NAME                    DESIRED   CURRENT   READY     UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
fluentd-elasticsearch   2         2         2         2            2           <none>          1h
```

DaemonSet 和 Deployment 一样，也有 DESIRED、CURRENT 等多个状态字段。

这也意味着，DaemonSet 可以像 Deployment 那样，进行版本管理。这个版本，可以使用 kubectl rollout history 看到

```bash
$ kubectl rollout history daemonset fluentd-elasticsearch -n kube-system
daemonsets "fluentd-elasticsearch"
REVISION  CHANGE-CAUSE
1         <none>
```



#### 滚动更新

##### 例子：升级容器镜像

把这个 DaemonSet 的容器镜像版本到 v2.2.0

```bash
$ kubectl set image ds/fluentd-elasticsearch fluentd-elasticsearch=k8s.gcr.io/fluentd-elasticsearch:v2.2.0 --record -n=kube-system
```

* 第一个fluentd-elasticsearch 是 DaemonSet 的名字
* 第二个fluentd-elasticsearch 是容器的名字



使用kubectl rollout status查看这个“滚动更新”的过程，如下所示：

```bash
$ kubectl rollout status ds/fluentd-elasticsearch -n kube-system
Waiting for daemon set "fluentd-elasticsearch" rollout to finish: 0 out of 2 new pods have been updated...
Waiting for daemon set "fluentd-elasticsearch" rollout to finish: 0 out of 2 new pods have been updated...
Waiting for daemon set "fluentd-elasticsearch" rollout to finish: 1 of 2 updated pods are available...
daemon set "fluentd-elasticsearch" successfully rolled out
```

注意，由于这一次在升级命令后面加上了–record 参数，所以这次升级使用到的指令就会自动出现在 DaemonSet 的 rollout history 里面，如下所示：

```bash
$ kubectl rollout history daemonset fluentd-elasticsearch -n kube-system
daemonsets "fluentd-elasticsearch"
REVISION  CHANGE-CAUSE
1         <none>
2         kubectl set image ds/fluentd-elasticsearch fluentd-elasticsearch=k8s.gcr.io/fluentd-elasticsearch:v2.2.0 --namespace=kube-system --record=true
```

DaemonSet也有版本号，也可以像 Deployment 一样，将 DaemonSet 回滚到某个指定的历史版本了。



#### DaemonSet怎么维护历史版本

**ControllerRevision**

是Kubernetes v1.7 之后添加了一个 API 对象，专门用来记录某种 Controller 对象的版本。



比如，可以通过如下命令查看 fluentd-elasticsearch 对应的 ControllerRevision：

```bash
$ kubectl get controllerrevision -n kube-system -l name=fluentd-elasticsearch
NAME                               CONTROLLER                             REVISION   AGE
fluentd-elasticsearch-64dc6799c9   daemonset.apps/fluentd-elasticsearch   2          1h
```



使用 kubectl describe 查看这个 ControllerRevision 对象：

```bash
$ kubectl describe controllerrevision fluentd-elasticsearch-64dc6799c9 -n kube-system
Name:         fluentd-elasticsearch-64dc6799c9
Namespace:    kube-system
Labels:       controller-revision-hash=2087235575
              name=fluentd-elasticsearch
Annotations:  deprecated.daemonset.template.generation=2
              kubernetes.io/change-cause=kubectl set image ds/fluentd-elasticsearch fluentd-elasticsearch=k8s.gcr.io/fluentd-elasticsearch:v2.2.0 --record=true --namespace=kube-system
API Version:  apps/v1
Data:
  Spec:
    Template:
      $ Patch:  replace
      Metadata:
        Creation Timestamp:  <nil>
        Labels:
          Name:  fluentd-elasticsearch
      Spec:
        Containers:
          Image:              k8s.gcr.io/fluentd-elasticsearch:v2.2.0
          Image Pull Policy:  IfNotPresent
          Name:               fluentd-elasticsearch
...
Revision:                  2
Events:                    <none>
```

这个 ControllerRevision 对象，实际上是**在 Data 字段保存了该版本对应的完整的 DaemonSet 的 API 对象**。并且，在 Annotation 字段保存了创建这个对象所使用的 kubectl 命令。



接下来，尝试将这个 DaemonSet 回滚到 Revision=1 时的状态：

```bash
$ kubectl rollout undo daemonset fluentd-elasticsearch --to-revision=1 -n kube-system
daemonset.extensions/fluentd-elasticsearch rolled back
```

这个 kubectl rollout undo 操作，实际上相当于读取到了 Revision=1 的 ControllerRevision 对象保存的 Data 字段。而这个 Data 字段里保存的信息，就是 Revision=1 时这个 DaemonSet 的完整 API 对象。



所以，现在 DaemonSet Controller 就可以使用这个历史 API 对象，对现有的 DaemonSet 做一次 PATCH 操作（等价于执行一次 kubectl apply -f “旧的 DaemonSet 对象”），从而把这个 DaemonSet“更新”到一个旧版本。

> 这也是为什么，在执行完这次回滚完成后，DaemonSet 的 Revision 并不会从 Revision=2 退回到 1，而是会增加成 Revision=3。这是因为，一个新的 ControllerRevision 被创建了出来。

