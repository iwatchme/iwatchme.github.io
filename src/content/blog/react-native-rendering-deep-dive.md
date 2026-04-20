---
title: RN 渲染原理深度解析
description: >-
  深度拆解 React Native 渲染机制，涵盖三棵树与三个线程的协作方式，对比 RN 与 React Web 在 Render/Commit
  阶段的差异，解析 iOS/Android 启动流程、Bridge 通信三大瓶颈，及新架构 JSI + Fabric + TurboModules 的原理。
pubDate: '2026-04-20'
tags:
  - react-native
  - react
draft: false
publish: true
slug: react-native-rendering-deep-dive
---
# React Native 渲染原理深度解析：从 JS 到 Native 视图的完整旅程

> 你写的是 React 代码，屏幕上出现的却是原生 View。中间到底发生了什么？
> 本文从架构层面拆解 RN 的渲染机制，重点讲清楚三件事：哪些和 React Web 一样，哪些是 RN 独有的，以及 JS 和 Native 之间到底怎么通信。

## 目录

1. [RN 整体架构：三棵树、三个线程](#1-rn-整体架构三棵树三个线程)
2. [与 React Web 共用的部分](#2-与-react-web-共用的部分)
3. [RN 独有的部分：没有 DOM，只有 Native](#3-rn-独有的部分没有-dom只有-native)
4. [RN 应用的启动流程](#4-rn-应用的启动流程)
5. [Render 阶段：构建 Fiber 树（和 React Web 几乎一样）](#5-render-阶段构建-fiber-树和-react-web-几乎一样)
6. [Commit 阶段：从 Fiber 到 Native 视图（RN 的核心差异）](#6-commit-阶段从-fiber-到-native-视图rn-的核心差异)
7. [老架构：Bridge 通信模型](#7-老架构bridge-通信模型)
8. [新架构：JSI + Fabric + TurboModules](#8-新架构jsi--fabric--turbomodules)
9. [事件处理与更新流程](#9-事件处理与更新流程)
10. [总结：一张图串联全流程](#10-总结一张图串联全流程)

---

## 1. RN 整体架构：三棵树、三个线程

React Native 的渲染流程可以用"三棵树"来概括：

```text
  你写的代码              React 运行时              C++ 层                Native 层
 ┌──────────┐           ┌──────────────┐        ┌──────────────┐      ┌──────────────┐
 │   JSX    │  Babel    │  Fiber Tree  │  指令   │ Shadow Tree  │  映射 │ Native Tree  │
 │ View/Text│ ────────→ │  (虚拟 DOM)   │ ─────→ │  (布局计算)   │ ───→ │  (真实视图)   │
 └──────────┘  编译      └──────────────┘        └──────────────┘      └──────────────┘
                              │                        │                      │
                         JS 线程                   C++ 线程               Native 主线程
```

三棵树各自的职责：

```text
Fiber Tree（JS 线程）：
  - 和 React Web 完全一样的虚拟 DOM 树
  - 通过 Reconciler 进行 diff，打上 PLACEMENT / UPDATE / DELETION 标记
  - Hooks（useState、useEffect）都在这一层运行

Shadow Tree（C++ 线程）：
  - RN 独有，React Web 没有这一层
  - 接收 Fiber Tree 的渲染指令，构建布局树
  - 使用 Yoga 引擎计算 Flexbox 布局（位置、大小）
  - 跨平台：iOS 和 Android 共用同一份 Shadow Tree

Native Tree（Native 主线程）：
  - iOS：UIView 层级树
  - Android：android.view.View 层级树
  - 根据 Shadow Tree 的布局结果，创建和更新真实的原生视图
```

为什么需要三棵树？因为 JS 不能直接操作原生视图（不像浏览器里可以直接操作 DOM），中间需要一个翻译层。Shadow Tree 就是这个翻译层——它既能被 JS 侧描述，又能被 Native 侧消费。

### 1.1 为什么 Web 端没有 Shadow Tree？

这是理解 RN 架构的关键问题。

在 React Web 中，布局计算是浏览器自动完成的：

```text
React Web 的流程：

  Fiber Tree (JS)
    │
    ▼ commitWork
  DOM Tree (浏览器)
    │ 浏览器自动完成以下工作：
    ├─ CSS 解析
    ├─ 布局计算（Layout）：每个元素的 x, y, width, height
    ├─ 绘制（Paint）
    └─ 合成（Composite）

  你写 <div style={{width: 100, padding: 20}}>
  浏览器自动算出：这个 div 宽 100px，内容区 60px，位置在 (x, y)
  React 不需要关心布局计算，浏览器全包了。
```

但在 RN 中，没有浏览器！iOS 的 UIKit 和 Android 的 View 系统各有各的布局方式，而且 JS 线程和 Native 主线程是隔离的。如果让 Native 自己算布局，会有两个问题：

```text
问题 1：跨平台不一致
  同样的 style={{flexDirection: 'row', justifyContent: 'center'}}
  iOS 的 Auto Layout 和 Android 的 LinearLayout 算出来的结果可能不一样
  → 需要一个统一的布局引擎

问题 2：布局信息回传开销
  如果 Native 算完布局，JS 侧想知道某个元素的位置和大小
  → 需要通过 Bridge 异步回传，延迟大
  → 新架构中 C++ 算布局，JS 通过 JSI 同步获取，延迟极小
```

Shadow Tree 就是为了解决这些问题而存在的：

```text
React Native 的流程：

  Fiber Tree (JS 线程)
    │ 描述"要渲染什么"
    │
    ▼ createView / setChildren 指令
  Shadow Tree (C++ 线程)
    │ 做三件事：
    │ ① 用 Yoga 引擎统一计算 Flexbox 布局（跨平台一致）
    │ ② 确定每个节点的 x, y, width, height
    │ ③ 把布局结果传给 Native
    │
    ▼ 布局结果
  Native Tree (Native 主线程)
    │ 只负责"按照布局结果创建和摆放视图"
    │ 不需要自己算布局
    └─ iOS: UIView.frame = CGRect(x, y, width, height)
       Android: view.layout(left, top, right, bottom)
```

用一个具体例子对比：

```tsx
// 你写的样式
<View style={{ flexDirection: 'row', padding: 10 }}>
  <Text style={{ flex: 1 }}>左边</Text>
  <Text style={{ flex: 2 }}>右边</Text>
</View>
```

```text
React Web：
  → 浏览器拿到 DOM + CSS
  → 浏览器的布局引擎自动计算：
      View: x=0, y=0, width=375, height=40
      左边: x=10, y=10, width=115, height=20
      右边: x=125, y=10, width=230, height=20
  → 浏览器自动绘制

React Native：
  → JS 发送 createView 指令给 C++/Native
  → Shadow Tree 中的 Yoga 引擎计算 Flexbox 布局：
      RCTView: x=0, y=0, width=375, height=40
      RCTText"左边": x=10, y=10, width=115, height=20
      RCTText"右边": x=125, y=10, width=230, height=20
  → 把计算结果传给 Native
  → Native 按照坐标创建和摆放 UIView/android.view.View
```

一句话总结：**Shadow Tree 就是 RN 的"浏览器布局引擎"**。Web 端浏览器自带布局能力，所以不需要 Shadow Tree；RN 没有浏览器，需要自己用 Yoga 算布局，Shadow Tree 就是承载这个计算的中间层。

### 1.2 Yoga 引擎如何统一 iOS 和 Android 的布局？

你可能注意到了，iOS 和 Android 设置布局的 API 参数完全不同：

```text
iOS:     UIView.frame = CGRect(x, y, width, height)    // 用 x, y, 宽, 高
Android: view.layout(left, top, right, bottom)          // 用 左, 上, 右, 下
```

但这不影响 Yoga 的统一性。因为 Yoga 输出的是一套平台无关的标准结果，各平台只需要做一层简单的数值转换：

```text
Yoga 引擎的输出（C++ 层，平台无关）：
  每个 Shadow Node 计算完后，都有这四个值：
    node.layout.left   = 10    // 相对于父节点的左偏移
    node.layout.top    = 20    // 相对于父节点的上偏移
    node.layout.width  = 200   // 宽度
    node.layout.height = 40    // 高度

  这四个值在 iOS 和 Android 上完全一样——Yoga 是 C++ 写的，
  同一份代码编译到两个平台，计算结果一致。
```

```text
各平台拿到 Yoga 的结果后，做一层简单转换：

  iOS 的转换：
    // Yoga 输出 → CGRect
    view.frame = CGRect(
      x:      node.layout.left,     // 10
      y:      node.layout.top,      // 20
      width:  node.layout.width,    // 200
      height: node.layout.height    // 40
    )

  Android 的转换：
    // Yoga 输出 → left/top/right/bottom
    view.layout(
      left:   node.layout.left,                          // 10
      top:    node.layout.top,                           // 20
      right:  node.layout.left + node.layout.width,      // 10 + 200 = 210
      bottom: node.layout.top  + node.layout.height      // 20 + 40  = 60
    )
```

```text
整个流程：

  你写的样式                    Yoga（C++ 层）                 平台适配层
  style={{                     统一计算 Flexbox               简单数值转换
    flexDirection: 'row',  →   left=10, top=20,          →   iOS: CGRect(10,20,200,40)
    padding: 10,               width=200, height=40           Android: layout(10,20,210,60)
    flex: 1                                                   ↑
  }}                           ↑                              只是换了一种表达方式
                               这一步 iOS/Android 结果完全一样   数值本质上是一样的
```

所以 Yoga 的统一性体现在：**布局计算只做一次，在 C++ 层完成，结果是平台无关的四个数值（left, top, width, height）**。iOS 和 Android 的 API 参数虽然不同，但只是同一组数值的不同表达方式，转换是无损的。

---

## 2. 与 React Web 共用的部分

很多人以为 RN 是一套全新的框架。实际上，RN 和 React Web 共享了大量核心代码。

### 2.1 完全共用的部分

```text
┌─────────────────────────────────────────────────┐
│                    React 核心                     │
│                                                   │
│  ✅ createElement / JSX 编译                      │
│  ✅ Hooks（useState, useEffect, useRef...）       │
│  ✅ Component 基类（setState, forceUpdate）       │
│  ✅ Context（createContext, useContext）           │
│  ✅ Fiber 架构（虚拟 DOM 节点结构）                │
│  ✅ Reconciler（diff 算法，打标记）                │
│  ✅ 调度器（时间分片，优先级）                     │
│                                                   │
│  这些代码 RN 和 Web 用的是同一个 react 包          │
└─────────────────────────────────────────────────┘
```

也就是说，你在 Mini React 中实现的 `createElement`、`useState`、`useEffect`、Fiber 链表遍历、Reconcile diff——这些在 RN 中原理完全一样。

### 2.2 不同的部分

```text
                React Web                          React Native
          ┌─────────────────┐               ┌─────────────────────┐
 渲染器    │   react-dom      │               │  react-native       │
          │   (操作 DOM)     │               │  (发送 Native 指令)  │
          └─────────────────┘               └─────────────────────┘
 宿主组件  │ div, span, p     │               │ View, Text, Image   │
 事件系统  │ 浏览器事件        │               │ Native 触摸事件      │
 布局引擎  │ 浏览器 CSS 引擎   │               │ Yoga (Flexbox)      │
 渲染目标  │ DOM 树           │               │ Native View 树      │
```

一句话总结：**React 负责"算出什么变了"，渲染器负责"把变化应用到哪里"**。Web 应用到 DOM，RN 应用到 Native View。

---

## 3. RN 独有的部分：没有 DOM，只有 Native

### 3.1 组件映射：View 不是 div

在 React Web 中，你写 `<div>`，浏览器直接创建一个 DOM 元素。
在 RN 中，你写 `<View>`，最终会变成原生视图：

```tsx
// 你写的 RN 代码
import { View, Text } from 'react-native'

function App() {
  return (
    <View style={{ padding: 20 }}>
      <Text>Hello React Native</Text>
    </View>
  )
}
```

```text
RN 组件 → Native 视图的映射关系：

  <View>    →  iOS: UIView        / Android: android.view.View
  <Text>    →  iOS: UILabel       / Android: TextView
  <Image>   →  iOS: UIImageView   / Android: ImageView
  <ScrollView> → iOS: UIScrollView / Android: ScrollView
  <TextInput>  → iOS: UITextField  / Android: EditText
```

### 3.2 View 组件的底层实现

`<View>` 看起来像一个普通 React 组件，但它的底层指向了一个 Native 组件名称：

```tsx
// RN 源码 Libraries/Components/View/View.js（简化）
const View = React.forwardRef((props, forwardedRef) => {
  return (
    <TextAncestor.Provider value={false}>
      <ViewNativeComponent {...props} />
    </TextAncestor.Provider>
  )
})
```

`ViewNativeComponent` 的本质是一个注册了 `RCTView` 名称的原生组件：

```ts
// ViewNativeComponent 最终会被标记为 HostComponent
// 在 Fiber 中，它的 tag 是 HostComponent
// 它的 viewConfig.uiViewClassName = 'RCTView'
```

当 Reconciler 处理到这个 Fiber 节点时，不会像 Web 那样调用 `document.createElement('div')`，而是发送一条指令给 Native：

```text
// Web 的做法：
document.createElement('div')  →  直接创建 DOM 节点

// RN 的做法：
UIManager.createView(tag, 'RCTView', rootTag, props)  →  发指令给 Native
                                                          Native 创建 UIView
```

这就是 RN 最核心的差异：**JS 侧不创建视图，只发指令；Native 侧接收指令，创建真实视图。**

---

## 4. RN 应用的启动流程

### 4.1 应用注册

RN 应用的入口和 React Web 不同。Web 用 `ReactDOM.render()`，RN 用 `AppRegistry.registerComponent()`：

```tsx
// React Web 入口
import ReactDOM from 'react-dom'
ReactDOM.render(<App />, document.getElementById('root'))

// React Native 入口
import { AppRegistry } from 'react-native'
import App from './App'
AppRegistry.registerComponent('MyApp', () => App)
```

`registerComponent` 并不会立即渲染，它只是把组件注册到一个全局表里，等 Native 来启动：

```ts
// RN 源码 Libraries/ReactNative/AppRegistry.js（简化）
const runnables: Record<string, any> = {}

const AppRegistry = {
  // 注册应用（JS 侧调用）
  registerComponent(appKey, componentProvider) {
    runnables[appKey] = {
      componentProvider,
      run: (appParameters) => {
        renderApplication(componentProvider(), appParameters.initialProps)
      }
    }
  },

  // 运行应用（Native 侧调用）
  runApplication(appKey, appParameters) {
    runnables[appKey].run(appParameters)
  }
}
```

### 4.2 Native 启动 RN 应用

#### 总体时序

```text
① Native 应用启动（iOS AppDelegate / Android MainActivity）
    │
    ▼
② 创建 RN 容器视图（iOS RCTRootView / Android ReactRootView）
    │
    ▼
③ 初始化 React 上下文（创建 JS 引擎、NativeModule 注册表、Bridge/JSI）
    │
    ▼
④ 加载并执行 JS Bundle（你写的所有代码编译后的产物）
    │
    ▼
⑤ JS 执行 AppRegistry.registerComponent('MyApp', () => App)
   → 把 App 组件注册到 runnables 表中
    │
    ▼
⑥ Native 通过 Bridge/JSI 调用 AppRegistry.runApplication('MyApp', { initialProps })
   → 触发 renderApplication
    │
    ▼
⑦ renderApplication 内部创建容器组件，进入 React Reconciler 流程
```

#### Android 端启动代码

Android 端的启动入口是 `ReactActivity` → `ReactRootView`：

```java
// Android 端：MainActivity.java（你的 RN 项目中）
public class MainActivity extends ReactActivity {
  @Override
  protected String getMainComponentName() {
    return "MyApp";  // 对应 JS 侧 registerComponent 的第一个参数
  }
}
```

`ReactActivity` 内部会创建 `ReactRootView`，这是承载整个 RN 应用的 Android 视图容器：

```java
// Android 端：ReactRootView.java（RN 源码）
// ReactRootView 继承自 FrameLayout，是一个普通的 Android 视图
public class ReactRootView extends FrameLayout implements RootView, ReactRoot {
  // ...
}
```

`ReactRootView` 的 `startReactApplication` 方法是 Native 侧启动 RN 的核心入口：

```java
// Android 端：ReactRootView.java
public void startReactApplication(
    ReactInstanceManager reactInstanceManager,  // React 实例管理器
    String moduleName,                          // 应用名称，如 "MyApp"
    @Nullable Bundle initialProperties,         // 初始化参数
    @Nullable String initialUITemplate) {

  // ① 创建 React JS 上下文（JS 引擎、Bridge、NativeModule 注册表）
  mReactInstanceManager.createReactContextInBackground();

  // ② 将 ReactRootView 和 reactInstanceManager 关联
  Assertions.assertNotNull(mReactInstanceManager).attachRootView(this);
}
```

`createReactContextInBackground` 会在一个新的 Java 线程中初始化整个 RN 环境：

```java
// Android 端：ReactInstanceManager.java
// 在后台线程中创建 React 上下文
new Thread(null, new Runnable() {
  public void run() {
    // 创建 JS 运行上下文
    reactApplicationContext = createReactContext(
      initParams.getJsExecutorFactory().create(),  // JS 执行器（Hermes/JSC）
      initParams.getJsBundleLoader()               // JS Bundle 加载器
    );
  }
})
```

`createReactContext` 是初始化的核心，做了四件事：

```java
// Android 端：ReactInstanceManager.java
private ReactApplicationContext createReactContext(
    JavaScriptExecutor jsExecutor,
    JSBundleLoader jsBundleLoader) {

  // ① 初始化 NativeModule 注册表（收集所有 @ReactMethod 标注的方法）
  NativeModuleRegistry nativeModuleRegistry =
    processPackages(reactContext, mPackages, false);

  // ② 创建 CatalystInstance（通信管理类，连接 JS ↔ C++ ↔ Native）
  catalystInstance = catalystInstanceBuilder.build();

  // ③ 将 CatalystInstance 赋值到 ReactContext 中
  reactContext.initializeWithInstance(catalystInstance);

  // ④ 加载并执行 JS Bundle
  catalystInstance.runJSBundle();

  return reactContext;
}
```

其中 `CatalystInstance` 是整个通信的核心枢纽（在 7.5 节有详细介绍），它的构造函数会初始化 Bridge：

```java
// Android 端：CatalystInstanceImpl.java
private CatalystInstanceImpl() {
  mHybridData = initHybrid();

  // 创建线程配置
  mReactQueueConfiguration = ReactQueueConfigurationImpl.create(
    reactQueueConfigurationSpec, new NativeExceptionHandler()
  );

  // 初始化桥（把 NativeModule 信息传递给 C++ 层）
  initializeBridge(
    new BridgeCallback(this),
    jsExecutor,
    mReactQueueConfiguration.getJSQueueThread(),
    mNativeModulesQueueThread,
    mNativeModuleRegistry.getJavaModules(this),
    mNativeModuleRegistry.getCxxModules()
  );
}
```

JS Bundle 执行完毕后，`AppRegistry.registerComponent` 已经把应用注册好了。接下来 Native 调用 `runApplication`：

```java
// Android 端：ReactRootView.java
// attachRootView 之后，Native 调用 JS 的 runApplication
@Override
public void runApplication() {
  catalystInstance
    .getJSModule(AppRegistry.class)
    .runApplication(jsAppModuleName, appParams);
  // 这一步通过 Bridge/JSI 调用 JS 侧的 AppRegistry.runApplication
  // 详细调用链见 7.5 节 "Native → JS 的完整调用链"
}
```

#### iOS 端启动代码

iOS 端的启动入口是 `AppDelegate`：

```objc
// iOS 端：AppDelegate.m（你的 RN 项目中）
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {

  // ① 创建 RCTBridge（通信管理类，对应 Android 的 CatalystInstance）
  RCTBridge *bridge = [[RCTBridge alloc]
    initWithDelegate:self
    launchOptions:launchOptions];

  // ② 创建 RCTRootView（承载 RN 应用的 iOS 视图，对应 Android 的 ReactRootView）
  RCTRootView *rootView = [[RCTRootView alloc]
    initWithBridge:bridge
    moduleName:@"MyApp"           // 对应 JS 侧 registerComponent 的第一个参数
    initialProperties:nil];

  // ③ 设置为窗口的根视图
  self.window.rootViewController.view = rootView;
  [self.window makeKeyAndVisible];

  return YES;
}

// 指定 JS Bundle 的位置
- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge {
  // 开发环境：从 Metro 开发服务器加载
  // 生产环境：从本地 main.jsbundle 加载
  return [[RCTBundleURLProvider sharedSettings]
    jsBundleURLForBundleRoot:@"index"];
}
```

`RCTBridge` 初始化时会做和 Android 类似的事情：

```objc
// iOS 端：RCTBridge.m（RN 源码，简化）
- (void)setUp {
  // ① 创建 JS 执行线程
  _jsThread = [[NSThread alloc] initWithTarget:self
    selector:@selector(runJSRunLoop) object:nil];

  // ② 初始化 NativeModule 注册表
  [self registerModules];

  // ③ 加载并执行 JS Bundle
  [self loadSource:^(NSError *error, RCTSource *source) {
    [self executeSourceCode:source.data];
  }];
}
```

JS Bundle 执行完毕后，`RCTRootView` 会触发 `runApplication`：

```objc
// iOS 端：RCTRootView.m（RN 源码，简化）
- (void)runApplication:(RCTBridge *)bridge {
  // 通过 Bridge 调用 JS 侧的 AppRegistry.runApplication
  [bridge enqueueJSCall:@"AppRegistry"
                 method:@"runApplication"
                   args:@[moduleName, appParameters]
             completion:NULL];
}
```

#### Android 和 iOS 启动流程对比

```text
                    Android                              iOS
 ──────────────────────────────────────────────────────────────────
 入口           MainActivity                       AppDelegate
                (extends ReactActivity)            didFinishLaunchingWithOptions

 容器视图       ReactRootView                      RCTRootView
                (extends FrameLayout)              (extends UIView)

 通信管理       CatalystInstanceImpl               RCTBridge
                initializeBridge()                 setUp()

 JS 实例管理    ReactInstanceManager               RCTBridge（合并了）
                createReactContext()

 初始化线程     new Thread() { createReactContext } NSThread runJSRunLoop

 NativeModule   NativeModuleRegistry               RCTModuleData
 注册表         processPackages()                   registerModules

 加载 Bundle    catalystInstance.runJSBundle()      executeSourceCode()

 启动 RN 应用   catalystInstance                    bridge
                .getJSModule(AppRegistry.class)     enqueueJSCall("AppRegistry",
                .runApplication(name, params)         "runApplication", args)
 ──────────────────────────────────────────────────────────────────
 最终都是调用 JS 侧的 AppRegistry.runApplication → renderApplication → React Reconciler
```

#### 进入 JS 侧：renderApplication

Native 调用 `runApplication` 后，JS 侧的 `AppRegistry` 从 `runnables` 中找到对应的应用并执行 `renderApplication`：

```tsx
// RN 源码 Libraries/ReactNative/renderApplication.js（简化）
function renderApplication(RootComponent, initialProps) {
  // 创建容器组件
  const renderable = (
    <PerformanceLoggerContext.Provider>
      <AppContainer>
        <RootComponent {...initialProps} />
      </AppContainer>
    </PerformanceLoggerContext.Provider>
  )

  // 进入渲染流程（相当于 React Web 的 ReactDOM.render）
  Renderer.renderElement({
    element: renderable,
    rootTag,
    useFabric: Boolean(fabric),  // 是否使用新架构
  })
}
```

```tsx
// renderElement 根据架构选择不同的渲染器
function renderElement({ element, rootTag, useFabric }) {
  if (useFabric) {
    // 新架构：Fabric 渲染器
    require('../Renderer/shims/ReactFabric').render(element, rootTag)
  } else {
    // 老架构：传统渲染器
    require('../Renderer/shims/ReactNative').render(element, rootTag)
  }
}
```

从这里开始，就进入了 React 的 Reconciler 流程——和 Web 端几乎一样。

---

## 5. Render 阶段：构建 Fiber 树（和 React Web 几乎一样）

### 5.1 入口：performSyncWorkOnRoot

无论是 Web 还是 RN，Reconciler 的核心入口都是同一个函数：

```ts
// React Reconciler 核心流程（Web 和 RN 共用）
function performSyncWorkOnRoot(root) {
  // render 阶段：遍历 Fiber 树，diff 打标记
  var exitStatus = renderRootSync(root, lanes)

  // commit 阶段：把标记应用到宿主环境
  commitRoot(root, workInProgressRootRecoverableErrors, workInProgressTransitions)

  // 检查是否还有待处理的更新
  ensureRootIsScheduled(root, now())
}
```

这和 Mini React 中的 `workLoop` + `commitRoot` 是同一个思路，只是真实 React 多了优先级调度。

### 5.2 workLoopSync：逐个处理 Fiber

```ts
// React Reconciler（Web 和 RN 共用）
function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress)
  }
}
```

每个 Fiber 节点经历两个阶段：

```ts
function performUnitOfWork(unitOfWork) {
  // ① beginWork：从上往下，创建/更新子 Fiber
  var next = beginWork(current, unitOfWork, renderLanes)

  if (next === null) {
    // ② completeWork：从下往上，收集 effectTag
    completeUnitOfWork(unitOfWork)
  } else {
    workInProgress = next
  }
}
```

```text
遍历顺序（和 Mini React 一样，深度优先）：

以这个 RN 组件为例：
  <View>
    <Text>小程序：《大前端跨端开发指南》</Text>
    <View>
      <Text>作者：我不是外星人</Text>
    </View>
  </View>

形成的 Fiber 树：

      App (FunctionComponent)
       │
       ▼ child
      View (HostComponent, viewName: 'RCTView')
       │
       ▼ child
      Text (HostComponent, viewName: 'RCTText') ──sibling──→ View (RCTView)
       │                                                        │
       ▼ child                                                  ▼ child
    RawText "小程序..."                                       Text (RCTText)
                                                                │
                                                                ▼ child
                                                             RawText "作者..."

beginWork 顺序（向下）：
  App → View → Text → RawText"小程序" →
  回溯到 Text → sibling → View → Text → RawText"作者" →
  回溯到顶部

completeWork 顺序（向上）：
  RawText"小程序" → Text → RawText"作者" → Text → View(内) → View(外) → App
```

### 5.3 beginWork 中的关键差异

在 `beginWork` 阶段，RN 和 Web 处理函数组件的方式完全一样：

```ts
// 函数组件（App、自定义组件）→ Web 和 RN 完全一样
function updateFunctionComponent(fiber) {
  // 执行函数，Hooks 在这里被调用
  const children = Component(props)
  reconcileChildren(current, fiber, children)
}
```

但处理宿主组件（HostComponent）时有区别：

```ts
// Web 中的 HostComponent：div, span, p
// → fiber.type = "div"
// → 最终调用 document.createElement("div")

// RN 中的 HostComponent：View, Text, Image
// → fiber.type = "RCTView", "RCTText", "RCTImage"
// → 最终发送 createView 指令给 Native
```

不过在 Render 阶段，两者都只是打标记（`flags`），不做实际操作。真正的差异在 Commit 阶段。

### 5.4 Render 阶段小结

```text
Render 阶段 RN 和 Web 的对比：

                        React Web              React Native
 ─────────────────────────────────────────────────────────
 Reconciler             ✅ 相同                 ✅ 相同
 Fiber 结构             ✅ 相同                 ✅ 相同
 diff 算法              ✅ 相同                 ✅ 相同
 Hooks 执行             ✅ 相同                 ✅ 相同
 时间分片/优先级         ✅ 相同                 ✅ 相同
 HostComponent type     "div","span"           "RCTView","RCTText"
 ─────────────────────────────────────────────────────────
 结论：Render 阶段几乎完全一样，差异只在组件名称
```

---

## 6. Commit 阶段：从 Fiber 到 Native 视图（RN 的核心差异）

Commit 阶段是 RN 和 Web 分道扬镳的地方。Web 操作 DOM，RN 发送指令给 Native。

### 6.1 Web 的 Commit：直接操作 DOM

```ts
// React Web 的 commit（简化，和 Mini React 类似）
function commitWork(fiber) {
  if (fiber.effectTag === 'PLACEMENT') {
    domParent.appendChild(fiber.dom)        // 直接操作 DOM
  } else if (fiber.effectTag === 'UPDATE') {
    updateDom(fiber.dom, oldProps, newProps) // 直接更新 DOM 属性
  } else if (fiber.effectTag === 'DELETION') {
    domParent.removeChild(fiber.dom)        // 直接删除 DOM
  }
}
```

### 6.2 RN 的 Commit：发送指令给 Native

RN 不能直接操作视图，它通过 UIManager 发送指令：

```ts
// RN 老架构的 commit（简化）
function commitWork(fiber) {
  if (fiber.flags & Placement) {
    // 不是 appendChild，而是发指令！
    UIManager.createView(
      fiber.tag,              // 唯一标识（如 3, 5, 7...）
      fiber.viewName,         // 组件名（如 'RCTView', 'RCTText'）
      rootTag,                // 根视图标识
      fiber.props             // 属性（style, children 等）
    )
    UIManager.setChildren(parentTag, [fiber.tag])
  }
  else if (fiber.flags & Update) {
    UIManager.updateView(
      fiber.tag,
      fiber.viewName,
      changedProps            // 只传变化的属性
    )
  }
  else if (fiber.flags & Deletion) {
    UIManager.manageChildren(
      parentTag,
      null, null,
      null, null,
      [indexToRemove]         // 要删除的索引
    )
  }
}
```

### 6.3 图解：一个 RN 组件的完整渲染指令

以这个组件为例：

```tsx
import { View, Text } from 'react-native'

function App() {
  return (
    <View>
      <Text>小程序：《大前端跨端开发指南》</Text>
      <View>
        <Text>作者：我不是外星人</Text>
      </View>
    </View>
  )
}
```

Commit 阶段发出的指令序列：

```text
深度优先遍历 Fiber 树，每遇到 HostComponent 就发指令：

① 遍历到 RawText "小程序..."
   JS → Native: UIManager.createView(3, 'RCTRawText', { content: '小程序：《大前端跨端开发指南》' })

② 遍历到 Text
   JS → Native: UIManager.createView(5, 'RCTText', {})
   JS → Native: UIManager.setChildren(5, [3])     ← 把 RawText 插入 Text

③ 遍历到 RawText "作者..."
   JS → Native: UIManager.createView(7, 'RCTRawText', { content: '作者：我不是外星人' })

④ 遍历到内层 Text
   JS → Native: UIManager.createView(9, 'RCTText', {})
   JS → Native: UIManager.setChildren(9, [7])     ← 把 RawText 插入 Text

⑤ 遍历到内层 View
   JS → Native: UIManager.createView(11, 'RCTView', {})
   JS → Native: UIManager.setChildren(11, [9])    ← 把 Text 插入 View

⑥ 遍历到外层 View
   JS → Native: UIManager.createView(13, 'RCTView', {})
   JS → Native: UIManager.setChildren(13, [5, 11]) ← 把 Text 和 View 插入外层 View
```

Native 侧收到这些指令后：

```text
Android 侧：
  tag=3  → new TextView("小程序：《大前端跨端开发指南》")
  tag=5  → new ViewGroup()  →  addView(tag3)
  tag=7  → new TextView("作者：我不是外星人")
  tag=9  → new ViewGroup()  →  addView(tag7)
  tag=11 → new android.view.View()  →  addView(tag9)
  tag=13 → new android.view.View()  →  addView(tag5, tag11)

iOS 侧：
  tag=3  → [[UILabel alloc] init]  setText:@"小程序..."
  tag=5  → [[UIView alloc] init]   addSubview:tag3
  ...同理

最终形成 Native View 树（Shadow Tree → Native Tree）：

  RCTView (tag=13)
    ├── RCTText (tag=5)
    │     └── RCTRawText (tag=3) "小程序：《大前端跨端开发指南》"
    └── RCTView (tag=11)
          └── RCTText (tag=9)
                └── RCTRawText (tag=7) "作者：我不是外星人"
```

### 6.4 对比：Web Commit vs RN Commit

```text
                     React Web                    React Native
 ────────────────────────────────────────────────────────────────
 新增元素    dom.appendChild(element)     UIManager.createView(tag, viewName, props)
                                          UIManager.setChildren(parentTag, [childTags])

 更新元素    dom.className = "new"        UIManager.updateView(tag, viewName, changedProps)
            dom.addEventListener(...)

 删除元素    dom.removeChild(element)     UIManager.manageChildren(parentTag, ..., [removeIndex])

 执行环境    同步，在 JS 主线程直接操作     异步，指令通过 Bridge/JSI 传递给 Native 线程
 ────────────────────────────────────────────────────────────────
```

---

## 7. 老架构：Bridge 通信模型

在 RN 0.68 之前的老架构中，JS 和 Native 之间通过 Bridge（桥）通信。理解 Bridge 是理解 RN 性能瓶颈的关键。

### 7.1 Bridge 的本质：JSON 序列化的消息队列

```text
  JS 线程                    Bridge                    Native 线程
 ┌──────────┐            ┌──────────────┐            ┌──────────────┐
 │ setState │  JSON 序列化 │ MessageQueue │  JSON 反序列化│ UIManager    │
 │ → diff   │ ──────────→ │  (异步队列)   │ ──────────→ │ → createView │
 │ → 指令   │             │              │             │ → 渲染视图    │
 └──────────┘            └──────────────┘            └──────────────┘
                               │
                          所有数据都要经过
                          JSON.stringify / JSON.parse
```

每一条指令都要经过序列化：

```ts
// JS 侧发出的指令
UIManager.createView(3, 'RCTView', 1, { style: { padding: 20 } })

// 实际通过 Bridge 传递的数据（JSON 序列化）
{
  "module": "UIManager",
  "method": "createView",
  "args": [3, "RCTView", 1, {"style": {"padding": 20}}]
}

// Native 侧收到后反序列化，再执行对应的方法
```

### 7.2 Bridge 的三大问题

```text
问题 1：序列化开销
  每次通信都要 JSON.stringify + JSON.parse
  大量数据（如长列表）传输时，序列化本身就很耗时

  JS: { items: [{id:1,name:"..."}, {id:2,name:"..."}, ...1000个] }
       ↓ JSON.stringify（耗时！）
  Bridge: "{"items":[{"id":1,"name":"..."},...]}"
       ↓ JSON.parse（又耗时！）
  Native: 终于拿到数据了...

问题 2：异步通信
  JS 和 Native 不能同步调用对方
  所有通信都是异步的，放入消息队列等待处理

  JS: "我要获取屏幕宽度"
       → 放入队列 → 等待...
  Native: "收到，宽度是 375"
       → 放入队列 → 等待...
  JS: "终于拿到了"（已经过了好几帧）

问题 3：单通道瓶颈
  所有模块的通信共用一个 Bridge
  渲染指令、事件回调、网络请求、动画... 全部排队

  渲染指令: createView → 排队
  触摸事件: onPress → 排队
  网络回调: fetch result → 排队
  动画帧:  animate → 排队（动画卡顿的根源！）
```

### 7.3 Commit 阶段如何触发 Bridge 通信

这是老架构最关键的部分。很多人知道"RN 通过 Bridge 通信"，但不清楚具体是在哪一步、怎么触发的。

先回顾一下 React 的两大阶段：

```text
performSyncWorkOnRoot
  │
  ├─ Render 阶段（renderRootSync）
  │   workLoopSync → performUnitOfWork
  │     ├─ beginWork：向下遍历，执行组件函数，diff 打标记
  │     └─ completeWork：向上归并，创建节点实例
  │
  └─ Commit 阶段（commitRoot → commitRootImpl）
      ├─ BeforeMutation：更新前（getSnapshotBeforeUpdate）
      ├─ Mutation：执行 DOM 操作（appendChild / updateView / removeChild）
      └─ Layout：更新后（componentDidMount / useLayoutEffect）
```

在 RN 中，**通信发生在两个时机**：

#### 时机一：completeWork 阶段 → 创建节点

当 Render 阶段向上归并时，遇到 HostComponent（View、Text 等），会调用 `createInstance` 创建节点实例。这一步在老架构中就会触发 Bridge 通信：

```ts
// 老架构：创建 View 元素
// 来自 RN 源码 ReactNativeRenderer.js（简化）
function createInstance(type, props, rootContainerInstance, hostContext) {
  // 通过 Bridge 发送 createView 指令给 Native！
  ReactNativePrivateInterface.UIManager.createView(
    tag,                          // reactTag（唯一标识，如 3, 5, 7...）
    viewConfig.uiViewClassName,   // viewName（如 'RCTView', 'RCTText'）
    rootContainerInstance,        // rootTag（根视图标识）
    updatePayload                 // props（样式、属性等）
  )

  // 创建 JS 侧的组件引用
  var component = new ReactNativeFiberHostComponent(
    tag,
    viewConfig,
    internalInstanceHandle
  )
}

// 创建文本节点
function createTextInstance(text, rootContainerInstance, hostContext) {
  ReactNativePrivateInterface.UIManager.createView(
    tag,
    'RCTRawText',                 // 文本节点固定用 RCTRawText
    rootContainerInstance,
    { text: text }                // 文本内容作为 props
  )
}
```

这些 `UIManager.createView` 调用会通过 Bridge 传递给 Native 侧。以 Android 为例：

```java
// Android 端：UIManagerModule.java
@ReactMethod
public void createView(int tag, String className, int rootViewTag,
                        ReadableMap props) {
  // 创建 Shadow Node（用于布局计算）
  ReactShadowNode cssNode = createShadowNode(className);

  // 将 Shadow Node 添加到注册表
  mShadowNodeRegistry.addNode(cssNode);

  // 设置样式属性
  cssNode.updateProperties(styles);

  // 处理创建逻辑
  handleCreateView(cssNode, rootViewTag, styles);
}

// createShadowNode 根据 className 找到对应的 ViewManager
protected ReactShadowNode createShadowNode(String className) {
  ViewManager viewManager = mViewManagers.get(className);
  return viewManager.createShadowNodeInstance(mReactContext);
}
```

```java
// handleCreateView 最终会生成一个 Operation 放入队列
protected void handleCreateView() {
  mNativeViewHierarchyOptimizer.handleCreateView(cssNode,
    cssNode.getThemedContext(), styles);
}

// 创建 UI 操作指令，放入操作队列
public void enqueueCreateView() {
  mCreateViewCount++;
  mNonBatchedOperations.addLast(
    new CreateViewOperation(themedContext, viewReactTag,
      viewClassName, initialProps)
  );
}
```

iOS 端类似：

```objc
// iOS 端：RCTUIManager.m
RCT_EXPORT_METHOD(createView
                  :(nonnull NSNumber *)reactTag
                  viewName:(NSString *)viewName
                  rootTag:(nonnull NSNumber *)rootTag
                  props:(NSDictionary *)props)
```

```text
组件名 → Shadow Node → Native 组件的映射关系：

  Android:
    React 组件    Shadow Node              Native 组件
    <View>    →  LayoutShadowNode      →  android.view.View
    <Text>    →  ReactTextShadowNode   →  ReactTextView
    <Image>   →  LayoutShadowNode      →  ReactImageView

  iOS:
    React 组件    Shadow Node              Native 组件
    <View>    →  RCTShadowView         →  RCTView
    <Text>    →  RCTTextShadowView     →  RCTTextView
    <Image>   →  RCTImageShadowView    →  RCTImageView
```

#### 时机二：Commit Mutation 阶段 → 插入、更新、删除

Render 阶段创建了节点，但还没有建立父子关系。在 Commit 的 Mutation 阶段，会执行 `setChildren`（插入）、`updateView`（更新）、`manageChildren`（删除）等操作：

```ts
// 真实 React 的 commitRootImpl — 三个子阶段
function commitRootImpl() {
  // BeforeMutation：更新前（getSnapshotBeforeUpdate、调度 useEffect）
  commitBeforeMutationEffects(root, transitions)

  // Mutation：执行实际的 DOM/Native 操作 ← Bridge 通信在这里！
  commitMutationEffectsOnFiber(transitions, root)

  // 双缓冲切换
  root.current = transitions

  // Layout：更新后（componentDidMount、useLayoutEffect）
  commitLayoutEffects(transitions, root, lanes)
}
```

> 关于这三个子阶段和 Mini React 的 `commitRoot` 的详细对比，见 [React Hooks 深度解析 - 第 9.1 节](blog-react-hooks-deep-dive.md#91-commit-阶段mini-react-合并了真实-react-的三个子阶段)。

Mutation 阶段会根据 Fiber 上的 flags 发送不同的指令：

```ts
// 老架构 Mutation 阶段发送的指令（简化）

// 新增子节点：setChildren
// 把 childTag 插入到 parentTag 下
ReactNativePrivateInterface.UIManager.setChildren(parentTag, [childTag1, childTag2])

// 更新节点属性：updateView
// 只传变化的 props
ReactNativePrivateInterface.UIManager.updateView(tag, viewName, changedProps)

// 删除/移动子节点：manageChildren
// moveFrom/moveTo 处理移动，removeFrom 处理删除
ReactNativePrivateInterface.UIManager.manageChildren(
  parentTag,
  moveFrom, moveTo,
  addChildTags, addAtIndices,
  removeFrom
)
```

Android 端接收 `updateView` 指令的处理：

```java
// Android 端：UIImplementation.java
public void updateView(int tag, String className, ReadableMap props) {
  // 从注册表获取 Shadow Node
  ReactShadowNode cssNode = mShadowNodeRegistry.getNode(tag);

  if (props != null) {
    // 更新 Shadow Node 的样式属性
    cssNode.updateProperties(styles);

    // 处理更新逻辑 → 生成 UpdateViewOperation
    handleUpdateView(cssNode, className, styles);
  }
}

public void handleUpdateView() {
  // 创建更新操作，放入操作队列
  mUIViewOperationQueue.enqueueUpdateProperties(
    node.getReactTag(), className, props
  );
}
```

#### 完整图解：一次 createView + setChildren 的 Bridge 通信

```text
以这个组件为例：
  <View>
    <Text>Hello</Text>
  </View>

═══ Render 阶段（JS 线程）═══

  beginWork：向下遍历
    App → View → Text → RawText"Hello"

  completeWork：向上归并
    RawText"Hello"：
      → createTextInstance("Hello")
      → UIManager.createView(3, 'RCTRawText', rootTag, {text: "Hello"})
      → 📤 Bridge 发送: {"module":"UIManager","method":"createView","args":[3,"RCTRawText",...]}

    Text：
      → createInstance('RCTText')
      → UIManager.createView(5, 'RCTText', rootTag, {})
      → 📤 Bridge 发送: {"module":"UIManager","method":"createView","args":[5,"RCTText",...]}

    View：
      → createInstance('RCTView')
      → UIManager.createView(7, 'RCTView', rootTag, {})
      → 📤 Bridge 发送: {"module":"UIManager","method":"createView","args":[7,"RCTView",...]}

═══ Commit Mutation 阶段（JS 线程）═══

    setChildren：建立父子关系
      → UIManager.setChildren(5, [3])     // RawText 插入 Text
      → 📤 Bridge 发送: {"module":"UIManager","method":"setChildren","args":[5,[3]]}

      → UIManager.setChildren(7, [5])     // Text 插入 View
      → 📤 Bridge 发送: {"module":"UIManager","method":"setChildren","args":[7,[5]]}

      → UIManager.setChildren(rootTag, [7]) // View 插入根视图
      → 📤 Bridge 发送: {"module":"UIManager","method":"setChildren","args":[1,[7]]}

═══ Bridge 传输（异步）═══

    所有指令被序列化为 JSON，放入 MessageQueue
    等待 Native 线程消费

═══ Native 侧（Native 线程）═══

    ④ 从 MessageQueue 依次取出指令
    ⑤ createView(3, 'RCTRawText') → 创建 Shadow Node → 放入注册表
    ⑥ createView(5, 'RCTText')   → 创建 Shadow Node → 放入注册表
    ⑦ createView(7, 'RCTView')   → 创建 Shadow Node → 放入注册表
    ⑧ setChildren(5, [3])        → 建立 Shadow Tree 父子关系
    ⑨ setChildren(7, [5])        → 建立 Shadow Tree 父子关系
    ⑩ Yoga 计算布局（位置、大小）
    ⑪ 生成 UIViewOperation 队列
    ⑫ 在主线程依次执行 Operation → 创建真实 Native View

    最终 Native View 树：
      UIView (tag=7)
        └── UILabel (tag=5)
              └── "Hello" (tag=3)
```

#### 更新场景：setState 后的 Bridge 通信

```text
假设 Text 内容从 "Hello" 变成 "World"

═══ Render 阶段 ═══

  beginWork：重新执行组件函数，diff 发现 Text 内容变了
    → RawText Fiber 打上 Update flag

  completeWork：
    → 不需要 createView（节点已存在，复用）
    → 收集变化的 props: { text: "World" }

═══ Commit Mutation 阶段 ═══

  处理 Update flag：
    → UIManager.updateView(3, 'RCTRawText', { text: "World" })
    → 📤 Bridge 发送: {"module":"UIManager","method":"updateView","args":[3,"RCTRawText",{"text":"World"}]}

═══ Native 侧 ═══

  收到 updateView 指令：
    → 从注册表找到 tag=3 的 Shadow Node
    → 更新 Shadow Node 的 text 属性
    → 重新计算布局（如果文字长度变了，可能影响布局）
    → 生成 UpdateViewOperation
    → 主线程执行：UILabel.setText("World")

  屏幕上 "Hello" 变成 "World" ✅
```

### 7.4 老架构通信流程总结

```text
                    通信时机                    JS 侧调用                     Native 侧处理
 ─────────────────────────────────────────────────────────────────────────────────────────
 创建节点    completeWork 阶段        UIManager.createView()         创建 Shadow Node + 注册
 插入子节点  Commit Mutation 阶段     UIManager.setChildren()        建立 Shadow Tree 父子关系
 更新节点    Commit Mutation 阶段     UIManager.updateView()         更新 Shadow Node props
 删除节点    Commit Mutation 阶段     UIManager.manageChildren()     从 Shadow Tree 移除
 ─────────────────────────────────────────────────────────────────────────────────────────
 所有调用都经过 Bridge → JSON 序列化 → MessageQueue → JSON 反序列化 → Native 执行
```

### 7.5 Bridge 底层：JS 调用是如何一步步到达 Java/OC 的？

上面说了"通过 Bridge 通信"，但 Bridge 不是一个黑盒。JS 是怎么调用到 Java/OC 代码的？中间经过了哪些层？

#### 三层架构

```text
┌─────────────────────────────────────────────────────────────┐
│  JS 层                                                       │
│  MessageQueue 类：管理所有 JS ↔ Native 的双向通信             │
│  - _lazyCallableModules：存放 Native 可调用的 JS 模块         │
│  - _successCallbacks：存放异步回调函数                        │
│  - enqueueNativeCall()：JS → Native 的出口                   │
│  - callFunctionReturnFlushedQueue()：Native → JS 的入口      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│  C++ 层                                                      │
│  CatalystInstanceImpl：通信管理中枢                           │
│  - NativeToJsBridge：负责 Native → JS 方向                   │
│  - JsToNativeBridge：负责 JS → Native 方向                   │
│  - JSIExecutor：执行 JS 代码，桥接 JS 运行时                  │
│  - ModuleRegistry：Native 模块注册表                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│  Native 层（Java / OC）                                      │
│  CatalystInstanceImpl（Java）：Native 侧的通信管理类          │
│  - NativeModuleRegistry：所有 NativeModule 的注册表           │
│  - UIManagerModule：处理 UI 渲染指令                         │
│  - JavaMethodWrapper：通过反射调用具体的 Native 方法           │
└─────────────────────────────────────────────────────────────┘
```

#### 初始化：Bridge 是怎么建立的

应用启动时，Native 侧会初始化整个 Bridge 链路：

```java
// Android 端：CatalystInstanceImpl.java
private CatalystInstanceImpl() {
  mHybridData = initHybrid();

  // 创建线程配置（JS 线程 + NativeModule 线程）
  mReactQueueConfiguration = ReactQueueConfigurationImpl.create(
    reactQueueConfigurationSpec, new NativeExceptionHandler()
  );

  // 初始化桥！把 Native 模块信息传递给 C++ 层
  initializeBridge(
    new BridgeCallback(this),                    // 回调函数
    jsExecutor,                                  // JS 执行器
    mReactQueueConfiguration.getJSQueueThread(), // JS 线程
    mNativeModulesQueueThread,                   // NativeModule 线程
    mNativeModuleRegistry.getJavaModules(this),  // Java 模块列表
    mNativeModuleRegistry.getCxxModules()         // C++ 模块列表
  );
}
```

C++ 层接收到后，建立双向通信桥：

```cpp
// C++ 层：CatalystInstanceImpl.cpp
void CatalystInstanceImpl::initializeBridge(...) {
  // 创建 NativeModule 线程
  moduleMessageQueue_ =
    std::make_shared<JMessageQueueThread>(nativeModulesQueue);

  // 构建 Native 模块注册表（moduleID → NativeModule 的映射）
  moduleRegistry_ = std::make_shared<ModuleRegistry>(
    buildNativeModuleList(...)
  );

  // 初始化 Instance，建立 NativeToJsBridge 和 JsToNativeBridge
  instance_->initializeBridge(...);
}
```

同时，C++ 层会向 JS 运行时注入关键的全局对象和函数：

```cpp
// C++ 层：JSIExecutor.cpp
void JSIExecutor::initializeRuntime() {
  // ① 注入 nativeModuleProxy → JS 通过它访问 NativeModules
  runtime_->global().setProperty(
    *runtime_,
    "nativeModuleProxy",
    Object::createFromHostObject(
      *runtime_,
      std::make_shared<NativeModuleProxy>(nativeModules_)
    )
  );

  // ② 注入 nativeFlushQueueImmediate → JS 通过它把消息队列刷给 Native
  runtime_->global().setProperty(
    *runtime_,
    "nativeFlushQueueImmediate",
    Function::createFromHostFunction(
      *runtime_,
      PropNameID::forAscii(*runtime_, "nativeFlushQueueImmediate"),
      1,
      [this](jsi::Runtime &, const jsi::Value &,
             const jsi::Value *args, size_t count) {
        // 调用 callNativeModules，把队列中的指令分发给对应的 NativeModule
        callNativeModules(args[0], false);
        return Value::undefined();
      }
    )
  );
}
```

初始化完成后的全景：

```text
JS global 对象上被注入了：
  global.nativeModuleProxy          → 访问 NativeModules 的入口
  global.nativeFlushQueueImmediate  → 把消息队列刷给 C++ 的入口

JS 侧 MessageQueue 注册了：
  _lazyCallableModules['AppRegistry']     → Native 可以调用 JS 的 AppRegistry
  _lazyCallableModules['RCTEventEmitter'] → Native 可以把事件传给 JS

C++ 侧建立了：
  NativeToJsBridge  → Native → JS 方向的桥
  JsToNativeBridge  → JS → Native 方向的桥
  ModuleRegistry    → moduleID → NativeModule 的映射表
```

#### JS → Native 的完整调用链（以 UIManager.createView 为例）

```text
JS 侧调用：
  UIManager.createView(3, 'RCTView', rootTag, props)
```

第一步：JS 侧 — `genMethod` 包装函数触发 `enqueueNativeCall`

```ts
// JS 侧：MessageQueue.js
// 每个 NativeModule 的方法都被 genMethod 包装过
function genMethod(moduleID: number, methodID: number, type: MethodType) {
  let fn = function nonPromiseMethodWrapper(...args) {
    if (type === 'sync') {
      // 同步调用（阻塞，少用）
      return BatchedBridge.callNativeSyncHook(moduleID, methodID, newArgs, onFail, onSuccess)
    } else {
      // 异步调用（常规路径）
      BatchedBridge.enqueueNativeCall(moduleID, methodID, newArgs, onFail, onSuccess)
    }
  }
  fn.type = type
  return fn
}
```

```ts
// MessageQueue 的 enqueueNativeCall
class MessageQueue {
  enqueueNativeCall(moduleID, methodID, params, onFail, onSucc) {
    // 把回调函数存起来，等 Native 执行完后回调
    this.processCallbacks(moduleID, methodID, params, onFail, onSucc)

    // 调用 C++ 注入的 nativeFlushQueueImmediate，把队列刷过去
    global.nativeFlushQueueImmediate(queue)
  }
}
```

第二步：C++ 层 — `nativeFlushQueueImmediate` → `callNativeModules` → `ModuleRegistry`

```cpp
// C++ 层：JSIExecutor.cpp
// nativeFlushQueueImmediate 被调用后：
void callNativeModules() {
  // 遍历队列中的所有调用
  for (auto &call : methodCalls) {
    // 通过 moduleID 找到对应的 NativeModule，调用其 invoke 方法
    m_registry->callNativeMethod(
      call.moduleId,    // 比如 UIManager 的 moduleID
      call.methodId,    // 比如 createView 的 methodID
      std::move(call.arguments),
      call.callId
    );
  }
}

// ModuleRegistry 根据 moduleID 找到模块并调用
void ModuleRegistry::callNativeMethod(moduleId, methodId, params, callId) {
  // modules_ 是启动时注册的 NativeModule 数组
  // 通过 moduleId 找到对应的模块（如 UIManagerModule）
  modules_[moduleId]->invoke(methodId, std::move(params), callId);
}
```

第三步：Native 层 — `JavaMethodWrapper.invoke` → 反射调用 Java 方法

```java
// Android 端：JavaMethodWrapper.java
@Override
public void invoke(JSInstance jsInstance, ReadableArray parameters) {
  try {
    // 通过 Java 反射，调用 NativeModule 上的具体方法
    // 比如 UIManagerModule.createView(tag, className, rootViewTag, props)
    mMethod.invoke(mModuleWrapper.getModule(), mArguments);
  } catch (Exception e) {
    // 错误处理
  }
}
```

```java
// 最终到达：UIManagerModule.java
@ReactMethod
public void createView(int tag, String className, int rootViewTag,
                        ReadableMap props) {
  // 创建 Shadow Node，构建 Shadow Tree
  mUIImplementation.createView(tag, className, rootViewTag, props);
}
```

完整调用链图解：

```text
UIManager.createView(3, 'RCTView', rootTag, props)
  │
  ▼ JS 层
genMethod 包装函数
  │
  ▼
MessageQueue.enqueueNativeCall(moduleID, methodID, args)
  │ 把回调存入 _successCallbacks
  │
  ▼
global.nativeFlushQueueImmediate(queue)
  │
  ══════════════════ JS → C++ 边界 ══════════════════
  │
  ▼ C++ 层
JSIExecutor::callNativeModules()
  │ 遍历 methodCalls
  │
  ▼
ModuleRegistry::callNativeMethod(moduleId, methodId, params)
  │ 通过 moduleId 找到 UIManagerModule
  │
  ▼
modules_[moduleId]->invoke(methodId, params)
  │
  ══════════════════ C++ → Java 边界（JNI）══════════════════
  │
  ▼ Java 层
JavaMethodWrapper.invoke()
  │ Java 反射
  │
  ▼
UIManagerModule.createView(3, "RCTView", rootTag, props)
  │
  ▼
UIImplementation.createView()
  │ 创建 Shadow Node → 注册 → 计算布局 → 生成 Operation
  │
  ▼
UIViewOperationQueue.enqueueCreateView()
  │ 放入操作队列
  │
  ▼ 主线程执行
new android.view.View()  ← 真实的 Native View 被创建！
```

#### Native → JS 的完整调用链（以 runApplication 为例）

反方向也一样，Native 调用 JS 也要经过 C++ 中转：

```java
// Android 端：ReactRootView.java
// Native 启动 RN 应用
public void runApplication() {
  catalystInstance
    .getJSModule(AppRegistry.class)
    .runApplication(jsAppModuleName, appParams);
}
```

```java
// AppRegistry 是一个 JavaScriptModule 接口
// 通过动态代理，所有方法调用都转发到 invoke
public interface AppRegistry extends JavaScriptModule {
  void runApplication(String appKey, WritableMap appParameters);
}

// 动态代理的 invoke 方法
public @Nullable Object invoke() throws Throwable {
  // 调用 C++ 层的 callFunction
  mCatalystInstance.callFunction(getJSModuleName(), method.getName(), jsArgs);
  return null;
}
```

```cpp
// C++ 层：Instance.cpp → NativeToJsBridge.cpp → JSIExecutor.cpp
void Instance::callJSFunction(模块, 方法, 参数) {
  nativeToJsBridge_->callFunction(模块, 方法, 参数);
}

void NativeToJsBridge::callFunction(模块, 方法, 参数) {
  executor->callFunction(模块名称, 方法名称, 参数);
}

void JSIExecutor::callFunction(模块, 方法, 参数) {
  // 调用 JS 层 MessageQueue 的 callFunctionReturnFlushedQueue
  ret = callFunctionReturnFlushedQueue_->call(
    *runtime_, moduleId, methodId,
    valueFromDynamic(*runtime_, arguments)
  );
  // 顺便处理 JS 侧积攒的 Native 调用
  callNativeModules(ret, true);
}
```

```ts
// JS 层：MessageQueue.js
class MessageQueue {
  // C++ 调用这个方法
  callFunctionReturnFlushedQueue(模块名, 方法名, 参数) {
    this.__callFunction(模块名, 方法名, 参数)
  }

  __callFunction(模块名, 方法名, 参数) {
    // 从 _lazyCallableModules 找到对应的 JS 模块
    const moduleMethods = this.getCallableModule(模块名)  // → AppRegistry

    // 调用模块上的方法
    moduleMethods[方法名].apply(模块, 参数)  // → AppRegistry.runApplication(...)
  }
}
```

完整调用链图解：

```text
Native 要启动 RN 应用：runApplication("MyApp", params)
  │
  ▼ Java 层
catalystInstance.getJSModule(AppRegistry.class).runApplication(...)
  │ 动态代理
  │
  ▼
CatalystInstanceImpl.callFunction("AppRegistry", "runApplication", args)
  │
  ══════════════════ Java → C++ 边界（JNI）══════════════════
  │
  ▼ C++ 层
Instance::callJSFunction()
  │
  ▼
NativeToJsBridge::callFunction()
  │
  ▼
JSIExecutor::callFunction()
  │ 调用 JS 的 callFunctionReturnFlushedQueue
  │
  ══════════════════ C++ → JS 边界 ══════════════════
  │
  ▼ JS 层
MessageQueue.callFunctionReturnFlushedQueue("AppRegistry", "runApplication", args)
  │
  ▼
MessageQueue.__callFunction()
  │ 从 _lazyCallableModules 找到 AppRegistry
  │
  ▼
AppRegistry.runApplication("MyApp", params)
  │
  ▼
renderApplication(<App />, initialProps)  ← RN 应用开始渲染！
```

#### 异步回调：Native 执行完后怎么把结果传回 JS？

当 JS 调用 Native 方法并传了回调函数时（如 `NativeModule.method(callback)`），回调的返回路径：

```java
// Java 端：CallbackImpl.java
// Native 方法执行完毕，调用回调
@Override
public void invoke(Object... args) {
  // 把结果和 callbackId 传回 C++
  mJSInstance.invokeCallback(mCallbackId, Arguments.fromJavaArgs(args));
}
```

```cpp
// C++ 层
void CatalystInstanceImpl::jniCallJSCallback(jint callbackId, NativeArray *arguments) {
  instance_->callJSCallback(callbackId, arguments->consume());
}

void Instance::callJSCallback(uint64_t callbackId, folly::dynamic &&params) {
  nativeToJsBridge_->invokeCallback((double)callbackId, std::move(params));
}

void JSIExecutor::invokeCallback(callbackId, arguments) {
  // 调用 JS 层 MessageQueue 的 invokeCallbackAndReturnFlushedQueue
  ret = invokeCallbackAndReturnFlushedQueue_->call(
    *runtime_, callbackId, valueFromDynamic(*runtime_, arguments)
  );
}
```

```ts
// JS 层：MessageQueue.js
class MessageQueue {
  invokeCallbackAndReturnFlushedQueue(cbID, args) {
    this.__invokeCallback(cbID, args)
  }

  __invokeCallback(cbID, args) {
    // 通过 callbackId 找到之前存的回调函数
    const callback = this._successCallbacks.get(cbID)

    // 执行回调，把 Native 的结果传给 JS
    callback(...args)
  }
}
```

```text
完整的异步回调流程：

  JS: NativeModule.fetchData(callback)
    → enqueueNativeCall(moduleID, methodID, args)
    → 把 callback 存入 _successCallbacks[callbackId=42]
    → nativeFlushQueueImmediate → C++ → Java
    → Java 执行 fetchData，得到结果 {data: "hello"}
    → CallbackImpl.invoke({data: "hello"})
    → jniCallJSCallback(callbackId=42, {data: "hello"})
    → C++ → JSIExecutor.invokeCallback
    → JS MessageQueue.__invokeCallback(42, {data: "hello"})
    → _successCallbacks.get(42) → callback({data: "hello"})
    → 你的回调函数被执行 ✅
```

### 7.6 NativeModules：JS 调用原生能力

除了渲染指令，JS 还需要调用原生能力（相机、定位、存储等）。老架构通过 NativeModules 实现：

```ts
// JS 侧调用 Native 方法
import { NativeModules } from 'react-native'

// 同步获取模块引用（模块信息在启动时已注册）
const { NativeCommonModule } = NativeModules

// 调用 Native 方法（异步，通过 Bridge）
NativeCommonModule.methodXXX()

// 带回调的异步调用
NativeCommonModule.callNativeMethod('methodXXX', (result) => {
  console.log(result)
})
```

Native 模块的注册流程：

```text
Native 侧（以 Android 为例）：
  ① 创建 NativeModule 类，继承 ReactContextBaseJavaModule
  ② 在 Package 中注册该模块
  ③ 应用启动时，所有 NativeModule 被收集到 NativeModuleRegistry
     │
     ▼ 初始化 Bridge 时
     │
C++ 侧：
  ④ NativeModule 信息传递到 C++ 层
  ⑤ 构建 moduleRegistry_ 对象
  ⑥ 挂载到 JS global 对象上：global.nativeModuleProxy
     │
     ▼
JS 侧：
  ⑦ NativeModules.XXX 实际访问的是 global.nativeModuleProxy.XXX
  ⑧ 调用方法时，通过 Bridge 传递 moduleID + methodID 给 Native
```

```cpp
// C++ 侧将 NativeModules 挂载到 JS global 上
void JSIExecutor::initializeRuntime() {
  runtime_->global().setProperty(
    *runtime_,
    "nativeModuleProxy",
    Object::createFromHostObject(
      *runtime_,
      std::make_shared<NativeModuleProxy>(nativeModules_)
    )
  );
}

// JS 侧访问 NativeModules.ReactNativeCommonModule 时
// 实际触发 nativeModuleProxy 的 get 方法：
Value get(Runtime &rt, const PropNameID &name) override {
  auto nativeModules = weakNativeModules_.lock();
  return nativeModules->getModule(rt, name);  // 从注册表中查找模块
}
```

---

## 8. 新架构：JSI + Fabric + TurboModules

RN 0.68+ 引入了新架构，核心目标：**干掉 Bridge，让 JS 和 Native 直接通信**。

### 8.1 新架构三大组件

```text
老架构：
  JS ←──── Bridge（JSON 序列化，异步）────→ Native

新架构：
  JS ←──── JSI（C++ 直接调用，同步）────→ C++ ←───→ Native
                    │                        │
                    │                   ┌────┴────┐
                    │                   │         │
                 Fabric            TurboModules
              (新渲染系统)         (新原生模块系统)
```

```text
JSI（JavaScript Interface）：
  - JS 引擎的抽象层，让 JS 可以直接持有 C++ 对象的引用
  - 不需要 JSON 序列化！JS 直接调用 C++ 方法
  - 支持同步调用（不用等异步回调）

Fabric（新渲染系统）：
  - 替代老架构的 UIManager + Bridge 渲染流程
  - Shadow Tree 在 C++ 侧构建（而不是 Native 侧）
  - JS 通过 JSI 直接操作 Shadow Node

TurboModules（新原生模块系统）：
  - 替代老架构的 NativeModules
  - 懒加载：用到时才初始化（老架构启动时全加载）
  - 通过 JSI 直接调用，不经过 Bridge
```

### 8.2 JSI：JS 和 C++ 的直接对话

JSI 的核心能力：**JS 可以直接持有 C++ 对象的引用，调用 C++ 方法，不需要序列化。**

```text
老架构（Bridge）：
  JS 对象 → JSON.stringify → 字符串 → JSON.parse → Native 对象
  耗时：序列化 + 反序列化 + 异步等待

新架构（JSI）：
  JS 对象 → 直接引用 C++ HostObject → 调用 C++ 方法
  耗时：一次函数调用（微秒级）
```

具体实现：

```cpp
// C++ 侧：向 JS global 对象注入 nativeFabricUIManager
std::shared_ptr<UIManagerBinding> UIManagerBinding::getBinding(
    jsi::Runtime &runtime) {
  auto uiManagerModuleName = "nativeFabricUIManager";
  auto uiManagerValue =
      runtime.global().getProperty(runtime, uiManagerModuleName);
  auto uiManagerObject = uiManagerValue.asObject(runtime);
  return uiManagerObject.getHostObject<UIManagerBinding>(runtime);
}
```

```ts
// JS 侧：直接调用 C++ 方法（不经过 Bridge！）
var node = global.nativeFabricUIManager.createNode(
  tag,              // reactTag
  viewName,         // 'RCTView'
  rootTag,          // 根视图标识
  props,            // 属性
  instanceHandle    // Fiber 引用
)
// 这个调用是同步的！直接触发 C++ 的 createNode 方法
```

### 8.3 Fabric：新的渲染流程

Fabric 架构下，Shadow Tree 的构建从 Native 侧移到了 C++ 侧。

先澄清一个容易混淆的概念——"Native 侧构建"和"C++ 侧构建"说的不是一回事：

```text
"Native 侧构建 Shadow Tree"（老架构）：
  指的是 Java（Android）/ OC（iOS）层构建 Shadow Tree
  → Android：UIManagerModule.java 中的 createView 方法创建 ReactShadowNode
  → iOS：RCTUIManager.m 中的 createView 方法创建 RCTShadowView
  → 每个平台各自实现一套，Shadow Node 的类型和实现都不同
  → 问题：iOS 和 Android 各写一遍，逻辑重复，且通过 Bridge 异步接收指令

"C++ 侧构建 Shadow Tree"（新架构 Fabric）：
  指的是用 C++ 统一构建 Shadow Tree，iOS 和 Android 共用同一份代码
  → C++：UIManager::createNode() 创建 ShadowNode
  → Yoga 布局引擎也在 C++ 层，直接计算布局
  → JS 通过 JSI 同步调用 C++ 方法，不经过 Bridge
  → 优势：跨平台共用、无序列化、同步调用

简单说：
  老架构 → Java/OC 各自建各自的 Shadow Tree（通过 Bridge 异步接收指令）
  新架构 → C++ 统一建一份 Shadow Tree（JS 通过 JSI 同步调用）
```

对比流程：

```text
老架构渲染流程：
  JS (Fiber Tree)
    → Bridge（JSON 序列化，异步）
    → Java/OC 层各自构建 Shadow Tree（平台相关代码）
    → Java/OC 层各自计算布局
    → Java/OC 层创建真实视图

新架构（Fabric）渲染流程：
  JS (Fiber Tree)
    → JSI（直接调用，同步）
    → C++ 层统一构建 Shadow Tree（跨平台共用）
    → C++ 层计算布局（Yoga）
    → Java/OC 层创建真实视图（只负责最后一步：把布局结果变成真实 View）
```

Fabric 中 createNode 的实现：

```cpp
// C++ 侧：UIManagerBinding 的 get 方法
jsi::Value UIManagerBinding::get() {
  auto methodName = name.utf8(runtime);

  if (methodName == "createNode") {
    return jsi::Function::createFromHostFunction(
      runtime, name, 5,
      [uiManager](jsi::Runtime &runtime,
                  jsi::Value const &,
                  jsi::Value const *arguments,
                  size_t) noexcept -> jsi::Value {

        auto eventTarget = eventTargetFromValue(runtime, arguments[4], arguments[0]);

        // 直接在 C++ 侧创建 Shadow Node
        return valueFromShadowNode(
          runtime,
          uiManager->createNode(
            tagFromValue(arguments[0]),           // tag
            stringFromValue(runtime, arguments[1]), // viewName
            surfaceIdFromValue(runtime, arguments[2]), // rootTag
            RawProps(runtime, arguments[3]),       // props
            eventTarget                           // 事件目标
          )
        );
      }
    );
  }
}

// UIManager 的 createNode 方法
ShadowNode::Shared UIManager::createNode() {
  // 直接在 C++ 创建 Shadow Node
  auto shadowNode = componentDescriptor.createShadowNode();
  return shadowNode;
}
```

### 8.4 Fabric 中 Shadow Node 的不可变性

Fabric 架构中，Shadow Node 是不可变的（Immutable）。更新时不修改原节点，而是克隆：

```text
老架构更新：
  Shadow Node A (style: {color: 'red'})
    → 直接修改 → Shadow Node A (style: {color: 'blue'})
  问题：多线程同时读写同一个节点，需要加锁

新架构（Fabric）更新：
  Shadow Node A (style: {color: 'red'})    ← 旧的，不动
    → 克隆 → Shadow Node A' (style: {color: 'blue'})  ← 新的
    → 逐级向上克隆，生成新的 Shadow Tree
  优势：无锁，线程安全，可以被 iOS 和 Android 同时读取
```

```text
具体过程：

  旧 Shadow Tree:          新 Shadow Tree:
       Root                     Root'（克隆）
        │                        │
       View                    View'（克隆）
      ╱    ╲                  ╱    ╲
   Text    View            Text'   View（复用，没变）
    │        │              │
  "red"    "hello"       "blue"  ← 只有这里变了

  只克隆从变化节点到根节点的路径，其余节点复用。
  这和 React 的 Fiber 双缓冲思想异曲同工。
```

### 8.5 新老架构对比总结

```text
                        老架构                          新架构
 ──────────────────────────────────────────────────────────────────
 通信方式        Bridge（JSON 序列化，异步）      JSI（C++ 直接调用，同步）
 Shadow Tree    Java/OC 层各自构建              C++ 层统一构建（Fabric，跨平台共用）
 原生模块        NativeModules（启动时全加载）    TurboModules（懒加载）
 序列化开销      每次通信都要 JSON 序列化          无序列化，直接引用
 同步调用        不支持                           支持
 线程安全        需要加锁                         Shadow Node 不可变，无锁
 跨平台复用      Shadow Tree 各平台独立            C++ Shadow Tree 跨平台共用
 ──────────────────────────────────────────────────────────────────
```

---

## 9. 事件处理与更新流程

### 9.1 RN 中的事件注册

在 Web 中，事件通过 `addEventListener` 注册到 DOM 上。在 RN 中，事件处理函数注册在 JS 侧，但触发来自 Native 侧：

```tsx
// 你写的 RN 代码
function Demo() {
  const [number, setNumber] = useState(0)

  const handleClickAdd = () => {
    setNumber(number + 1)
  }

  return (
    <TouchableOpacity onPress={handleClickAdd}>
      <View>
        <Text>{number}</Text>
      </View>
    </TouchableOpacity>
  )
}
```

事件注册的底层实现（Fabric 架构）：

```ts
// RN 启动时，通过 nativeFabricUIManager 注册全局事件处理函数
var registerEventHandler = nativeFabricUIManager.registerEventHandler

if (registerEventHandler) {
  // 注册 dispatchEvent 作为所有 Native 事件的入口
  registerEventHandler(dispatchEvent)
}
```

这样 Native 侧感知到任何用户交互（触摸、滑动、键盘等），都会调用 `dispatchEvent`。

### 9.2 事件触发的完整流程

```text
用户点击屏幕

  ① Native 侧捕获触摸事件
     iOS: UIResponder 触摸链
     Android: MotionEvent 分发
     │
     ▼
  ② Native 找到被点击的 View 对应的 tag
     │
     ▼ 通过 Bridge/JSI 传递给 JS
     │
  ③ JS 侧 dispatchEvent 被调用
     │
     ▼
  ④ 根据 tag 找到对应的 Fiber 节点
     │
     ▼
  ⑤ 在 batchedUpdates 中执行事件处理函数
```

```ts
// dispatchEvent 的实现（简化）
function dispatchEvent(target, ...) {
  // 找到事件对应的 Fiber 节点
  var targetFiber = target

  // 批量更新：合并同一事件中的多次 setState
  batchedUpdates(function() {
    // 构建事件对象，找到对应的事件处理函数，执行
    runExtractedPluginEventsInBatch(
      topLevelType,
      targetInst,
      nativeEvent,
      nativeEventTarget
    )
  })
}
```

### 9.3 批量更新：和 React Web 完全一样

```ts
// 批量更新的原理（Web 和 RN 共用）
var executionContext = NoContext

function batchedUpdates(fn) {
  // 设置批量更新标记
  executionContext |= BatchedContext

  try {
    // 执行事件处理函数
    // 函数内的多次 setState 不会立即触发更新
    return fn()
  } finally {
    // 重置标记
    executionContext = prevExecutionContext
    // 统一触发一次更新
  }
}
```

```tsx
// 例子：两次 setState 只触发一次更新
const handleClick = () => {
  setNumber(1)    // 不会立即更新
  setName('Alien') // 不会立即更新
  // handleClick 执行完毕后，batchedUpdates 统一触发一次更新
}
```

### 9.4 setState 触发更新的完整流程

```text
用户点击 → handleClickAdd 执行 → setNumber(number + 1)

  ① setNumber 触发 dispatchAction（和 Web 一样）
     │
     ▼
  ② 创建 update 对象，加入 Fiber 的更新队列
     │
     ▼
  ③ scheduleUpdateOnFiber → ensureRootIsScheduled
     │
     ▼
  ④ 进入 Render 阶段（和 Web 一样）
     - beginWork：遍历 Fiber 树
     - 执行 Demo 函数组件，useState 返回新值
     - reconcileChildren：diff 子节点，打标记
     │
     ▼
  ⑤ 进入 Commit 阶段（RN 独有的部分）
     │
     ├─ 老架构：通过 Bridge 发送 updateView 指令
     │   UIManager.updateView(tag, 'RCTText', { text: '1' })
     │   → Native 收到指令 → 更新 TextView 的文字
     │
     └─ 新架构：通过 JSI 直接调用 C++ 方法
         nativeFabricUIManager.cloneNodeWithNewProps(shadowNode, { text: '1' })
         → C++ 克隆 Shadow Node → Native 更新视图
     │
     ▼
  ⑥ 屏幕上 0 变成 1 ✅
```

### 9.5 对比：Web 和 RN 的更新流程

```text
                    React Web                      React Native
 ─────────────────────────────────────────────────────────────
 事件来源      浏览器 DOM 事件               Native 触摸事件
 事件传递      直接在 JS 中                  Native → Bridge/JSI → JS
 setState      ✅ 相同                       ✅ 相同
 批量更新      ✅ 相同                       ✅ 相同
 Render 阶段   ✅ 相同                       ✅ 相同
 Commit 阶段   操作 DOM                      发指令给 Native
 视图更新      浏览器重绘                    Native 主线程重绘
 ─────────────────────────────────────────────────────────────
```

---

## 10. 总结：一张图串联全流程

```text
                        React Native 完整渲染流程
 ═══════════════════════════════════════════════════════════════

 ┌─────────────────────────────────────────────────────────────┐
 │                        你写的代码                            │
 │                                                             │
 │  import { View, Text } from 'react-native'                 │
 │  function App() {                                           │
 │    const [count, setCount] = useState(0)                    │
 │    return <View><Text>{count}</Text></View>                 │
 │  }                                                          │
 └──────────────────────────┬──────────────────────────────────┘
                            │ Babel 编译
                            ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    JS 线程（React 运行时）                    │
 │                                                             │
 │  ① createElement → React Element (VDOM)                     │
 │  ② Reconciler → Fiber Tree（和 Web 共用！）                  │
 │     - beginWork：深度遍历，执行组件函数                       │
 │     - Hooks 在这里运行（useState, useEffect）                │
 │     - reconcileChildren：diff 打标记                        │
 │  ③ Commit 阶段 → 发送渲染指令                               │
 └──────────────────────────┬──────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
         老架构 Bridge               新架构 JSI
         (JSON 序列化)              (C++ 直接调用)
         (异步)                     (同步)
              │                           │
              ▼                           ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    C++ 层                                    │
 │                                                             │
 │  ④ 构建 Shadow Tree（布局树）                                │
 │     - 老架构：Java/OC 层各自构建                               │
 │     - 新架构：C++ 层统一构建（Fabric），跨平台共用               │
 │  ⑤ Yoga 引擎计算 Flexbox 布局（位置、大小）                  │
 └──────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    Native 主线程                             │
 │                                                             │
 │  ⑥ 根据 Shadow Tree 创建/更新原生视图                       │
 │     iOS:     UIView / UILabel / UIImageView                 │
 │     Android: View / TextView / ImageView                    │
 │  ⑦ 原生渲染引擎绘制到屏幕                                   │
 └─────────────────────────────────────────────────────────────┘

 ═══════════════════════════════════════════════════════════════
```

核心要点：

```text
1. React 核心（createElement、Hooks、Fiber、Reconciler）→ Web 和 RN 完全共用
2. 渲染器不同 → Web 用 react-dom 操作 DOM，RN 发指令给 Native
3. 中间多了 Shadow Tree → 用于跨平台布局计算（Yoga/Flexbox）
4. 通信方式 → 老架构用 Bridge（JSON 序列化，异步），新架构用 JSI（C++ 直接调用，同步）
5. 新架构三件套 → JSI（通信）+ Fabric（渲染）+ TurboModules（原生模块）
```
