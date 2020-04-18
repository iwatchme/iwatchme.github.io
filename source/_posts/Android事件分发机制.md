---
title: Android事件分发机制
date: 2016-12-23 14:44:45
tags: android
---
# Android事件分发机制

#### ViewGroup的dispatchTouchEvent()方法
这个方法是整个android事件分发的核心。要想分析清楚这个方法，应该要理解清楚两个阶段：
* MontionEvent.ACTION_DOWN
* MontionEvent.ACTION_MOVE/ACTION_UP
同时还要理解几个变量的含义:
* `intercepted`
* `mFirstTouchTarget`

##### 几个变量
首先来看`mFirstTouchTarget`变量的赋值，主要在105行。这个变量的含义是当前view的子view处理了ACTION_DOWN事件。比如ViewGroupA中包含ViewGroupB,ViewGroupB又包含ViewC。最后ViewC处理了事件（onTouchEvent中返回true）。那么此时ViewGroupA的mFirstTouchTarget指向ViewGroupB, 而ViewGroupB的mFirstTouchTarget指向ViewC。
其次再来看`intercepted`，这个变量的含义非常容易理解就是是否要拦截Touch事件。主要从第18~29行。第一个判断条件是指如果当前为ACTION_DOWN事件或是ACTION_DOWN后续事件但是有子View处理了ACTION_DOWN事件，就进入第二层判断。否则intercepted = false。这也就是如果一个View如果不处理ACTION_DOWN事件，后续事件再也收不到的原因，因为被它的父View拦截了。再看第二层判断，有一个`disallowIntercept`变量，通过这个变量我们可以强制指定是否拦截当前事件(requestDisallowInterceptTouchEvent方法)，如果为true，就强制为不拦截；如果为false，就通过我们熟悉的onInterceptTouchEvent函数来做出判断。

##### 两个过程
ACTION_DOWN以及后续的事件可以看成两个阶段。两个阶段主要的差距就在于第45~125行对ACTION_DOWN事件的处理。那我们就先看一下这个不同点。其实也很简单就是遍历当前View的所有子View，通过递归调用（dispatchTransformedTouchEvent）看那个子View可以处理当前的ACTION_DOWN事件，并将该子View保存到`mFirstTouchTarget`变量中。而从第128行开始的函数则是同样的。如果没有子View处理(mFirstTouchTarget = null)的话，调用dispatchTransformedTouchEvent函数，此时child参数为null，实质调用的是View的dispatchTouchEvent(代码3)；而如果有子View处理，就会进行相应的处理，这里的代码会结合相关的例子进行讲解。

```c

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {

        boolean handled = false;
        if (onFilterTouchEventForSecurity(ev)) {
            final int action = ev.getAction();
            final int actionMasked = action & MotionEvent.ACTION_MASK;

            // Handle an initial down.
            if (actionMasked == MotionEvent.ACTION_DOWN) {
                cancelAndClearTouchTargets(ev);
                resetTouchState();
            }

            // Check for interception.
            final boolean intercepted;
            if (actionMasked == MotionEvent.ACTION_DOWN
                    || mFirstTouchTarget != null) {
                final boolean disallowIntercept = (mGroupFlags & FLAG_DISALLOW_INTERCEPT) != 0;
                if (!disallowIntercept) {
                    intercepted = onInterceptTouchEvent(ev);
                    ev.setAction(action); // restore action in case it was changed
                } else {
                    intercepted = false;
                }
            } else {
                intercepted = true;
            }

            // If intercepted, start normal event dispatch. Also if there is already
            // a view that is handling the gesture, do normal event dispatch.
            if (intercepted || mFirstTouchTarget != null) {
                ev.setTargetAccessibilityFocus(false);
            }

            // Check for cancelation.
            final boolean canceled = resetCancelNextUpFlag(this)
                    || actionMasked == MotionEvent.ACTION_CANCEL;

            // Update list of touch targets for pointer down, if needed.
            final boolean split = (mGroupFlags & FLAG_SPLIT_MOTION_EVENTS) != 0;
            TouchTarget newTouchTarget = null;
            boolean alreadyDispatchedToNewTouchTarget = false;
            if (!canceled && !intercepted) {
                View childWithAccessibilityFocus = ev.isTargetAccessibilityFocus()
                        ? findChildWithAccessibilityFocus() : null;

                if (actionMasked == MotionEvent.ACTION_DOWN
                        || (split && actionMasked == MotionEvent.ACTION_POINTER_DOWN)
                        || actionMasked == MotionEvent.ACTION_HOVER_MOVE) {
                    final int actionIndex = ev.getActionIndex(); // always 0 for down
                    final int idBitsToAssign = split ? 1 << ev.getPointerId(actionIndex)
                            : TouchTarget.ALL_POINTER_IDS;

                    removePointersFromTouchTargets(idBitsToAssign);

                    final int childrenCount = mChildrenCount;
                    if (newTouchTarget == null && childrenCount != 0) {
                        final float x = ev.getX(actionIndex);
                        final float y = ev.getY(actionIndex);

                        final View[] children = mChildren;
                        for (int i = childrenCount - 1; i >= 0; i--) {
                            final int childIndex = customOrder
                                    ? getChildDrawingOrder(childrenCount, i) : i;
                            final View child = (preorderedList == null)
                                    ? children[childIndex] : preorderedList.get(childIndex);

                            // 判断当前的子view能否接受到点击事件，如果不能直接下一个
                            if (!canViewReceivePointerEvents(child)
                                    || !isTransformedTouchPointInView(x, y, child, null)) {
                                ev.setTargetAccessibilityFocus(false);
                                continue;
                            }

                            newTouchTarget = getTouchTarget(child);
                            if (newTouchTarget != null) {
                                newTouchTarget.pointerIdBits |= idBitsToAssign;
                                break;
                            }

                            resetCancelNextUpFlag(child);

                            //如果点击事件坐标落在子view范围里面，如果child!=null,就递归调用child的dispatchTouchEvent方法；如果child==null，就直接调用View的dispatchTouchEvent方法，即对event做相应处理
                            if (dispatchTransformedTouchEvent(ev, false, child, idBitsToAssign)) {

                                // Child wants to receive touch within its bounds.
                                //进入这个里面表示子view处理该事件
                                mLastTouchDownTime = ev.getDownTime();
                                if (preorderedList != null) {
                                    // childIndex points into presorted list, find original index
                                    for (int j = 0; j < childrenCount; j++) {
                                        if (children[childIndex] == mChildren[j]) {
                                            mLastTouchDownIndex = j;
                                            break;
                                        }
                                    }
                                } else {
                                    mLastTouchDownIndex = childIndex;
                                }
                                mLastTouchDownX = ev.getX();
                                mLastTouchDownY = ev.getY();
                                //给mFirstTouchTarget=当前子view，newTouchTarget=当前子view
                                newTouchTarget = addTouchTarget(child, idBitsToAssign);
                                alreadyDispatchedToNewTouchTarget = true;
                                break;
                            }

                            // The accessibility focus didn't handle the event, so clear
                            // the flag and do a normal dispatch to all children.
                            ev.setTargetAccessibilityFocus(false);
                        }
                        if (preorderedList != null) preorderedList.clear();
                    }

                    if (newTouchTarget == null && mFirstTouchTarget != null) {
                        newTouchTarget = mFirstTouchTarget;
                        while (newTouchTarget.next != null) {
                            newTouchTarget = newTouchTarget.next;
                        }
                        newTouchTarget.pointerIdBits |= idBitsToAssign;
                    }
                }
            }

            // 表示没有任何一个子view处理该事件，自己处理
            if (mFirstTouchTarget == null) {
                handled = dispatchTransformedTouchEvent(ev, canceled, null,
                        TouchTarget.ALL_POINTER_IDS);
            } else {
                //表示当down的时候已经有子view处理了
                TouchTarget predecessor = null;
                TouchTarget target = mFirstTouchTarget;
                while (target != null) {
                    final TouchTarget next = target.next;
                    //只有当down事件的时候才会进来（newTouchTarget == target）
                    if (alreadyDispatchedToNewTouchTarget && target == newTouchTarget) {
                        handled = true;
                    } else {
                      //其他事件则会调用下面的dispatchTransformTouchEvent
                        final boolean cancelChild = resetCancelNextUpFlag(target.child)
                                || intercepted;
                        if (dispatchTransformedTouchEvent(ev, cancelChild,
                                target.child, target.pointerIdBits)) {
                            handled = true;
                        }
                        if (cancelChild) {
                            if (predecessor == null) {
                              //这时会将mFirstTouchTarget置为null
                                mFirstTouchTarget = next;
                            } else {
                                predecessor.next = next;
                            }
                            target.recycle();
                            target = next;
                            continue;
                        }
                    }
                    predecessor = target;
                    target = next;
                }
            }
        return handled;
    }
```

#### dispatchTransformedTouchEvent
该方法是事件分发递归分发的核心，是父view将事件分发给了子view的关键函数。在该方法中有两个比较关键的参数`cancel`以及`child`。`cancel`为true则传递给子view的事件变为MotionEvent.ACTION_CANCEL。`child`为null则调用自身作为View的dispatchTouchEvent(代码段3)；不为null时则调用child的dispatchTouchEvent(代码段1)。
这两者的不同造成总共四种结果：
* child = null && cancel = true: line 7
* child != null && cancel = true: line 9
* child = null && cancel = false: line 29
* chile != null && cancel = false: line 34

```c
   private boolean dispatchTransformedTouchEvent(MotionEvent event, boolean cancel,
            View child, int desiredPointerIdBits) {

        if (cancel || oldAction == MotionEvent.ACTION_CANCEL) {
            event.setAction(MotionEvent.ACTION_CANCEL);
            if (child == null) {
                handled = super.dispatchTouchEvent(event);
            } else {
                handled = child.dispatchTouchEvent(event);
            }
            event.setAction(oldAction);
            return handled;
        }

        // Calculate the number of pointers to deliver.
        final int oldPointerIdBits = event.getPointerIdBits();
        final int newPointerIdBits = oldPointerIdBits & desiredPointerIdBits;

        // If for some reason we ended up in an inconsistent state where it looks like we
        // might produce a motion event with no pointers in it, then drop the event.
        if (newPointerIdBits == 0) {
            return false;
        }

        final MotionEvent transformedEvent;
        if (newPointerIdBits == oldPointerIdBits) {
            if (child == null || child.hasIdentityMatrix()) {
                if (child == null) {
                    handled = super.dispatchTouchEvent(event);
                } else {
                    final float offsetX = mScrollX - child.mLeft;
                    final float offsetY = mScrollY - child.mTop;
                    event.offsetLocation(offsetX, offsetY);
                    handled = child.dispatchTouchEvent(event);
                    event.offsetLocation(-offsetX, -offsetY);
                }
                return handled;
            }
            transformedEvent = MotionEvent.obtain(event);
        } else {
            transformedEvent = event.split(newPointerIdBits);
        }

        return handled;
    }
```

#### View的dispatchTouchEvent()方法
这个方法就是具体处理event事件的地方，主要由`mOnTouchListener.onTouch`或是`onTouchEvent(event)`来处理，前者优先级高于后者。

```c
    public boolean dispatchTouchEvent(MotionEvent event) {

        boolean result = false;

        if (onFilterTouchEventForSecurity(event)) {
            //noinspection SimplifiableIfStatement
            ListenerInfo li = mListenerInfo;
            if (li != null && li.mOnTouchListener != null
                    && (mViewFlags & ENABLED_MASK) == ENABLED
                    && li.mOnTouchListener.onTouch(this, event)) {
                result = true;
            }

            if (!result && onTouchEvent(event)) {
                result = true;
            }
        }

        return result;
    }
```

#### 通过实例来验证源码
一般的博客到这里就开始给出了一些结论，但我觉得如果没有具体实例的分析，根本就无法将上述的分析融汇贯通。因此我就将借助https://newcircle.com/s/post/1567/mastering_the_android_touch_system中的三种情景来具体分析一下

##### 实例1
在实例1中ViewGroup和View都不对Touch事件做任何处理。从图中可以看到MotionEvent.ACTION_DOWN从Acticity的dispatchTouchEvent开始向下传递，直到View的dispatchTouchEvent，再从View的onTouchEvent回溯到Acticity。之后的Action就只不会再走U字型的传递路径了，直接传递给Activity的onTouchEvent()。但是之后不再传递的原因是什么呢？我们来分析一下。先看ACTION_DOWN的U型路径。由于中ViewGroup和View都不对Touch事件做任何处理，即在onTouchEvent()中返回false，所以代码1的86行递归调用的if判断为false，使得ViewGroup和View的mFirstTouchTarget都为null，因此之后会调用128行的代码，注意此时第2个参数child为null，根据上面对代码段2的分析，此时实质调用的是代码段3，即onTouchEvent()。再来看ACTION_MOVE/UP事件，因为mFirstTouchTarget=null, 所以直接跳到128行，不会执行中间86行的递归调用，因此也就没有U型路径了。(实质上Acticity之后的DecorView还是会调用dispatch和onTouch方法，但因为都在framework层中对于开发者是透明的，所以可以省略)

![](img/0DF2CB768115B54E3F8DF54A02802803.png)

##### 实例2
在实例2中ViewGroup仍然不对Touch事件做任何处理(onTouchEvent返回false)，而View则对任意Touch事件都做处理（OnTouchEvent返回true）。同样先看ACTION_DOWN事件，当执行到ViewGroup的dispatchTouchEvent的第68行时，传入的child就是View，之后调用View的dispatchTouchEvent，即代码段3，返回了true。因此ViewGroup中mFirstTouchTarget指向View。这时ViewGroup之后就开始执行138~139行的代码， handle为true。因此就不会调用ViewGroup的onTouchEvent代码了，同理也不会调用Activity的onTouchEvent函数了。再看ACTION_MOVE/UP事件, 因为mFirstTouchTarget != null, 所以此时会调用144行的判断语句，传入的child的参数为View。最后调用View的dispatchTouchEvent，即代码段2的34行，实质是代码段3中的onTouchEvent，并返回了true。之后144-145行一路true回溯上去，并不需要调用ViewGroup以及Activity的onTouchEvent()。

![](img/CD6A72DD1A4E02614A874FE1E0C0B63E.png)

##### 实例3
最后一个实例和上一个实例不同的地方在于当ACTION_MOVE/UP事件时，ViewGroup的onIntercept方法返回true表示拦截。ACTION_DOWN事件和上面的分发过程完全相同。但是当传递ACTION_MOVE/UP事件时，ViewGroup首先调用代码段1的22行返回true，即表示拦截。由于此时mFirstTouchTarget != null, 所以会调用到131行的else中，由于此时inteceped = true，因此此时cancelChild为true。此时代码段2处于上面分析的cancel=true && child!=null, 因此会像图中一样把ACTION_CANCEL传递给View。之后代码段2中151行会把mFirstTouchTarget置为空。之后的事件再过来就跟实例1类似了。
![](img/7A609C35AB4E3C9E83F35676B3C31F26.png)
