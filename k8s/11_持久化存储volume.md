# 一、PV、PVC、StorageClass 

## PV对象

Persistent Volume（PV） 描述`持久化`存储数据卷。

> 定义的是一个持久化存储在`宿主机`上的目录，比如一个 NFS 的挂载目录



PV 对象通常由`运维人员`事先在k8s集群里创建的。



**API对象定义**

比如，定义一个 NFS 类型的 PV：

```yaml
apiVersion: v1
kind: PersistentVolume # 类型
metadata:
  name: nfs
spec:
  storageClassName: manual # storageClass对象的名字，和PVC定义的一样
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteMany
  nfs: # nfs类型
    server: 10.244.1.4
    path: "/"
```



## PVC对象

Persistent Volume Claim（PVC） 描述Pod要使用的持久化存储的属性。

> 比如，Volume存储的大小、可读写权限等等



PVC 对象通常由`开发人员`创建；或者以 PVC 模板的方式成为 StatefulSet 的一部分，然后由 StatefulSet 控制器负责创建带编号的 PVC。



**API对象定义**

比如，声明一个 1 GiB 大小的 PVC，如下所示

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: nfs
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: manual # storageClass对象的名字，和PV的一样
  resources:
    requests:
      storage: 1Gi
```

在这个 PVC 对象里，没有任何关于 Volume 细节的字段，只有描述性的属性和定义。比如

* storage: 1Gi，表示想要的 Volume 大小至少是 1 GiB

* accessModes: ReadWriteMany，表示这个Volume 的挂载方式是可读写，并且能被挂载在多个节点上

  > AccessMode的类型可以查看 https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes



## PVC绑定PV

PVC必须先和某个符合条件的 PV 进行绑定，才能被容器使用。



**PVC绑定PV要符合的2个条件：**

1. PV 和 PVC 的 spec 字段。比如，PV 的存储（storage）大小，就必须满足PVC的要求

2. PV 和 PVC 的 storageClassName 字段必须一样



**PVC 和 PV 的设计，其实跟“面向对象”的思想完全一致**

* PVC ：可理解为持久化存储的“接口”，它提供了对某种持久化存储的描述，但不提供具体的实现
* PV：负责这个持久化存储的实现



## Pod使用PVC

PVC和PV绑定成功之后，Pod就能够像使用 hostPath 等常规类型的 Volume 一样，在YAML 文件里声明使用这个 PVC 了，如下所示：

```yaml
apiVersion: v1
kind: Pod
metadata:
  labels:
    role: web-frontend
spec:
  containers:
  - name: web
    image: nginx
    ports:
      - name: web
        containerPort: 80
    volumeMounts:
        - name: nfs-test
          mountPath: "/usr/share/nginx/html"
  volumes:
  - name: nfs-test
    persistentVolumeClaim:
      claimName: nfs # 要使用的PVC名字
```

在这个 Pod 创建之后，kubelet会把这个PVC所对应的PV（即一个 NFS 类型的 Volume），挂载在这个 Pod 容器内的目录上。



## 不存在PV的情况

如果在创建 Pod 时，系统里并没有合适的 PV 跟它定义的 PVC 绑定，这时Pod 的启动就会报错。

> 如果此时运维人员赶快创建了一个对应的 PV，接着k8s能够再次完成 PVC 和 PV 的绑定操作，从而启动 Pod。



**Volume控制器**

Volume Controller：专门处理持久化存储的控制器



**PersistentVolumeController **

PersistentVolumeController：是Volume Controller其中一个循环，处理PVC和PV的绑定操作。



**PV与PVC的绑定**

PV 与 PVC 进行“绑定”：就是将PV 对象的名字，填在了 PVC 对象的 spec.volumeName 字段上。



**PV与PVC绑定的过程**

PersistentVolumeController 会`不断地`查看当前每一个 PVC，如果它不是处于Bound(已绑定)状态，那控制器就会遍历所有可用的 PV，并尝试将其与这个PVC 进行绑定。

> 这样就保证用户提交的每一个 PVC，只要有合适的 PV，它就能够很快进入绑定状态



## 持久化存储

“持久化”：指的是容器在这个目录里写入的文件，都会保存在`远程存储`中，从而使得这个目录具备了“持久性”。



**1、容器的Volume**

指将一个宿主机上的目录，跟一个容器里的目录绑定挂载在了一起



**2、持久化Volume**

指一个目录具备“持久性”，这个目录不和当前宿主主机绑定，也不和容器绑定，当容器被重启或者在其他节点上重建出来之后，它仍能够通过挂载这个 Volume，访问到这些内容，因为容器在这个目录里写入的文件，都会保存在远程存储中。



持久化Volume的实现：一般是使用一个`远程存储服务`，挂载到宿主机的一个目录，容器挂载该宿主机目录即可

> 远程存储服务，比如：远程文件存储（比如，NFS、GlusterFS）、远程块存储（比如，公有云提供的远程磁盘）等等。



hostPath和emptyDir类型的 Volume 不具备持久性：它们既有可能被 kubelet 清理掉，也不能被“迁移”到其他节点上。



## StorageClass对象

**作用：**

自定创建 PV 的模板

> PV的创建是由运维人员完成的，在大规模的生产环境里，随着新的 PVC 不断被提交，运维人员就不得不继续添加新的、能满足条件的 PV，靠人工会非常麻烦



**Dynamic Provisioning**

K8s提供了一套可以自动创建 PV 的机制Dynamic Provisioning。该机制工作的核心，在于StorageClass 的 API 对象

> 前面人工管理 PV 的方式就叫作 Static Provisioning。



有了Dynamic Provisioning机制，运维人员只需要在k8s集群里创建出数量有限的 StorageClass 对象就可以了。

> 即运维人员在k8s集群里创建出了各种各样的 PV 模板。当开发人员提交了包含 StorageClass 字段的 PVC 之后，k8s就会根据这个 StorageClass 创建出对应的 PV。



需要注意的是，StorageClass 并不是专门为了 Dynamic Provisioning 而设计的。

> 当集群中中并不存在StorageClass对象，但是PV和PVC又指定了相同的storageClassName名字，意味者我想将两者进行绑定，此时k8s也会进行绑定操作，如开头的声明中的storageClassName=manual



**StorageClass对象会定义如下两个部分内容：**

1. PV 的属性。比如，存储类型、Volume 的大小等

2. 创建这种 PV 需要用到的存储插件。比如，Ceph 等


有了这样两个信息之后，k8s能根据用户提交的 PVC，找到一个对应的 StorageClass。然后，k8s 就会调用该 StorageClass 声明的存储插件，创建出需要的 PV。



**例子**

假如 Volume 的类型是 GCE 的 Persistent Disk，运维人员就需要定义一个StorageClass，如sc.yaml文件

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: block-service
provisioner: kubernetes.io/gce-pd 
parameters:
  type: pd-ssd
```

* provisioner 字段：值是kubernetes.io/gce-pd，这是k8s内置的 GCE PD 存储插件的名字

* parameters 字段：是PV的参数

  > 比如：type=pd-ssd，指的是这个 PV 的类型是“SSD 格式的 GCE 远程磁盘”



注意：由于需要使用 GCE Persistent Disk，这个例子只有在 GCE 提供的 Kubernetes 服务里才能实践。



1. 创建这个 StorageClass ：

```bash
$ kubectl create -f sc.yaml
```

2. 这时，应用开发者只需要在 PVC 里指定要使用的 StorageClass 名字即可，如下pvc.yaml：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: claim1
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: block-service # 指定该 PVC 所要使用的 StorageClass 的名字
  resources:
    requests:
      storage: 30Gi
```

3. 以 Google Cloud 为例

当通过 kubectl create 创建上述 PVC 对象之后，k8s就会调用 Google Cloud 的 API，创建出一块 SSD 格式的 Persistent Disk。然后，再使用这个 Persistent Disk 的信息，自动创建出一个对应的 PV 对象。



创建pvc：

```bash
$ kubectl create -f pvc.yaml
```

可以看到，创建的 PVC 会绑定一个 Kubernetes 自动创建的 PV，如下所示：

```bash
$ kubectl describe pvc claim1
Name:           claim1
Namespace:      default
StorageClass:   block-service
Status:         Bound
Volume:         pvc-e5578707-c626-11e6-baf6-08002729a32b
Labels:         <none>
Capacity:       30Gi
Access Modes:   RWO
No Events.
```

而且，通过查看这个PV 的属性，可以看到它跟PVC 里声明的存储的属性是一致的：

```bash
$ kubectl describe pv pvc-e5578707-c626-11e6-baf6-08002729a32b
Name:            pvc-e5578707-c626-11e6-baf6-08002729a32b
Labels:          <none>
StorageClass:    block-service
Status:          Bound
Claim:           default/claim1
Reclaim Policy:  Delete
Access Modes:    RWO
Capacity:        30Gi
...
No events.
```

此外，这个自动创建出来的 PV 的 StorageClass 字段的值，也是 block-service。这是因为，k8s只会将 StorageClass 相同的 PVC 和 PV 绑定起来。



## PV、PVC、StorageClass关系



![](https://gitee.com/sinkhaha/picture/raw/master/img/CICD/20220406230816.png)





## 持久化宿主主机目录

**准备“持久化”宿主机目录的过程，称为“两阶段处理”。**



### 两阶段处理

PV 的“两阶段处理”流程，是靠独立于 kubelet 主控制循环（Kubelet Sync Loop）之外的两个控制循环来实现的。



1. “第一阶段”的 Attach（以及 Dettach）操作：AttachDetachController控制

   > AttachDetachController控制循环是由 Volume Controller 负责维护的，作用是不断地检查每一个 Pod 对应的 PV，和这个 Pod 所在宿主机之间挂载情况。从而决定，是否需要对这个 PV 进行 Attach（或者 Dettach）操作。

   > AttachDetachController运行在 Master 节点上。因为Attach 操作只需要调用公有云或者具体存储项目的 API，并不需要在具体的宿主机上执行操作。
   >

   

2. “第二阶段”的 Mount（以及 Unmount）操作：VolumeManagerReconciler控制

   > VolumeManagerReconciler控制循环必须发生在 Pod 对应的宿主机上，所以它必须是 kubelet 组件的一部分，是一个独立于 kubelet 主循环的 Goroutine。
   >
   > 
   >
   > 通过这样将 Volume 的处理同 kubelet 的主循环解耦，Kubernetes 就避免了这些`耗时的远程挂载操作`拖慢 kubelet 的主控制循环，进而导致 Pod 的创建效率大幅下降的问题。

   >  kubelet 的一个主要设计原则，就是它的`主控制循环`绝对不可以被 block。



### 例子

当一个 Pod 调度到一个节点上之后，kubelet 就要负责为这个 Pod 创建它的 Volume 目录。



默认情况下，kubelet 为 Volume 创建的目录是一个宿主机上的路径，如下：

```bash
/var/lib/kubelet/pods/<Pod的ID>/volumes/kubernetes.io~<Volume类型>/<Volume名字>
```

kubelet 要做的操作就取决于 Volume 类型



#### **第1阶段 Attach阶段**

**如果Volume是远程块存储类型**

比如 Google Cloud 的 Persistent Disk（GCE 提供的远程磁盘服务）；



kubelet需要先调用 Goolge Cloud 的 API，将它所提供的 Persistent Disk 挂载到 Pod 所在的宿主机上，相当于执行：

```bash
$ gcloud compute instances attach-disk <虚拟机名字> --disk <远程磁盘名字>
```

这一步为虚拟机挂载远程磁盘的操作。



**如果Volume是远程文件存储类型**

比如 NFS；

kubelet 可以跳过“第一阶段”（Attach）的操作，因为远程文件存储并没有一个“存储设备”需要挂载在宿主机上。



#### **第2阶段 Mount阶段**

**如果Volume是远程块存储类型**

Attach完成后，为了能够使用这个远程磁盘，kubelet还要进行Mount操作，即：格式化这个磁盘设备，然后将它挂载到Volume的宿主机目录。这一步相当于执行：

```bash
# 通过lsblk命令获取磁盘设备ID
$ sudo lsblk
# 格式化成ext4格式
$ sudo mkfs.ext4 -m 0 -F -E lazy_itable_init=0,lazy_journal_init=0,discard /dev/<磁盘设备ID>
# 挂载到挂载点
$ sudo mkdir -p /var/lib/kubelet/pods/<Pod的ID>/volumes/kubernetes.io~<Volume类型>/<Volume名字>
```

Mount 阶段完成后，这个 Volume 的宿主机目录就是一个“持久化”的目录了，容器在它里面写入的内容，会保存在 Google Cloud 的远程磁盘中。



**如果Volume是远程文件存储类型**

kubelet 需要作为 client，将远端 NFS 服务器的目录（比如：“/”目录），挂载到 Volume 的宿主机目录上，

即相当于执行如下命令：

```bash
$ mount -t nfs <NFS服务器地址>:/ /var/lib/kubelet/pods/<Pod的ID>/volumes/kubernetes.io~<Volume类型>/<Volume名字> 
```

通过这个挂载操作，Volume 的宿主机目录就成为了一个远程 NFS 目录的挂载点，后面在这个目录里写入的所有文件，都会被保存在远程 NFS 服务器上。



### k8s是如何定义和区分这两个阶段的

在具体的 Volume 插件的实现接口上，k8s分别给这两个阶段提供了两种不同的参数列表：

* 对于“第一阶段”（Attach），k8s 提供的可用参数是 nodeName，即宿主机的名字
* 对于“第二阶段”（Mount），k8s 提供的可用参数是 dir，即 Volume 的宿主机目录

所以，作为一个存储插件，我们只需要根据自己的需求进行选择和实现即可。

而经过了“两阶段处理”，就得到了一个“持久化”的 Volume 宿主机目录。



所以，接下来，kubelet 只要把这个 Volume 目录通过 CRI 里的 Mounts 参数，传递给 Docker，然后就可以为 Pod 里的容器挂载这个“持久化”的 Volume 了。

这一步相当于执行了如下命令：

```bash
$ docker run -v /var/lib/kubelet/pods/<Pod的ID>/volumes/kubernetes.io~<Volume类型>/<Volume名字>:/<容器内的目标目录> 我的镜像 ...
```



# 二、本地持久化卷

## Local Persistent Volume

k8s 能够直接使用宿主机上的本地磁盘目录，而不依赖于远程存储服务，来提供“持久化”的容器 Volume。



**适用范围**

比如：高优先级的系统应用，需要在多个不同节点上存储数据，并且对 I/O 较为敏感。

> 典型的适用应用包括：分布式数据存储比如 MongoDB、Cassandra 等，分布式文件系统比如 GlusterFS、Ceph 等，以及需要在本地磁盘上进行大量数据缓存的分布式应用。



**缺点**

一旦这些节点宕机且不能恢复时，Local Persistent Volume 的数据就可能丢失

> 这些数据可以定时备份在其他位置



**如何把本地磁盘抽象成 PV**

一个 Pod 可以声明使用类型为 Local 的 PV，而这个 PV 其实就是一个 `hostPath 类型的 Volume`。如果这个 hostPath 对应的目录，已经在节点 A 上被事先创建好了。那么，只需要再给这个 Pod 加上一个 nodeAffinity=nodeA，就可以使用这个 Volume 了。



一个 Local Persistent Volume 对应的存储介质，一定是一块额外挂载在宿主机的磁盘或者块设备（“额外”的意思是，它不应该是宿主机根目录所使用的主硬盘）。这个原则，可以称为“一个 PV 一块盘”。

> 不要直接把一个宿主机上的目录当作 PV 使用。
>
> 因为，这种本地目录的存储行为完全不可控，它所在的磁盘随时都可能被应用写满，甚至造成整个宿主机宕机。而且，不同的本地目录之间也缺乏哪怕最基础的 I/O 隔离机制。



**调度器如何保证 Pod 始终能被正确地调度到它所请求的 Local Persistent Volume 所在的节点上呢？**

* 对于常规的 PV ：k8s都是先调度 Pod 到某个节点上，然后，再通过“两阶段处理”来“持久化”这台机器上的 Volume 目录，进而完成 Volume 目录与容器的绑定挂载。



* 对于Local PV：节点上可供使用的磁盘（或者块设备），必须是运维人员提前准备好的。它们在不同节点上的挂载情况可以完全不同，甚至有的节点可以没这种磁盘

> 所以，调度器就必须能够知道 `所有节点与 Local Persistent Volume 对应的磁盘 `的关联关系，然后根据这个信息来调度 Pod。
>
> 这个原则，可以称为“在调度的时候考虑 Volume 分布”。在 Kubernetes 的调度器里，有一个叫作 VolumeBindingChecker 的过滤条件专门负责这个事情。在 Kubernetes v1.11 中，这个过滤条件已经默认开启了。



## 实践

在开始使用 Local Persistent Volume 之前，需要在集群里配置好磁盘或者块设备，有两种办法来完成这个步骤

1. 给宿主机挂载并格式化一个可用的本地磁盘，这也是最常规的操作

2. 对于实验环境，其实可以在宿主机上挂载几个 RAM Disk（内存盘）来模拟本地磁盘



**下面以第2种方法为例子进行实践**

首先，在名叫node-1的宿主机上创建一个挂载点，比如 /mnt/disks；然后，用几个 RAM Disk 来模拟本地磁盘，如下所示：

```bash
# 在node-1上执行
$ mkdir /mnt/disks
$ for vol in vol1 vol2 vol3; do
    mkdir /mnt/disks/$vol
    mount -t tmpfs $vol /mnt/disks/$vol
done
```

注意：如果希望其他节点也能支持 Local Persistent Volume 的话，那就需要为它们也执行上述操作，并且确保这些磁盘的名字（vol1、vol2 等）都不重复。



接下来，为这些本地磁盘定义对应的 PV 了，如下所示：

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: example-pv
spec:
  capacity:
    storage: 5Gi
  volumeMode: Filesystem
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Delete
  storageClassName: local-storage
  local:
    path: /mnt/disks/vol1
  nodeAffinity:
    required:
      nodeSelectorTerms:
      - matchExpressions:
        - key: kubernetes.io/hostname
          operator: In
          values:
          - node-1
```

这个 PV 的定义里：

* local 字段，指定了它是一个 Local Persistent Volume；

* path 字段，指定的正是这个 PV 对应的本地磁盘的路径，即：/mnt/disks/vol1。

意味着如果 Pod 要想使用这个 PV，那它就必须运行在 node-1 上。所以，在这个 PV 的定义里，需要有一个 nodeAffinity 字段指定 node-1 这个节点的名字。



接下来，创建这个 PV：

```bash
$ kubectl create -f local-pv.yaml 
persistentvolume/example-pv created

$ kubectl get pv
NAME         CAPACITY   ACCESS MODES   RECLAIM POLICY  STATUS      CLAIM             STORAGECLASS    REASON    AGE
example-pv   5Gi        RWO            Delete           Available                     local-storage             16s
```

这个 PV 创建后，进入了 Available（可用）状态。



使用 PV 和 PVC 的最佳实践，是要创建一个 StorageClass 来描述这个 PV，如下所示：

```yaml
kind: StorageClass
apiVersion: storage.k8s.io/v1
metadata:
  name: local-storage
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
```

这个 StorageClass 的名字，叫作 local-storage。

需要注意的是，在它的 provisioner 字段，指定的是 no-provisioner。

> 这是因为 Local Persistent Volume 目前尚不支持 Dynamic Provisioning，所以它没办法在用户创建 PVC 的时候，就自动创建出对应的 PV。也就是说，我们前面创建 PV 的操作，是不可以省略的。



与此同时，这个 StorageClass 还定义了一个 volumeBindingMode=WaitForFirstConsumer 的属性。它是 Local Persistent Volume 里一个非常重要的特性，即：延迟绑定。



### 延迟绑定

当提交了 PV 和 PVC 的 YAML 文件之后，k8s就会根据它们俩的属性，以及它们指定的 StorageClass 来进行绑定。只有绑定成功后，Pod 才能通过声明这个 PVC 来使用对应的 PV。

> 可是，如果使用的是 Local Persistent Volume 的话，这个流程根本行不通，需要推迟这个“绑定”操作



#### 为什么要延迟绑定

1. 现在有一个 Pod，它声明使用的 PVC 叫作 pvc-1。并且，我们规定这个 Pod 只能运行在 node-2 上。

2. 而在 k8s 集群中，有两个属性（比如：大小、读写权限）相同的 Local 类型的 PV

3. 其中，第一个 PV 的名字叫作 pv-1，它对应的磁盘所在的节点是 node-1。而第二个 PV 的名字叫作 pv-2，它对应的磁盘所在的节点是 node-2。

4. 假设现在，k8s 的 Volume 控制循环里，首先检查到了 pvc-1 和 pv-1 的属性是匹配的，于是就将它们俩绑定在一起

5. 然后，你用 kubectl create 创建了这个 Pod

6. 这时，问题就出现了。调度器看到，这个 Pod 所声明的 pvc-1 已经绑定了 pv-1，而 pv-1 所在的节点是 node-1，根据“调度器必须在调度时考虑 Volume 分布”的原则，这个 Pod 自然会被调度到 node-1 上，但是前面已经规定过，这个Pod只允许运行在 node-2 上。所以最后的结果是，这个 Pod 的调度必然会失败。

**所以在使用Local Persistent Volume时，要推迟这个“绑定”操作，推迟到调度的时候**



#### 怎么做

StorageClass 里的 volumeBindingMode=WaitForFirstConsumer 的含义，就是告诉 Kubernetes 里的 Volume 控制循环（“红娘”）：虽然你已经发现这个 StorageClass 关联的 PVC 与 PV 可以绑定在一起，但请不要现在就执行绑定操作（即：设置 PVC 的 VolumeName 字段）。



而要等到第一个声明使用该 PVC 的 Pod 出现在调度器之后，调度器再综合考虑所有的调度规则，当然也包括每个 PV 所在的节点位置，来统一决定，这个 Pod 声明的 PVC，到底应该跟哪个 PV 进行绑定。



上面的例子里，由于这个 Pod 不允许运行在 pv-1 所在的节点 node-1，所以它的 PVC 最后会跟 pv-2 绑定，并且 Pod 也会被调度到 node-2 上。



所以，通过这个延迟绑定机制，原本实时发生的 PVC 和 PV 的绑定过程，就被延迟到了 Pod 第一次调度的时候在调度器中进行，**从而保证了这个绑定结果不会影响 Pod 的正常调度。**



当然，在具体实现中，调度器实际上维护了一个与 Volume Controller 类似的控制循环，专门负责为那些声明了“延迟绑定”的 PV 和 PVC 进行绑定工作。



通过这样的设计，这个额外的绑定操作，并不会拖慢调度器的性能。而当一个 Pod 的 PVC 尚未完成绑定时，调度器也不会等待，而是会直接把这个 Pod 重新放回到待调度队列，等到下一个调度周期再做处理。



### 实践过程

在明白了延迟绑定机制后，就可以创建 StorageClass 了，如下所示：

```bash
$ kubectl create -f local-sc.yaml 
storageclass.storage.k8s.io/local-storage created
```

接下来，定义一个非常普通的 PVC，就可以让 Pod 使用到上面定义好的 Local Persistent Volume 了，如下所示：

```yaml
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: example-local-claim
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: local-storage
```

可以看到，这个 PVC 没有任何特别的地方。唯一需要注意的是，它声明的 storageClassName 是 local-storage。所以，将来k8s 的 Volume Controller 看到这个 PVC 时，不会为它进行绑定操作。



现在，创建这个 PVC：

```bash
$ kubectl create -f local-pvc.yaml 
persistentvolumeclaim/example-local-claim created

$ kubectl get pvc
NAME                  STATUS    VOLUME    CAPACITY   ACCESS MODES   STORAGECLASS    AGE
example-local-claim   Pending                                       local-storage   7s
```

可以看到，尽管这时，k8s 里已经存在了一个可以与 PVC 匹配的 PV，但这个 PVC 依然处于 Pending 状态，也就是等待绑定的状态。



然后，编写一个 Pod 来声明使用这个 PVC，如下所示：

```yaml
kind: Pod
apiVersion: v1
metadata:
  name: example-pv-pod
spec:
  volumes:
    - name: example-pv-storage
      persistentVolumeClaim:
       claimName: example-local-claim
  containers:
    - name: example-pv-container
      image: nginx
      ports:
        - containerPort: 80
          name: "http-server"
      volumeMounts:
        - mountPath: "/usr/share/nginx/html"
          name: example-pv-storage
```

这个 Pod 没有任何特别的地方，只需要注意，它的 volumes 字段声明要使用前面定义的、名叫 example-local-claim 的 PVC 即可。



而我们一旦使用 kubectl create 创建这个 Pod，就会发现，前面定义的 PVC，会立刻变成 Bound 状态，与前面定义的 PV 绑定在了一起，如下所示：

```bash
$ kubectl create -f local-pod.yaml 
pod/example-pv-pod created

$ kubectl get pvc
NAME                  STATUS    VOLUME       CAPACITY   ACCESS MODES   STORAGECLASS    AGE
example-local-claim   Bound     example-pv   5Gi        RWO            local-storage   6h
```

也就是说，在创建的 Pod 进入调度器之后，“绑定”操作才开始进行。



这时候，可以尝试在这个 Pod 的 Volume 目录里，创建一个测试文件，比如：

```bash
$ kubectl exec -it example-pv-pod -- /bin/sh
# cd /usr/share/nginx/html
# touch test.txt
```

然后，登录到 node-1 这台机器上，查看一下它的 /mnt/disks/vol1 目录下的内容，你就可以看到刚刚创建的这个文件：

```bash
# 在node-1上
$ ls /mnt/disks/vol1
test.txt
```

而如果你重新创建这个 Pod 的话，就会发现，我们之前创建的测试文件，依然被保存在这个持久化 Volume 当中：

```bash
$ kubectl delete -f local-pod.yaml 

$ kubectl create -f local-pod.yaml 

$ kubectl exec -it example-pv-pod -- /bin/sh
# ls /usr/share/nginx/html
# touch test.txt
```

这就说明，像 Kubernetes 这样构建出来的、基于本地存储的 Volume，完全可以提供容器持久化存储的功能。所以，像 StatefulSet 这样的有状态编排工具，也完全可以通过声明 Local 类型的 PV 和 PVC，来管理应用的存储状态。



**需要注意的是，上面手动创建 PV 的方式，即 Static 的 PV 管理方式，在删除 PV 时需要按如下流程执行操作：**

1. 删除使用这个 PV 的 Pod
2. 从宿主机移除本地磁盘（比如，umount 它）
3. 删除 PVC
4. 删除 PV

如果不按照这个流程的话，这个 PV 的删除就会失败。



当然，由于上面这些创建 PV 和删除 PV 的操作比较繁琐，k8s 其实提供了一个 Static Provisioner 来帮助你管理这些 PV。



比如，我们现在的所有磁盘，都挂载在宿主机的 /mnt/disks 目录下。



那么，当 Static Provisioner 启动后，它就会通过 DaemonSet，自动检查每个宿主机的 /mnt/disks 目录。然后，调用 Kubernetes API，为这些目录下面的每一个挂载，创建一个对应的 PV 对象出来。这些自动创建的 PV，如下所示：

```bash
$ kubectl get pv
NAME                CAPACITY    ACCESSMODES   RECLAIMPOLICY   STATUS      CLAIM     STORAGECLASS    REASON    AGE
local-pv-ce05be60   1024220Ki   RWO           Delete          Available             local-storage             26s

$ kubectl describe pv local-pv-ce05be60 
Name:  local-pv-ce05be60
...
StorageClass: local-storage
Status:  Available
Claim:  
Reclaim Policy: Delete
Access Modes: RWO
Capacity: 1024220Ki
NodeAffinity:
  Required Terms:
      Term 0:  kubernetes.io/hostname in [node-1]
Message: 
Source:
    Type: LocalVolume (a persistent volume backed by local storage on a node)
    Path: /mnt/disks/vol1
```

这个 PV 里的各种定义，比如 StorageClass 的名字、本地磁盘挂载点的位置，都可以通过 provisioner 的配置文件指定。当然，provisioner 也会负责前面提到的 PV 的删除工作。


