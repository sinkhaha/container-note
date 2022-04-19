## Deployment/ReplicaSet/Pod的关系

Deployment对象实现了一个非常重要的功能：Pod 的“水平扩展 / 收缩”。

> 如果更新了Deployment的Pod模板，那么Deployment就会通过滚动更新的方式来实现现有的容器，它的实现依赖的是：ReplicaSet对象



1. Deployment实际操纵的不是Pod对象

2. Deployment控制ReplicaSet，ReplicaSet控制Pod



### 例子

如nginx-deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3 # 定义的 Pod 副本个数是 3
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
        image: nginx:1.16.1
        ports:
        - containerPort: 80
```

此时Deployment、ReplicaSet、Pod的关系如下

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/20210813213259.png)



* ReplicaSet通过“控制器模式”，保证Pod 的个数永远等于指定的个数(比如3个)

  > 这也是Deployment只允许容器的 restartPolicy=Always 的主要原因：
  >
  > 只有在容器能保证自己始终是 Running 状态的前提下，ReplicaSet 调整 Pod 的个数才有意义。
  >
  > 
  >
  > 如果restartPolicy=Never，容器退出了，Pod结束了。为了保证数量，控制器就需要不停启动Pod。可能在任一时刻，Pod数量都不会等于3，这时调整Pod的个数是没有意义的，因为可能永远达不到期望状态。

* 在此基础上，Deployment 同样通过“控制器模式”，来操作 ReplicaSet 的个数和属性，进而实现“水平扩展 / 收缩”和“滚动更新”这两个编排动作



### ReplicaSet对象

一个 ReplicaSet 对象，是由 `副本数目的定义` 和` 一个 Pod 模板` 组成的。

> ReplicaSet的定义其实是 Deployment 的一个子集



ReplicaSet的定义如下所示

```yaml
apiVersion: apps/v1
kind: ReplicaSet # 类型
metadata:
  name: nginx-set
  labels:
    app: nginx
spec:
  replicas: 3
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
        image: nginx:1.16.1
```



## 水平扩展/收缩

Deployment控制器只需要修改它所控制的 `ReplicaSet的Pod副本个数`就可以实现水平扩展和水平收缩了。



比如通过以下`kubectl scale命令`实现水平扩展：

```bash
# replicas的值从3改成4，那么Deployment所控制的ReplicaSet就会根据修改后的值自动创建一个新的Pod，即水平扩展
$ kubectl scale deployment nginx-deployment --replicas=4
deployment.apps/nginx-deployment scaled
```



## 滚动更新

滚动更新是将一个集群中正在运行的多个 Pod 版本，交替地逐一升级的过程。



### 以上面Deployment为例

1. 先创建 nginx-deployment

```bash
$ kubectl create -f nginx-deployment.yaml --record
```

> 注意：加了–record 是为了：记录下每次操作所执行的命令，以方便后面查看

2. 检查一下 nginx-deployment 创建后的状态信息

```bash
$ kubectl get deployments
NAME               DESIRED   CURRENT   UP-TO-DATE   AVAILABLE   AGE
nginx-deployment   3         0         0            0           1s
```



**在返回结果中，四个状态字段的含义如下**

1. DESIRED

   > 用户期望的 Pod 副本个数（spec.replicas 的值）

2. CURRENT

   > 当前处于 Running 状态的 Pod 的个数

3. UP-TO-DATE

   > 当前处于最新版本的 Pod 的个数，最新版本指的是 Pod 的 Spec 部分与 Deployment 里 Pod 模板里定义的完全一致

4. AVAILABLE（是用户所期望的最终状态）

   > 当前已经可用的 Pod 的个数，即：既是 Running 状态，又是最新版本，并且已经处于 Ready（健康检查正确）状态的 Pod 的个数



**实时查看Deployment对象的状态变化**

kubectl rollout status命令

```bash
$ kubectl rollout status deployment/nginx-deployment
Waiting for rollout to finish: 2 out of 3 new replicas have been updated...
deployment.apps/nginx-deployment successfully rolled out

# 结果中的“2 out of 3 new replicas have been updated”表示已经有 2 个 Pod 进入了 UP-TO-DATE 状态
```

等会就看到3个Pod进入到了 AVAILABLE 状态：

```bash
NAME               DESIRED   CURRENT   UP-TO-DATE   AVAILABLE   AGE
nginx-deployment   3         3         3            3           20s
```



**查看一下这个 Deployment 所控制的 ReplicaSet**

```bash
$ kubectl get rs
NAME                          DESIRED   CURRENT   READY   AGE
nginx-deployment-3167673210   3         3         3       20s
```

如上所示，在用户提交了一个 Deployment 对象后，Deployment控制器就会立即创建一个 Pod 副本个数为 3 的 ReplicaSet。这个 ReplicaSet 的名字，则是`由 Deployment 的名字和一个随机字符串(pod-template-hash，如此时的3167673210)`共同组成。

> ReplicaSet 会把这个随机字符串加在它所控制的所有 Pod 的标签里，从而保证这些 Pod 不会与集群里的其他 Pod 混淆。



### **触发滚动更新**

滚动更新的时机：一旦修改了 Deployment 的 Pod 模板，“滚动更新”就会被`自动`触发。



修改Deployment的方式很多，比如直接使用 `kubectl edit `指令编辑 Etcd 里的 API 对象

```bash
$ kubectl edit deployment/nginx-deployment
... 
    spec:
      containers:
      - name: nginx
        image: nginx:1.9.1 # 1.7.9 -> 1.9.1
        ports:
        - containerPort: 80
...
deployment.extensions/nginx-deployment edited
```

1. kubectl edit 指令会直接打开 nginx-deployment 的 API 对象

2. 然后就可以修改这里的 Pod 模板部分了（比如，将 nginx 镜像的版本升级到了 1.9.1）

3. kubectl edit 指令编辑完成后，保存退出
4. Kubernetes 就会立刻触发“滚动更新”的过程



通过 kubectl rollout status 查看 nginx-deployment 的状态变化

```bash
$ kubectl rollout status deployment/nginx-deployment
Waiting for rollout to finish: 2 out of 3 new replicas have been updated...
deployment.extensions/nginx-deployment successfully rolled out
```



#### 滚动更新的流程

可以`查看 Deployment 的 Events`，看到这个“滚动更新”的流程：

```bash
$ kubectl describe deployment nginx-deployment
...
Events:
  Type    Reason             Age   From                   Message
  ----    ------             ----  ----                   -------
...
  Normal  ScalingReplicaSet  24s   deployment-controller  Scaled up replica set nginx-deployment-1764197365 to 1
  Normal  ScalingReplicaSet  22s   deployment-controller  Scaled down replica set nginx-deployment-3167673210 to 2
  Normal  ScalingReplicaSet  22s   deployment-controller  Scaled up replica set nginx-deployment-1764197365 to 2
  Normal  ScalingReplicaSet  19s   deployment-controller  Scaled down replica set nginx-deployment-3167673210 to 1
  Normal  ScalingReplicaSet  19s   deployment-controller  Scaled up replica set nginx-deployment-1764197365 to 3
  Normal  ScalingReplicaSet  14s   deployment-controller  Scaled down replica set nginx-deployment-3167673210 to 0
```

1. 当修改了 Deployment 里的 Pod 定义之后，Deployment控制器会使用这个修改后的 Pod 模板，创建一个新的 ReplicaSet（hash=1764197365），这个新的 ReplicaSet 的初始 Pod 副本数是：0

2. 然后，在 Age=24s 的位置，Deployment控制器开始将这个新的 ReplicaSet 所控制的 Pod 副本数从 0 个变成 1 个，即：“水平扩展”出一个副本

3. 接着，在 Age=22s 的位置，Deployment控制器又将旧的 ReplicaSet（hash=3167673210）所控制的旧 Pod 副本数减少一个，即：“水平收缩”成两个副本
4. 如此交替进行，新 ReplicaSet 管理的 Pod 副本数，从 0 个变成 1 个，再变成 2 个，最后变成 3 个。而旧的 ReplicaSet 管理的 Pod 副本数则从 3 个变成 2 个，再变成 1 个，最后变成 0 个。这样，就完成了这一组 Pod 的版本升级过程



在这个“滚动更新”过程完成之后，可以查看一下新、旧两个 ReplicaSet 的最终状态：

```bash
$ kubectl get rs
NAME                          DESIRED   CURRENT   READY   AGE
nginx-deployment-1764197365   3         3         3       6s
nginx-deployment-3167673210   0         0         0       30s
```

其中，旧 ReplicaSet（hash=3167673210）已经被“水平收缩”成了 0 个副本。



#### RollingUpdateStrategy配置

这个策略是Deployment对象的一个字段，名叫 RollingUpdateStrategy，如下所示：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
...
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
```

* maxSurge： 指定的是除了 DESIRED 数量之外，在一次“滚动”中，Deployment 控制器还可以创建多少个新 Pod

* maxUnavailable ：指的是在一次“滚动”中，Deployment 控制器可以删除多少个旧 Pod

> 这两个配置还可以用百分比形式来表示，比如：maxUnavailable=50%，指的是我们最多可以一次删除“50%*DESIRED 数量”个 Pod。



**滚动更新时，Deployment、ReplicaSet和Pod的关系图**

![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/20210813220831.png)



如上所示，Deployment控制器实际上控制的是 ReplicaSet 的数目，以及每个 ReplicaSet 的属性。



而一个应用的版本，对应的正是一个 ReplicaSet；这个版本应用的 Pod 数量，则由 ReplicaSet 通过它自己的控制器（ReplicaSet控制器）来保证。



通过这样的多个 ReplicaSet 对象，Kubernetes 项目就实现了对多个“应用版本”的描述。



### 滚动更新的好处

在升级刚开始时，集群里只有 1 个新版本的 Pod。如果这时，新版本 Pod 有问题启动不起来，那么“滚动更新”就会停止，从而允许开发和运维人员介入。而在这个过程中，由于应用本身还有2个旧版本的 Pod 在线，所以服务并不会受到太大的影响。



**前提是：**一定要使用Pod的健康检查机制检查(readiness类型)应用的运行状态，而不是简单地依赖于容器的 Running 状态。

> 有可能容器是Running了，但服务很有可能尚未启动，“滚动更新”的效果也就达不到了



为了进一步保证服务的连续性，Deployment控制器还会确保

1. 在任何时间窗口内，只有指定比例的 Pod 处于`离线`状态。
2. 在任何时间窗口内，只有指定比例的新 Pod 被创建出来
3. 上面这两个比例的值都是可配置的，默认都是 DESIRED 值的 25%

> 所以，在上面Deployment的例子中，它有 3 个 Pod 副本，那么控制器在“滚动更新”的过程中永远都会确保至少有 2 个 Pod 处于可用状态，至多只有 4 个 Pod 同时存在于集群中。



### 触发滚动更新错误停止

这里使用`kubectl set image` 指令，直接修改 nginx-deployment 所使用的镜像

> 这个命令的好处就是，可以不用像 kubectl edit 那样需要打开编辑器



这一次故意把镜像名字修改成为了一个错误的名字，比如：nginx:1.91。

这样，这个 Deployment 就会出现一个升级失败的版本。



1. 修改镜像

```bash
$ kubectl set image deployment/nginx-deployment nginx=nginx:1.91
deployment.extensions/nginx-deployment image updated
```

由于这个 nginx:1.91 镜像在 Docker Hub 中并不存在，所以这个 Deployment 的“滚动更新”被触发后，会立刻报错并停止。



2 . 检查一下ReplicaSet 的状态

```bash
$ kubectl get rs
NAME                          DESIRED   CURRENT   READY   AGE
nginx-deployment-1764197365   2         2         2       24s
nginx-deployment-3167673210   0         0         0       35s
nginx-deployment-2156724341   2         2         0       7s
```

1. 新版本的 ReplicaSet（hash=2156724341）的“水平扩展”已经停止

2. 它已经创建了两个 Pod，但是它们都没有进入 READY 状态

   > 因为这两个 Pod 都拉取不到有效的镜像

3. 旧版本的 ReplicaSet（hash=1764197365）的“水平收缩”，也自动停止了

4. 此时，已经有一个旧 Pod 被删除，还剩下两个旧 Pod



问题：如何让这个Deployment的3个Pod，都回滚到以前的旧版本呢？



### Pod回滚到旧版本

**问题1：如何让这个Deployment的3个Pod，都回滚到以前的旧版本**

执行kubectl rollout undo回滚命令，就能把整个 Deployment 回滚到上一个版本：

```bash
$ kubectl rollout undo deployment/nginx-deployment
deployment.extensions/nginx-deployment
```

Deployment控制器，其实就是让这个旧 ReplicaSet（hash=1764197365）再次“扩展”成 3 个 Pod，而让新的 ReplicaSet（hash=2156724341）重新“收缩”到 0 个 Pod。



**问题2：如果想回滚到更早之前的版本，要怎么办？**

1. 首先使用 kubectl rollout history 命令，查看每次 Deployment 变更对应的版本

由于在创建这个 Deployment 时，指定了–record 参数，所以创建这些版本时执行的 kubectl 命令，都会被记录下来。这个操作的输出如下所示：

```bash
$ kubectl rollout history deployment/nginx-deployment
deployments "nginx-deployment"
REVISION    CHANGE-CAUSE
1           kubectl create -f nginx-deployment.yaml --record
2           kubectl edit deployment/nginx-deployment
3           kubectl set image deployment/nginx-deployment nginx=nginx:1.91
```

可以看到，前面执行的创建和更新操作，分别对应了版本 1 和版本 2，而那次失败的更新操作，则对应的是版本 3



> 还可以查看指定版本对应的 Deployment 的 API 对象的细节：
>
> ```bash
> $ kubectl rollout history deployment/nginx-deployment --revision=2
> ```



2. 然后，在 kubectl rollout undo 命令 加上要回滚到的指定版本的版本号--to-revision，就可以回滚到指定版本了

```bash
$ kubectl rollout undo deployment/nginx-deployment --to-revision=2
deployment.extensions/nginx-deployment
```

这样，Deployment控制器还会按照“滚动更新”的方式，完成对 Deployment 的降级操作。



**问题3：对Deployment进行的每一次更新操作，都会生成一个新的 ReplicaSet 对象，是不是多余且浪费资源呢？**

> 没错

Kubernetes还提供了一个指令，使得对Deployment的多次更新操作，最后只生成一个 ReplicaSet。



具体的做法是，在更新Deployment前，先执行一条 kubectl rollout pause 指令。它的用法如下所示：

```bash
$ kubectl rollout pause deployment/nginx-deployment
deployment.extensions/nginx-deployment paused
```

kubectl rollout pause 的作用：让这个 Deployment 进入了一个“暂停”状态。

>  接下来，可以随意使用 kubectl edit 或者 kubectl set image 指令，修改这个 Deployment 的内容了

由于此时 Deployment 正处于“暂停”状态，所以我们对 Deployment 的所有修改，都不会触发新的“滚动更新”，也不会创建新的 ReplicaSet。



而等到对 Deployment 修改操作都完成之后，只需要再执行一条 kubectl rollout resume 指令，就可以把这个 Deployment“恢复”回来，如下所示：

```bash
$ kubectl rollout resume deployment/nginx-deployment
deployment.extensions/nginx-deployment resumed
```

而在这个 kubectl rollout resume 指令执行之前，在 kubectl rollout pause 指令之后的这段时间里，对 Deployment 进行的所有修改，最后只会触发一次“滚动更新”。



可以通过检查 ReplicaSet 状态的变化，来验证一下 kubectl rollout pause 和 kubectl rollout resume 指令的执行效果，如下所示：

```bash
$ kubectl get rs
NAME               DESIRED   CURRENT   READY     AGE
nginx-1764197365   0         0         0         2m
nginx-3196763511   3         3         3         28s
```

通过结果可以看到，只有一个 hash=3196763511 的 ReplicaSet 被创建了出来。



**如何控制这些“历史”ReplicaSet 的数量呢？**

Deployment 对象有一个字段，叫作 spec.revisionHistoryLimit，就是 Kubernetes 为 Deployment 保留的“历史版本”个数。所以，如果把它设置为 0，你就再也不能做回滚操作了。



## 一些实操命令

```bash
# 查看Pod
$ kubectl get pods

# 查看Pod详情
$ kubectl describe pods <pod的名字>	
# 从输出可看到 Controlled By字段，它的值是ReplicaSet/<rs的名字>，即Pod由RS控制

# 查看RS
$ kubectl get rs

# 查看RS详情
$ kubectl describe rs <rs名字>
# 从输出可看到 Controlled By字段，它的值是Deployment/<deploy名字>，即RS由Deployment控制


# 查看Deployment
$ kubectl get deploy

# 查看deployment详情
$ kubectl describe deploy <deployment名字>
# 输出中没有Controlled By字段，deployment不受其他组件控制，需要用户去创建该资源，service在deployment->rs->pod这一套流程的基础上对外提供服务
```

