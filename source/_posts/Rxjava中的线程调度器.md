---
title: Rxjava中的线程调度器
date: 2017-02-01 16:38:28
tags: android rxjava
---
# Rxjava中的线程调度器(Scheduler)

### 原理
Rxjava为了开发人员可以更加方便地来回切换线程，满足不同的业务需求，引入了线程调度器(scheduler)。Rxjava中的线程调度器主要由操作符来实现：**ObserveOn**以及**SubscribeOn**。

其中 **SubscribeOn** 用来表明原始数据源(source observable)会在哪个线程开始发射数据，无论 **SubscribeOn** 在整个调用链的哪个位置开始被调用。如果多次被调用的话，按照就近(the left-most)原则,最靠近数据源的那个 **SubscribeOn** 会被调用，因此通常来说只会有一个**SubscribeOn**操作符。

**ObserveOn** 则用来在整个调用链中切换线程。一个**ObserveOn** 操作符会影响调用链中在它以下操作符的调用线程，直到碰到另一个**ObserveOn**，因此，因此通常来说会有多个**ObserveOn** 操作符。

下图是Scheduler的官方示意图，按照上面的就是可以非常容易地理解该图。
![](img/1FEEDE8F52EAE27749C43C73260E82D2.png)

### 举例
首先举例说明**SubscribeOn**操作符, 可以看到我们在代码里有两个**SubscribeOn**操作符，一前一后分别对应Schedulers.io()和Schedulers.computation()，可以看到最终整个调用链都在Schedulers.io()中执行，符合之前所说的就近原则。

```java
Observable.just("frank", "tom", "Gamma")
        .map(s -> s.length())
        .subscribeOn(Schedulers.io())
        .map(integer -> integer+10)
        .subscribeOn(Schedulers.computation())
        .subscribe(integer -> {
           Log.e("Frank", String.valueOf(integer));
           Log.e("Frank", Thread.currentThread().getName());
        });

```

![](img/646B53D9F7DD1A76239ECF930D8A6784.png)

其次我们来看一下**ObserveOn**操作符。例子中有一个**ObserveOn**操作符，作用是切换到computation线程上。从最终的结果可以看出在操作符前面的调用链都是在主线程上的，而之后的调用链则切换到了computation线程上。至于computation，io线程是什么我们会在下面进行解释。

```java
        Observable.range(1, 3)
                .map(integer -> integer * 10)
                .doOnNext(integer -> {
                    Log.e("Frank", "emmit: "+ integer + " in thread: "+ Thread.currentThread().getName());
                })
                .observeOn(Schedulers.computation())
                .map(integer -> integer * 10)
                .subscribe(integer -> {
                    Log.e("Frank", "receive: "+ integer + " in thread: "+Thread.currentThread().getName());
                });
```

![](img/DAA0A2869BDD84862E3D7661572F8BF1.png)

### 源码解析
在源码分析单元，我们分成两个部分：第一个部分是两个操作符的实现，第二个部分是Rxjava内置的部分线程。
首先我们来看**SubscribeOn**操作符。其实所有的关键只是在于 ScalarSynchronousObservable。这里ScalarSynchronousObservable相当于干了一件什么事呢？就是将**SubscribeOn**操作符上一级的observable和下一级的subscriber联系起来，同时将其放在scheduler指定的线程中执行。因此我们可以将上面的例子理解成这样去掉所有**SubscribeOn**调用符的调用链在第一个**SubscribeOn**调用符的线程中执行，这不就是就近原则吗？

```java
    public final Observable<T> subscribeOn(Scheduler scheduler) {

        if (this instanceof ScalarSynchronousObservable) {
            return ((ScalarSynchronousObservable<T>)this).scalarScheduleOn(scheduler);
        }
        return nest().lift(new OperatorSubscribeOn<T>(scheduler)); //关键是这一句
    }

    public final Observable<Observable<T>> nest() {
        return just(this);
    }

    public final static <T> Observable<T> just(final T value) {
        return ScalarSynchronousObservable.create(value);
    }

    public final class ScalarSynchronousObservable<T> extends Observable<T> {

    public static final <T> ScalarSynchronousObservable<T> create(T t) {
        return new ScalarSynchronousObservable<T>(t); //这时的t是上一级的observable
    }

    private final T t;

    protected ScalarSynchronousObservable(final T t) {
        super(new OnSubscribe<T>() {

            @Override
            public void call(Subscriber<? super T> s) {
                s.onNext(t); //s则是下面OperatorSubscribeOn中返回的subscriber
                s.onCompleted();
            }

        });
        this.t = t;
    }


    public class OperatorSubscribeOn<T> implements Operator<T, Observable<T>> {

    private final Scheduler scheduler;

    public OperatorSubscribeOn(Scheduler scheduler) {
        this.scheduler = scheduler;
    }

    @Override
    public Subscriber<? super Observable<T>> call(final Subscriber<? super T> subscriber) {
        final Worker inner = scheduler.createWorker(); //从线程池取出对应的线程
        subscriber.add(inner);
        return new Subscriber<Observable<T>>(subscriber) {

            @Override
            public void onCompleted() {
            }

            @Override
            public void onError(Throwable e) {
                subscriber.onError(e);
            }

            @Override
            public void onNext(final Observable<T> o) {
                inner.schedule(new Action0() {

                    @Override
                    public void call() {
                        final Thread t = Thread.currentThread();
                        //这时的subscriber就是下一级的subscriber，o就是上面传下来的上一级的observable
                        //observable和subscriber重新订阅后，放入对应的线程中执行
                        o.unsafeSubscribe(new Subscriber<T>(subscriber) {

                            @Override
                            public void onCompleted() {
                                subscriber.onCompleted();
                            }

                            @Override
                            public void onError(Throwable e) {
                                subscriber.onError(e);
                            }

                            @Override
                            public void onNext(T t) {
                                subscriber.onNext(t);
                            }
                         }
                    }
                });
            }

        };
    }
}



```

其次我们来看**ObserveOn**操作符，这个操作符比较简单，当执行**ObserveOn**操作符时，这时会执行parent这个subscriber的onNext方法，这个方法中将下一级的subscriber放入**ObserveOn**指定的线程中执行其onNext方法，从而达到切换线程的目的。因此多次调用**ObserveOn**操作符多次切换线程也就比较容易解释了。

```java
    public final Observable<T> observeOn(Scheduler scheduler) {
        if (this instanceof ScalarSynchronousObservable) {
            return ((ScalarSynchronousObservable<T>)this).scalarScheduleOn(scheduler);
        }
        //这一句是关键
        return lift(new OperatorObserveOn<T>(scheduler));
    }



    public final class OperatorObserveOn<T> implements Operator<T, T> {

    private final Scheduler scheduler;

    /**
     * @param scheduler
     */
    public OperatorObserveOn(Scheduler scheduler) {
        this.scheduler = scheduler;
    }

    @Override
    public Subscriber<? super T> call(Subscriber<? super T> child) {
        if (scheduler instanceof ImmediateScheduler) {
            return child;
        } else if (scheduler instanceof TrampolineScheduler) {
            return child;
        } else {
            //这里产生了新的Subscriber
            ObserveOnSubscriber<T> parent = new ObserveOnSubscriber<T>(scheduler, child);
            parent.init();
            return parent;
        }
    }

    /** Observe through individual queue per observer. */
    private static final class ObserveOnSubscriber<T> extends Subscriber<T> {
        final Subscriber<? super T> child;
        final Scheduler.Worker recursiveScheduler;
        final Queue<Object> queue;

        volatile Throwable error;
        public ObserveOnSubscriber(Scheduler scheduler, Subscriber<? super T> child) {
            this.child = child;
            this.recursiveScheduler = scheduler.createWorker(); //从线程池中产生线程
            this.scheduledUnsubscribe = new ScheduledUnsubscribe(recursiveScheduler);
        }

        void init() {
            ...
        }


        @Override
        public void onNext(final T t) {
          //将数据源t加入到queue中
           if (!queue.offer(on.next(t))) {
                onError(new MissingBackpressureException());
                return;
            }

            schedule(); //在生成的线程中执行下一级subscriber的onNext方法
        }

        final Action0 action = new Action0() {

            @Override
            public void call() {
                pollQueue();
            }

        };

        protected void schedule() {
            if (COUNTER_UPDATER.getAndIncrement(this) == 0) {
                recursiveScheduler.schedule(action);
            }
        }

        // only execute this from schedule()
        void pollQueue() {
            int emitted = 0;
            do {
                counter = 1;
                while (!scheduledUnsubscribe.isUnsubscribed()) {
                    if (failure) {

                    } else {
                        if (REQUESTED.getAndDecrement(this) != 0) {
                            //从队列中取出数据
                            Object o = queue.poll();
                            if (o == null) {

                            } else {
                              //这里是真正执行下一集subscriber的onNext(o)方法
                                if (!on.accept(child, o)) {
                                    emitted++;
                                }
                            }
                        } else {
                            REQUESTED.incrementAndGet(this);
                            break;
                        }
                    }
                }
            } while (COUNTER_UPDATER.decrementAndGet(this) > 0);

            // request the number of items that we emitted in this poll loop
            if (emitted > 0) {
                request(emitted);
            }
        }
    }
}

```

最后Rxjava中有好几种不同的schedulers，其具体实现已经超出了本文的范围，将会在后续文章中说明。我们可以再这边列出不同schedulers对应的具体代码文件为后续分析做准备。

| Scheduler     |对应具体实现类 |           
| ------------- |:-------------:|
| Schedulers.computation      |  EventLoopsScheduler |
|  Schedulers.immediate      | ImmediateScheduler    |   
|  Schedulers.io |    CachedThreadScheduler   |   
|Schedulers.newThread|NewThreadScheduler |


![](img/D982158A9260B8A24625A3C5F8F2848D.png)

### 总结
1. **ObserveOn**操作符多次调用多次切换线程。
2. **SubscribeOn**操作符多次调用一次生效，就近原则。

###参考文档
1.http://reactivex.io/documentation/scheduler.html
2.http://tomstechnicalblog.blogspot.com/2016/02/rxjava-understanding-observeon-and.html
