# 在线业务 & 离线业务

1. 在线业务

在线业务的应用容器进程会一直保持在 Running 状态，除非出错或者停止。

> 如Web服务、 MySQL等，一般用Deployment对象管理

2. 离线业务

离线业务在计算完成后就直接退出了，它们可以以并行的方式去运行

> 一般用Job对象管理；不能用Deployment对象管理，因为当Pod在计算结束后退出了，Deployment会控制一直重启



# 离线任务Job

Job用来描述离线业务的 API 对象



## API对象定义

**Job对象的定义如下**

job.yaml

```yaml
apiVersion: batch/v1
kind: Job # Job类型
metadata:
  name: pi
spec:
  template:
    spec:
      containers:
      - name: pi
        image: resouer/ubuntu-bc 
        command: ["sh", "-c", "echo 'scale=10000; 4*a(1)' | bc -l "]
      restartPolicy: Never # 不重启，只允许被设置为 Never 和 OnFailure
  backoffLimit: 4 # 失败后重试次数
```

其中Pod模板定义了一个安装bc 命令的 Ubuntu 镜像的容器，里面运行计算π值的命令

```bash
echo "scale=10000; 4*a(1)" | bc -l 
```

> * bc是计算器
>
> * -l 表示使用标准数学库
> * a(1)是数学库的arctangent函数，计算 atan(1)，因为tan(π/4) = 1，所以4*atan(1)正好就是π
>
> * scale=10000指定了输出的小数点后的位数是 10000

跟其他控制器不同的是，Job对象不需要定义一个 `spec.selector` 来描述要控制哪些 Pod



1. 创建这个 Job 

```bash
$ kubectl create -f job.yaml
```

2. 成功创建后，查看这个 Job 对象

```bash
$ kubectl describe jobs/pi
Name:             pi
Namespace:        default
Selector:         controller-uid=c2db599a-2c9d-11e6-b324-0209dc45a495
Labels:           controller-uid=c2db599a-2c9d-11e6-b324-0209dc45a495
                  job-name=pi
Annotations:      <none>
Parallelism:      1
Completions:      1
..
Pods Statuses:    0 Running / 1 Succeeded / 0 Failed
Pod Template:
  Labels:       controller-uid=c2db599a-2c9d-11e6-b324-0209dc45a495
                job-name=pi
  Containers:
   ...
  Volumes:              <none>
Events:
  FirstSeen    LastSeen    Count    From            SubobjectPath    Type        Reason            Message
  ---------    --------    -----    ----            -------------    --------    ------            -------
  1m           1m          1        {job-controller }                Normal      SuccessfulCreate  Created pod: pi-rq5rl
```

在创建后，Pod模板和Job对象本身，都自动加上了名为 `controller-uid=< 一个随机字符串 > `的 Label，是为了保证了 Job 与它所管理的 Pod 之间的匹配关系，也避免不同Job对象所管理的 Pod 发生重合。



3. 这个 Job 创建的 Pod 进入了 Running 状态，意味着它在计算 Pi 的值

```bash
$ kubectl get pods
NAME                                READY     STATUS    RESTARTS   AGE
pi-rq5rl                            1/1       Running   0          10s
```

4. 等计算结束后，Pod进入Completed状态

```bash
$ kubectl get pods
NAME                                READY     STATUS      RESTARTS   AGE
pi-rq5rl                            0/1       Completed   0          4m
```

离线计算的 Pod 永远都不应该被重启，否则会再重新计算一遍，所以在 Pod 模板中定义 restartPolicy=Never 

>  在Job对象，restartPolicy只允许被设置为Never和OnFailure
>
> 在Deployment对象，restartPolicy只允许被设置为Always

5. 用kubectl logs 查看一下这个 Pod 的日志，可以看到输出了计算得到的 Pi 值

```bash
$ kubectl logs pi-rq5rl
3.141592653589793238462643383279...
```



## 离线作业失败的处理

1. 当Pod的restartPolicy=Nerver时，离线任务失败后Job控制器会不断重新创建一个新的Pod

   > 这个的重试次数是spec.backoffLimit字段配置（在上面Job对象定义了spec.backoffLimit=4，即重试次数为 4，其默认值是 6），重新创建 Pod 的间隔是呈指数增加的，即下一次重新创建 Pod 的动作会分别发生在 10 s、20 s、40 s …



2.  当Pod的restartPolicy=OnFailure时，离线任务失败后Job控制器会不断重启Pod里的容器，而不会去重新创建一个新的Pod



## 设置最长运行时间

**当一个 Job 的 Pod 运行结束后，它会进入Completed状态。但如果这个 Pod 因为某种原因一直不肯结束怎么办呢？**

在 Job的API 对象有一个 spec.activeDeadlineSeconds 字段可以设置最长运行时间



比如：

```yaml
spec:
 backoffLimit: 5
 activeDeadlineSeconds: 100
```

一旦运行超过了 100 s，这个 Job 的所有 Pod 都会被终止。并且可以在 Pod 的状态里看到终止的原因是 DeadlineExceeded



## Job控制器对并行作业的控制

在 Job对象中，负责并行控制的参数有两个：

1. spec.parallelism：定义的是一个 Job 在任意时间`最多`可以启动多少个 Pod 同时运行
2. spec.completions：定义的是 Job 至少要完成的 Pod 数目，即 Job 的最小完成数



在上面计算 Pi 值的 Job 里，添加这两个参数：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: pi
spec:
  parallelism: 2
  completions: 4
  template:
    spec:
      containers:
      - name: pi
        image: resouer/ubuntu-bc
        command: ["sh", "-c", "echo 'scale=5000; 4*a(1)' | bc -l "]
      restartPolicy: Never
  backoffLimit: 4
```

表示指定了这个 Job 最大的并行数是 2，而最小的完成数是 4。



1. 创建这个 Job 对象：

```bash
$ kubectl create -f job.yaml
```

2. 可以看到，这个Job也维护了DESIRED 和 SUCCESSFUL两个状态字段，如下：

```bash
$ kubectl get job
NAME      DESIRED   SUCCESSFUL   AGE
pi        4         0            3s
```

DESIRED的值正是 completions 定义的最小完成数



3. 然后这个 Job 首先创建了2个并行运行的 Pod 来计算 Pi：

```bash
$ kubectl get pods
NAME       READY     STATUS    RESTARTS   AGE
pi-5mt88   1/1       Running   0          6s
pi-gmcq5   1/1       Running   0          6s
```

每当有一个 Pod 完成计算进入 Completed 状态时，就会有一个新的 Pod 被自动创建出来，并且快速地从 Pending 状态进入到 ContainerCreating 状态，最后进入Running状态，一直到4个Pod都完成了，都进入了Completed状态。



4. 最后所有的Pod都成功退出，即这个Job执行完了，它的SUCCESSFUL值变成了 4：

```bash

$ kubectl get job
NAME      DESIRED   SUCCESSFUL   AGE
pi        4         4            5m
```



## Job控制器的工作原理

**工作原理**

1. Job Controller 直接控制的对象是 Pod
2. Job Controller在控制循环中进行的调谐操作，是根据实际在 Running 状态 Pod 的数目、已经成功退出的 Pod 的数目，以及 parallelism、completions 参数的值共同计算出在这个周期里，应该创建或者删除的 Pod 数目，然后调用 Kubernetes API 来执行这个操作



**举例**

1. 在上面计算 Pi 值的例子中，当 Job 一开始创建出来时，实际处于 Running 状态的 Pod 数目 =0，已经成功退出的 Pod 数目 =0，而用户定义的 completions，也就是最终用户需要的 Pod 数目 =4

2. 所以，在这个时刻，`需要创建的 Pod 数目 = 最终需要的 Pod 数目 - 实际在 Running 状态 Pod 数目 - 已经成功退出的 Pod 数目 = 4 - 0 - 0= 4`。也就是说，Job Controller 需要创建 4 个 Pod 来纠正这个不一致状态

3. 可是，又定义了这个 Job 的 parallelism=2。也就是，我们规定了每次并发创建的 Pod 个数不能超过 2 个。所以，Job Controller 会对前面的计算结果做一个修正，修正后的期望创建的 Pod 数目应该是：2 个。

4. 这时Job Controller 就会并发地向 kube-apiserver 发起两个创建 Pod 的请求

类似地，如果在这次调谐周期里，Job Controller 发现实际在 Running 状态的 Pod 数目，比 parallelism 还大，那么它就会删除一些 Pod，使两者相等。



**在实际使用时，需要根据作业的特性，来决定并行度（parallelism）和任务数（completions）的合理取值**



## 3种使用Job对象的方法

### 1、外部管理器 +Job 模板

用法：把 Job的YAML文件定义为一个“模板”，然后用一个`外部工具`控制这些“模板”来生成 Job

> 是最简单粗暴的用法，但却是k8s 社区里一个很普遍的模式

原因很简单：大多数用户在需要管理 Batch Job 时，都已经有了一套自己的方案，需要做的往往就是集成工作。这时，只需要编写一个外部工具（等同于我们这里的 for 循环）来管理这些 Job 即可。



**应用例子**

这种模式最典型的应用是 TensorFlow 社区的 KubeFlow 项目。

> 在这种模式下使用 Job 对象，completions 和 parallelism 这两个字段都应该使用默认值 1，不应该由我们自行设置。而作业 Pod 的并行控制，应该完全交由外部工具来进行管理（比如，KubeFlow）。



**Job 定义**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: process-item-$ITEM # 定义了$ITEM 变量
  labels:
    jobgroup: jobexample
spec:
  template:
    metadata:
      name: jobexample
      labels:
        jobgroup: jobexample
    spec:
      containers:
      - name: c
        image: busybox
        command: ["sh", "-c", "echo Processing item $ITEM && sleep 5"]
      restartPolicy: Never
```

**在控制这种Job时，注意如下两个方面**

1. 创建Job时，替换掉 $ITEM 这样的变量
2. 所有来自于同一个模板的 Job，都有一个 `jobgroup: jobexample` 标签，也就是这一组Job使用了相同的标识



可以用如下shell把 $ITEM替换掉，生成一组来自同一个模版都不同Job的yaml文件：

```bash
$ mkdir ./jobs
$ for i in apple banana cherry
do
  cat job-tmpl.yaml | sed "s/\$ITEM/$i/" > ./jobs/job-$i.yaml
done
```

接着，通过 kubectl create创建这些 Job：

```bash
$ kubectl create -f ./jobs
$ kubectl get pods -l jobgroup=jobexample
NAME                        READY     STATUS      RESTARTS   AGE
process-item-apple-kixwv    0/1       Completed   0          4m
process-item-banana-wrsf7   0/1       Completed   0          4m
process-item-cherry-dnfu9   0/1       Completed   0          4m
```



### 2、拥有固定任务数目的并行 Job

用法：设置完成数目（completions），可以不设置并行度（parallelism）



**应用例子**

比如，上面计算 Pi 值的例子，就是一个典型的、拥有固定任务数目（completions=4）的应用场景。 

> 它的 parallelism 值是 2；或者可以不指定 parallelism，直接使用默认的并行度（即：1）。

此外，还可以使用一个工作队列（Work Queue）进行任务分发。



**Job 的定义**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: job-wq-1
spec:
  completions: 8
  parallelism: 2
  template:
    metadata:
      name: job-wq-1
    spec:
      containers:
      - name: c
        image: myrepo/job-wq-1
        env:
        - name: BROKER_URL
          value: amqp://guest:guest@rabbitmq-service:5672
        - name: QUEUE
          value: job1
      restartPolicy: OnFailure
```

其中completions为8，意味着总共要处理的任务数目是 8 个，也就是总共会有 8 个任务会被逐一放入工作队列里（可以运行一个外部小程序作为生产者，来提交任务）。



在 Pod 模板里定义 BROKER_URL，来作为消费者。当创建了这个 Job，它会以并发度为 2 的方式，每两个 Pod 一组，创建出 8 个 Pod。每个 Pod 都会去连接 BROKER_URL，从 RabbitMQ 里读取任务，然后各自进行处理。



这个 Pod 里的执行逻辑，可以用一段伪代码来表示：

```
/* job-wq-1的伪代码 */
queue := newQueue($BROKER_URL, $QUEUE)
task := queue.Pop()
process(task)
exit
```

可以看到，每个 Pod 只需要将任务信息读取出来，处理完成，然后退出即可。而作为用户，只关心最终一共有 8 个计算任务启动并且退出，只要这个目标达到，就认为整个 Job 处理完成了。所以这种用法，对应的就是“任务总数固定”的场景。



### 3、指定并行度

用法：设置并行度（parallelism），但不设置固定的完成数（completions） 的值

> 此时，得决定什么时候启动新 Pod，什么时候 Job 才算执行完成
>
> 在这种情况下，任务的总数是未知的，所以不仅需要一个工作队列来负责任务分发，还需要能够判断工作队列已经为空（即：所有的工作已经结束了）。



**Job定义**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: job-wq-2
spec:
  parallelism: 2 # 只有并行度参数
  template:
    metadata:
      name: job-wq-2
    spec:
      containers:
      - name: c
        image: gcr.io/myproject/job-wq-2
        env:
        - name: BROKER_URL
          value: amqp://guest:guest@rabbitmq-service:5672
        - name: QUEUE
          value: job2
      restartPolicy: OnFailure
```

对应Pod的逻辑可以用这样一段伪代码来描述：

```
/* job-wq-2的伪代码 */
for !queue.IsEmpty($BROKER_URL, $QUEUE) {
  task := queue.Pop()
  process(task)
}
print("Queue empty, exiting")
exit
```

由于任务数目的总数不固定，所以每一个 Pod 必须能够知道，自己什么时候可以退出。

> 比如这个例子中，简单地以“队列为空”，作为任务全部完成的标志。所以说，这种用法，对应的是“任务总数不固定”的场景。

不过，在实际的应用中，需要处理的条件往往会非常复杂。

> 比如，任务完成后的输出、每个任务 Pod 之间是不是有资源的竞争和协同等等。



# 定时任务CronJob

CronJob 描述的是定时任务



## **API对象定义**

```yaml
apiVersion: batch/v1beta1
kind: CronJob # CronJob累心
metadata:
  name: hello
spec:
  # Cron表达式，表示每分钟执行一次
  schedule: "*/1 * * * *" 
  jobTemplate: # 注意是jobTemplate，跟Job的template不一样，用于管理job对象
    spec:
      template:
        spec:
          containers:
          - name: hello
            image: busybox
            args:
            - /bin/sh
            - -c
            - date; echo Hello from the Kubernetes cluster
          restartPolicy: OnFailure
```

CronJob 与 Job 的关系，如同 Deployment 与 ReplicaSet 的关系，CronJob是一个专门用来管理 Job 对象的控制器。



Cronjob创建和删除 Job 的依据，是 schedule字段定义的、一个标准的Unix Cron格式的表达式，这里要执行的内容，就是 jobTemplate 定义的 Job 了。



## 实践

1. 创建CronJob，在创建 1 分钟后，就会有一个 Job 产生了，如下所示：

```bash
$ kubectl create -f ./cronjob.yaml
cronjob "hello" created

# 一分钟后
$ kubectl get jobs
NAME               DESIRED   SUCCESSFUL   AGE
hello-4111706356   1         1         2s
```

此时，CronJob 对象会记录下这次 Job 执行的时间：

```bash
$ kubectl get cronjob hello
NAME      SCHEDULE      SUSPEND   ACTIVE    LAST-SCHEDULE
hello     */1 * * * *   False     0         Thu, 6 Sep 2018 14:34:00 -070
```



注意：由于定时任务的特殊性，很可能某个 Job 还没有执行完，另外一个新 Job 就产生了。

可以通过 spec.concurrencyPolicy 字段来定义具体的处理策略。比如：

1. 值为Allow（默认值），意味着这些 Job 可以同时存在
2. 值为Forbid，意味着不会创建新的 Pod，该创建周期被跳过
3. 值为Replace，意味着新产生的 Job 会替换旧的、没有执行完的 Job



而如果某一次 Job 创建失败，这次创建就会被标记为“miss”。当在指定的时间窗口内，miss 的数目达到 100 时，那么 CronJob 会停止再创建这个 Job。

> 这个时间窗口，可以由 spec.startingDeadlineSeconds 字段指定。比如 startingDeadlineSeconds=200，意味着在过去 200 s 里，如果 miss 的数目达到了 100 次，那么这个 Job 就不会被创建执行了。

