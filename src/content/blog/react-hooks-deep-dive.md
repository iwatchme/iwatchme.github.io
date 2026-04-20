---
title: React Hooks 深度解析
description: >-
  基于手写 Mini React，从源码层面拆解 Hooks 的运行机制。从 Class 组件的三大痛点切入，梳理 JSX 到页面的完整渲染流水线，深入
  Fiber 架构与时间分片，再逐行实现 useState 和 useEffect，串联一次点击触发的全流程，最后对比真实 React
  的差异，带你从会用走向懂原理。
pubDate: '2026-04-20'
tags:
  - react
  - hooks
draft: false
publish: true
slug: react-hooks-deep-dive
---
# React Hooks 深度解析：从"为什么出现"到"底层实现原理"

> 本文基于手写 Mini React 的实现，从源码层面彻底讲清楚 Hooks 的运行机制。
> 如果你一直觉得 Hooks "能用但说不清为什么"，这篇文章就是为你写的。

## 目录

1. [Hooks 出现之前：Class 组件的痛点](#1-hooks-出现之前class-组件的痛点)
2. [Hooks 到底解决了什么问题](#2-hooks-到底解决了什么问题)
3. [从 JSX 到页面：完整渲染流水线](#3-从-jsx-到页面完整渲染流水线)
4. [Hooks 运行的前提：Fiber 架构](#4-hooks-运行的前提fiber-架构)
5. [useState 源码级实现](#5-usestate-源码级实现)
6. [Hooks 的规则：不是约定，是实现决定的](#6-hooks-的规则不是约定是实现决定的)
7. [useEffect 源码级实现](#7-useeffect-源码级实现)
8. [完整流程串联：一次点击触发了什么](#8-完整流程串联一次点击触发了什么)
9. [Mini React vs 真实 React：Hook 实现的差异](#9-mini-react-vs-真实-reacthook-实现的差异)

---

## 1. Hooks 出现之前：Class 组件的痛点

在 Hooks（React 16.8，2019年）出现之前，React 只有一种方式管理状态——Class 组件：

```tsx
class Counter extends React.Component {
  constructor(props) {
    super(props)
    this.state = { count: 0 }       // 状态初始化
    this.handleClick = this.handleClick.bind(this) // 手动绑定 this 🤮
  }

  componentDidMount() {
    document.title = `点击了 ${this.state.count} 次`
  }

  componentDidUpdate() {
    document.title = `点击了 ${this.state.count} 次`  // 和上面重复了 🤮
  }

  componentWillUnmount() {
    // 清理逻辑在另一个生命周期里 🤮
  }

  handleClick() {
    this.setState({ count: this.state.count + 1 })
  }

  render() {
    return <button onClick={this.handleClick}>{this.state.count}</button>
  }
}
```

这段代码暴露了 Class 组件的三个核心痛点：

### 痛点一：逻辑按"生命周期"拆散，而不是按"关注点"聚合

"更新标题"这一个逻辑，被拆到了 `componentDidMount` 和 `componentDidUpdate` 两个方法里。如果还有定时器、事件监听、数据订阅，它们全部交叉散落在各个生命周期中，代码读起来像在拼图。

```js
componentDidMount() {
  // 逻辑A：订阅数据
  // 逻辑B：启动定时器
  // 逻辑C：绑定事件
}

componentWillUnmount() {
  // 逻辑A：取消订阅    ← 和上面的 A 对应，但隔了几十行
  // 逻辑B：清除定时器   ← 和上面的 B 对应
  // 逻辑C：解绑事件     ← 和上面的 C 对应
}
```

### 痛点二：状态逻辑无法复用

假设多个组件都需要"监听窗口大小"的逻辑，Class 组件时代的方案是：

- **Mixin**（已废弃）：命名冲突、来源不清
- **HOC（高阶组件）**：嵌套地狱，`withRouter(withTheme(withAuth(MyComponent)))`
- **Render Props**：回调地狱，JSX 嵌套层层叠叠

没有一种方案是干净的。

### 痛点三：this 绑定心智负担

`this.handleClick = this.handleClick.bind(this)` —— 每个方法都要手动绑定，忘了就是 `undefined`。这不是 React 的问题，是 JavaScript Class 的问题，但 React 用户要为此买单。

用代码来说明这个坑有多隐蔽：

```tsx
class Counter extends React.Component {
  constructor(props) {
    super(props)
    this.state = { count: 0 }
    // 如果忘了下面这行...
    // this.handleClick = this.handleClick.bind(this)
  }

  handleClick() {
    // ❌ 点击时 this 是 undefined，直接报错：
    // TypeError: Cannot read properties of undefined (reading 'setState')
    this.setState({ count: this.state.count + 1 })
  }

  render() {
    // onClick 传的是函数引用，不是方法调用
    // 当事件触发时，this 已经丢失了
    return <button onClick={this.handleClick}>{this.state.count}</button>
    //                      ^^^^^^^^^^^^^^^^
    //                      等价于: const fn = this.handleClick
    //                              button.addEventListener('click', fn)
    //                              fn() ← 调用时没有 this！
  }
}
```

为什么 `this` 会丢失？因为 JavaScript 的 `this` 取决于调用方式，不取决于定义位置：

```js
class Dog {
  name = '旺财'
  bark() { console.log(this.name + ' 汪汪！') }
}

const dog = new Dog()
dog.bark()           // ✅ '旺财 汪汪！' — 通过对象调用，this = dog

const fn = dog.bark  // 取出方法引用
fn()                 // ❌ TypeError — 直接调用，this = undefined（严格模式）
                     //    React 的事件处理就是这种情况
```

Class 组件时代的三种"补救"方案，每种都有代价：

```tsx
class MyComponent extends React.Component {
  constructor(props) {
    super(props)
    // 方案 1：构造函数里 bind（每个方法都要写一遍）
    this.handleClick = this.handleClick.bind(this)
    this.handleChange = this.handleChange.bind(this)
    this.handleSubmit = this.handleSubmit.bind(this)
    // 10 个方法就要写 10 行 bind... 🤮
  }

  // 方案 2：箭头函数类属性（每个实例都创建新函数，浪费内存）
  handleClick = () => {
    this.setState({ ... })  // 箭头函数捕获外层 this，不会丢失
  }
  // 但这不是原型方法，无法被子类 override，也无法在测试中 spy

  render() {
    return (
      <div>
        {/* 方案 3：内联箭头函数（每次渲染都创建新函数） */}
        <button onClick={() => this.handleClick()}>
          {/* 每次 render 都是新的函数引用，导致子组件不必要的重渲染 */}
        </button>
      </div>
    )
  }
}
```

而函数组件 + Hooks 根本不存在这个问题：

```tsx
function MyComponent() {
  const [count, setCount] = useState(0)

  // 普通函数，没有 this，不需要 bind
  function handleClick() {
    setCount(count + 1)  // 通过闭包访问 count，不依赖 this
  }

  // 或者直接内联，简洁明了
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

没有 `this`，没有 `bind`，没有"忘了绑定导致 undefined"的运行时错误。这就是函数组件的天然优势。

---

## 2. Hooks 到底解决了什么问题

同样的 Counter，用 Hooks 重写：

```tsx
function Counter() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    document.title = `点击了 ${count} 次`
    // 如果需要清理，直接在这里 return
    return () => { /* cleanup */ }
  }, [count])

  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

对比一下：

| 维度 | Class 组件 | Hooks |
|------|-----------|-------|
| 相关逻辑 | 拆散到多个生命周期 | 聚合在一个 useEffect 里 |
| 逻辑复用 | HOC / Render Props | 自定义 Hook（就是普通函数） |
| this 绑定 | 手动 bind | 不存在 this |
| 代码量 | ~30 行 | ~10 行 |

自定义 Hook 的复用有多简单？

```tsx
// 抽取为自定义 Hook —— 就是一个普通函数
function useWindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const handler = () => setSize({ width: innerWidth, height: innerHeight })
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return size
}

// 任何组件都能用，零嵌套
function MyComponent() {
  const { width, height } = useWindowSize()
  return <div>{width} x {height}</div>
}
```

没有 HOC 嵌套，没有 Render Props 回调，就是函数调函数。

但这引出了一个关键问题：**函数组件每次渲染都会重新执行，state 存在哪？为什么不会丢失？**

答案藏在 Fiber 架构里。但在深入 Fiber 和 Hooks 之前，我们先看看 React 的完整渲染流水线——从你写下 JSX 到页面上出现像素，中间到底经历了什么。

---

## 3. 从 JSX 到页面：完整渲染流水线

理解 Hooks 之前，必须先搞清楚 React 的整体渲染流程。Hooks 不是独立存在的，它嵌入在这条流水线的特定环节中。

### 3.1 全景图

```text
  你写的代码                编译器                    运行时
 ┌──────────┐    Babel/   ┌──────────────┐    执行    ┌──────────────┐
 │   JSX    │ ──────────→ │ createElement │ ────────→ │ React Element│
 │ 模板语法  │    TSC      │   函数调用     │    调用    │  (VDOM 树)   │
 └──────────┘             └──────────────┘           └──────┬───────┘
                                                            │
                                                            │ render()
                                                            ▼
                                                    ┌──────────────┐
                                                    │   wipRoot    │
                                                    │  (根 Fiber)   │
                                                    └──────┬───────┘
                                                            │
                                              requestIdleCallback
                                                            │
                                                            ▼
 ┌──────────┐   commit    ┌──────────────┐  reconcile ┌──────────────┐
 │ 真实 DOM  │ ◀────────── │  effectTag   │ ◀──────── │  Fiber 链表   │
 │  (页面)   │   阶段      │ 增删改标记    │   阶段     │ child/sibling│
 └──────────┘             └──────────────┘           └──────────────┘
```

下面逐步拆解，每一步都对应项目中的具体代码。

### 3.2 第一步：JSX → createElement 调用（编译时）

JSX 不是合法的 JavaScript，它需要编译器（Babel / TSC / esbuild）转换。

你写的：

```tsx
// src/index.tsx
function App() {
  return <Counter interval={1000} initialNum={10} />
}
```

编译器输出（Vite 使用 esbuild，由 `vite.config.ts` 中的 `jsxFactory` 配置）：

```ts
function App() {
  return MiniReact.createElement(Counter, { interval: 1000, initialNum: 10 })
}
```

更复杂的嵌套 JSX：

```tsx
<div id="app">
  <p>hello</p>
  <span>{count}</span>
</div>
```

编译为：

```ts
MiniReact.createElement("div", { id: "app" },
  MiniReact.createElement("p", null, "hello"),
  MiniReact.createElement("span", null, count)
)
```

每个 JSX 标签变成一次 `createElement` 调用，嵌套标签变成嵌套调用。

### 3.3 第二步：createElement → React Element / VDOM（运行时）

`createElement` 执行后返回一个普通 JS 对象——这就是虚拟 DOM（React Element）：

```ts
// 来自 src/mini-react/createElement.ts
export function createElement(
  type: string | FunctionComponent,
  props: Record<string, any> | null,
  ...children: any[]
): MiniReactElement {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) => {
        const isTextNode = typeof child === 'string' || typeof child === 'number'
        return isTextNode ? createTextNode(child) : child
      }),
    },
  }
}
```

以 `<div id="app"><p>hello</p></div>` 为例，执行后得到：

```ts
// React Element 树（VDOM）
{
  type: "div",
  props: {
    id: "app",
    children: [
      {
        type: "p",
        props: {
          children: [
            {
              type: "TEXT_ELEMENT",       // 文本节点的特殊标记
              props: {
                nodeValue: "hello",
                children: []
              }
            }
          ]
        }
      }
    ]
  }
}
```

注意：字符串 `"hello"` 被 `createTextNode` 包装成了 `TEXT_ELEMENT` 类型的对象，这样所有节点都有统一的 `{ type, props }` 结构，后续处理不需要特判。

函数组件的 `type` 不是字符串，而是函数引用：

```ts
createElement(Counter, { interval: 1000, initialNum: 10 })
// 返回:
{
  type: Counter,    // ← 函数引用，不是字符串
  props: {
    interval: 1000,
    initialNum: 10,
    children: []
  }
}
```

### 3.4 第三步：render() → 创建根 Fiber，启动调度

VDOM 树创建好后，调用 `render()` 把它交给 React 运行时：

```ts
// 来自 src/mini-react/scheduler.ts
export function render(element: MiniReactElement, container: HTMLElement): void {
  // 创建根 Fiber 节点
  wipRoot = {
    type: undefined,
    dom: container,        // 真实 DOM 容器（#root）
    props: {
      children: [element], // VDOM 树作为 children
    },
    child: null,
    sibling: null,
    return: null,
    alternate: currentRoot, // 首次渲染为 null
  }

  deletions = []
  nextUnitOfWork = wipRoot  // 🔥 设置第一个工作单元，触发 workLoop
}
```

`render` 做了两件事：
1. 把 VDOM 包装成根 Fiber（`wipRoot`）
2. 设置 `nextUnitOfWork`，调度器的 `workLoop` 检测到它不为空，就开始工作

### 3.5 第四步：workLoop → Fiber 链表构建 + Reconcile（时间分片）

这一步是整个 React 渲染的核心，也是最不好理解的部分。我们拆成三个问题来讲。

#### 问题一：为什么需要时间分片？

先看一个没有时间分片的世界：

```text
假设你的页面有 10000 个节点需要更新。

传统方式（递归，不可中断）：
  reconcile(root)
    → reconcile(child1)
      → reconcile(grandchild1)
        → reconcile(grandgrandchild1)
          → ...（10000 层递归，一口气跑完）

  ⏱️ 耗时 200ms
  🚨 这 200ms 内，用户点击按钮、输入文字、滚动页面 → 全部无响应！
  🚨 因为 JavaScript 是单线程的，递归占着主线程不放。
```

时间分片的解决方案：

```text
Fiber 方式（循环，可中断）：

  时间片 1（5ms）：处理 fiber1 → fiber2 → fiber3 → 时间到了，让出！
    → 浏览器处理用户点击 ✅
    → 浏览器渲染一帧动画 ✅

  时间片 2（5ms）：处理 fiber4 → fiber5 → fiber6 → 时间到了，让出！
    → 浏览器处理键盘输入 ✅

  时间片 3（5ms）：处理 fiber7 → ... → 全部处理完！
    → 进入 commit 阶段，一次性更新 DOM
```

关键在于：**把一个大任务拆成很多小任务，每个小任务之间让浏览器喘口气。**

#### 问题二：workLoop 怎么实现时间分片？

```ts
// 来自 src/mini-react/scheduler.ts
function workLoop(deadline: IdleDeadline): void {
  let shouldYield = false

  // 循环处理 Fiber 节点
  while (nextUnitOfWork && !shouldYield) {
    // 处理一个 Fiber，返回下一个要处理的 Fiber
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork)

    // 检查：浏览器还有空闲时间吗？
    shouldYield = deadline.timeRemaining() < 1
    // deadline.timeRemaining() 返回当前帧剩余的毫秒数
    // 小于 1ms → 该让出了，break 循环
  }

  // 所有 Fiber 都处理完了？→ 提交到 DOM
  if (!nextUnitOfWork && wipRoot) {
    commitRoot()
  }

  // 无论如何，注册下一次空闲回调
  // 这样即使这次没处理完，下次浏览器空闲时会继续
  requestIdleCallback(workLoop)
}
```

用生活中的例子来理解：

```text
你在洗一大堆碗（10000 个 Fiber 节点）。

没有时间分片：一口气洗完所有碗，期间门铃响了也不去开门。
有时间分片：洗 5 个碗 → 看看有没有人按门铃 → 没有 → 继续洗 5 个
            → 门铃响了！→ 放下碗去开门 → 回来继续洗

requestIdleCallback = "告诉我什么时候有空"
deadline.timeRemaining() = "你还有多少时间可以洗碗"
performUnitOfWork = "洗一个碗"
commitRoot = "把所有洗好的碗放回碗柜"（一次性完成，不能中断）
```

#### 问题三：performUnitOfWork 每次处理一个 Fiber，具体做什么？

每个 Fiber 节点的处理分两步：**处理自身** + **返回下一个节点**。

```ts
// 来自 src/mini-react/fiber.ts
export function performUnitOfWork(fiber: Fiber): Fiber | undefined {
  // ═══ 第一步：处理当前节点 ═══
  const isFunctionComponent = fiber.type instanceof Function
  if (isFunctionComponent) {
    updateFunctionComponent(fiber)  // 函数组件：执行函数
  } else {
    updateHostComponent(fiber)      // 原生标签：创建 DOM
  }

  // ═══ 第二步：返回下一个要处理的节点 ═══
  // 优先级：child → sibling → 向上回溯找 sibling
  if (fiber.child) {
    return fiber.child              // 有子节点 → 先处理子节点
  }

  let nextFiber: Fiber | null = fiber
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling      // 有兄弟 → 处理兄弟
    }
    nextFiber = nextFiber.return    // 没有兄弟 → 回到父节点继续找
  }

  return undefined                  // 回到根节点了 → 遍历结束
}
```

"返回下一个节点"的遍历顺序是深度优先，用一个具体例子来看：

```text
  假设 JSX 结构是：
  <div>
    <h1>标题</h1>
    <p>内容</p>
  </div>

  对应的 Fiber 链表：

        wipRoot
          │
          ▼ child
         div
          │
          ▼ child
         h1 ──sibling──→ p
          │                │
          ▼ child          ▼ child
       "标题"            "内容"

  performUnitOfWork 的处理顺序：

  ① wipRoot → 有 child → 返回 div
  ② div     → 有 child → 返回 h1
  ③ h1      → 有 child → 返回 "标题"
  ④ "标题"  → 无 child，无 sibling
              → return 到 h1 → h1 有 sibling → 返回 p
  ⑤ p       → 有 child → 返回 "内容"
  ⑥ "内容"  → 无 child，无 sibling
              → return 到 p → 无 sibling
              → return 到 div → 无 sibling
              → return 到 wipRoot → 返回 undefined → 遍历结束！
```

注意：这个遍历是通过 `child / sibling / return` 三个指针实现的，不是递归。所以可以在任意一步暂停（时间片用完），下次从 `nextUnitOfWork` 继续。如果是递归，调用栈在中间是没法暂停的。

#### 处理函数组件 vs 宿主组件

每个 Fiber 节点根据类型做不同的事：

```ts
// 函数组件（如 <Counter />）
function updateFunctionComponent(fiber: Fiber): void {
  // 1. 设置全局指针，让 Hooks 知道"当前在渲染谁"
  setWipFiber(fiber)
  setStateHookIndex(0)
  fiber.stateHooks = []
  fiber.effectHooks = []

  // 2. 执行函数！比如 Counter({ initialNum: 10, interval: 1000 })
  //    函数体内的 useState / useEffect 会在这一步被调用
  const children = [fiber.type(fiber.props)]

  // 3. 拿到返回的 JSX（VDOM），和旧 Fiber 对比
  reconcileChildren(fiber, children)
}
```

这行 `const children = [fiber.type(fiber.props)]` 信息密度很高，拆开来看：

```ts
// fiber.type 是什么？
// 对于函数组件，type 就是函数本身的引用。
// 比如 <Counter interval={1000} initialNum={10} />
// 对应的 Fiber 是：
//   { type: Counter, props: { interval: 1000, initialNum: 10, children: [] } }
//
// 所以 fiber.type 就是 Counter 这个函数

// fiber.type(fiber.props) 是什么？
// 就是调用这个函数，把 props 传进去：
//   Counter({ interval: 1000, initialNum: 10, children: [] })
//
// 函数组件的 return 语句里写的是 JSX，但在运行之前，
// 编译器（Vite/esbuild）已经把 JSX 转成了 createElement 调用。
// 所以函数实际执行的是 createElement(...)，返回值是一个 React Element（VDOM 对象）：
//   { type: "div", props: { children: [{ type: "p", props: { children: [...] } }] } }

// 为什么要包一层数组 [...]？
// 因为 reconcileChildren 期望接收一个数组（children 列表）。
// 函数组件只返回一个根元素，包成数组统一处理。
// 宿主组件的 children 天然就是数组（props.children），
// 函数组件这里手动包一层，让两种情况走同一套 reconcile 逻辑。
```

用 Counter 组件的实际执行来演示：

```ts
// 你写的代码：
function Counter({ initialNum, interval }) {
  const [count, setCount] = useState(initialNum)
  useEffect(() => { /* ... */ }, [])
  return <div><p>{count}</p></div>
}

// 当 updateFunctionComponent 执行到这一行时：
const children = [fiber.type(fiber.props)]

// 等价于：
const children = [Counter({ initialNum: 10, interval: 1000, children: [] })]

// Counter 函数体开始执行：
//   1. useState(10) → 从 fiber.stateHooks 读/写状态 → 返回 [10, setCount]
//   2. useEffect(...) → 收集到 fiber.effectHooks
//   3. return <div><p>{count}</p></div>
//      ↓ 编译后
//      return createElement("div", null, createElement("p", null, count))
//      ↓ 执行后
//      return { type: "div", props: { children: [{ type: "p", props: { children: [{ type: "TEXT_ELEMENT", props: { nodeValue: 10 } }] } }] } }

// 所以 children 最终是：
// [{ type: "div", props: { children: [...] } }]
//  ↑ 一个元素的数组，传给 reconcileChildren 处理
```

关键点：**函数组件的"渲染"就是调用函数**。React 没有什么特殊的渲染机制，就是 `fiber.type(fiber.props)` —— 调用你写的函数，拿到返回值。Hooks 之所以能工作，是因为在调用之前设置了 `wipFiber` 全局指针，函数体内的 `useState` / `useEffect` 通过这个指针访问 Fiber 上的数据。

```ts
// 宿主组件（如 <div>, <p>, <span>）
function updateHostComponent(fiber: Fiber): void {
  // 1. 创建真实 DOM 节点（但不挂载到页面！）
  if (!fiber.dom) {
    fiber.dom = createDom(fiber)
  }

  // 2. 对 children 进行 reconcile
  reconcileChildren(fiber, fiber.props.children)
}
```

函数组件和宿主组件的关键区别：

```text
函数组件（Counter, App）：
  - 没有真实 DOM（fiber.dom = null）
  - 需要执行函数才能知道它的 children 是什么
  - Hooks 在执行函数时被调用

宿主组件（div, p, span）：
  - 有真实 DOM（fiber.dom = <div> 等）
  - children 直接从 props.children 获取
  - 不涉及 Hooks
```

#### Reconcile：新旧对比，打标记

`reconcileChildren` 是 Diff 算法的核心。它同时遍历新的 VDOM 数组和旧的 Fiber 链表，逐个对比：

```ts
// 来自 src/mini-react/reconciler.ts
export function reconcileChildren(wipFiber: Fiber, elements: MiniReactElement[]): void {
  let index = 0
  let oldFiber = wipFiber.alternate?.child ?? null  // 旧 Fiber 的第一个子节点
  let prevSibling: Fiber | null = null

  while (index < elements.length || oldFiber != null) {
    const element = elements[index]
    let newFiber: Fiber | null = null

    const sameType = element?.type === oldFiber?.type

    // 情况 1：type 相同（如都是 "div"）→ 复用 DOM，标记 UPDATE
    if (sameType && oldFiber) {
      newFiber = {
        type: oldFiber.type,
        props: element.props,       // 用新的 props
        dom: oldFiber.dom,          // 复用旧的 DOM！不用重新创建
        child: null,
        sibling: null,
        return: wipFiber,
        alternate: oldFiber,        // 指向旧 Fiber，commit 时对比 props
        effectTag: 'UPDATE',
      }
    }

    // 情况 2：有新元素但 type 不同 → 标记 PLACEMENT（新增）
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,                  // 需要新建 DOM
        child: null,
        sibling: null,
        return: wipFiber,
        alternate: null,
        effectTag: 'PLACEMENT',
      }
    }

    // 情况 3：有旧 Fiber 但 type 不同 → 标记 DELETION（删除）
    if (oldFiber && !sameType) {
      oldFiber.effectTag = 'DELETION'
      getDeletions().push(oldFiber)
    }

    // 旧 Fiber 移动到下一个兄弟
    if (oldFiber) {
      oldFiber = oldFiber.sibling
    }

    // 构建新 Fiber 链表：第一个 → parent.child，后续 → prevSibling.sibling
    if (index === 0) {
      wipFiber.child = newFiber
    } else if (element && prevSibling) {
      prevSibling.sibling = newFiber
    }

    prevSibling = newFiber
    index++
  }
}
```

用一个具体例子来理解 Reconcile 的三种情况：

```text
假设第一次渲染的结果是：
  <div>
    <p>hello</p>
    <span>world</span>
  </div>

旧 Fiber 链表：div.child → p ──sibling──→ span

现在状态更新，新的 JSX 变成了：
  <div>
    <p>hello!</p>       ← p 还在，但文字变了
    <h1>new title</h1>  ← span 变成了 h1
  </div>

新 elements 数组：[p元素, h1元素]

Reconcile 过程：

  index=0: 新 p vs 旧 p
    → type 都是 "p" → sameType = true
    → 创建 UPDATE Fiber（复用旧 DOM，用新 props）
    → 旧 Fiber 移到 span

  index=1: 新 h1 vs 旧 span
    → type 不同（"h1" vs "span"）→ sameType = false
    → 新 h1 → 创建 PLACEMENT Fiber（需要新建 DOM）
    → 旧 span → 标记 DELETION（需要删除）

  结果：
    p → effectTag: UPDATE      （commit 时更新 props）
    h1 → effectTag: PLACEMENT  （commit 时 appendChild）
    span → effectTag: DELETION （commit 时 removeChild）
```

注意：**Reconcile 阶段只打标记，不操作 DOM**。真正的 DOM 操作在 Commit 阶段一次性完成。这样即使 Reconcile 被时间分片中断了，用户也不会看到"更新了一半"的页面。

### 3.6 第五步：Commit → 操作真实 DOM

Reconcile 阶段在内存中完成了所有对比，给每个 Fiber 打上了标记（`PLACEMENT` / `UPDATE` / `DELETION`）。现在进入 Commit 阶段——**一次性把所有变更应用到真实 DOM 上**。

#### 为什么 Commit 不能中断？

```text
假设页面上有一个列表：
  <ul>
    <li>苹果</li>    ← 需要更新为 "Apple"
    <li>香蕉</li>    ← 需要更新为 "Banana"
    <li>橘子</li>    ← 需要更新为 "Orange"
  </ul>

如果 Commit 可以中断：
  更新 "苹果" → "Apple" ✅
  → 时间片用完，让出！
  → 用户看到：Apple、香蕉、橘子  🤮（中英文混合，不一致的 UI）
  → 下次继续更新 "香蕉" → "Banana"
  → ...

所以 Commit 必须同步执行，不可中断。
这也是为什么 React 分两个阶段：
  Render（可中断）：慢慢对比，打标记，用户看不到
  Commit（不可中断）：快速执行 DOM 操作，一帧内完成
```

#### commitRoot：Commit 阶段的入口

```ts
// 来自 src/mini-react/commit.ts
export function commitRoot(): void {
  const wipRoot = getWipRoot()!
  const deletions = getDeletions()

  // ① 先处理删除（在新增/更新之前，避免 DOM 结构冲突）
  deletions.forEach(commitWork)

  // ② 递归处理子树（PLACEMENT 和 UPDATE）
  commitWork(wipRoot.child)

  // ③ 执行 useEffect 副作用
  commitEffectHooks()

  // ④ 双缓冲切换：wipRoot 变成 currentRoot
  setCurrentRoot(wipRoot)
  setWipRoot(null)
  setDeletions([])
}
```

执行顺序很重要：

```text
为什么先删除，再新增/更新？

假设旧 DOM：<div> <span>A</span> <span>B</span> </div>
新 Fiber：  <div> <p>C</p> </div>

如果先新增再删除：
  appendChild(<p>C</p>)  → <div> <span>A</span> <span>B</span> <p>C</p> </div>
  removeChild(<span>A</span>)
  removeChild(<span>B</span>)
  → 中间状态有 3 个子节点，可能触发 CSS 布局抖动

如果先删除再新增：
  removeChild(<span>A</span>)
  removeChild(<span>B</span>)
  appendChild(<p>C</p>)  → <div> <p>C</p> </div>
  → 更干净，避免不必要的中间状态
```

#### commitWork：递归处理每个 Fiber

这是 Commit 阶段最核心的函数，逐个 Fiber 执行 DOM 操作：

```ts
// 来自 src/mini-react/commit.ts
function commitWork(fiber: Fiber | null): void {
  if (!fiber) return

  // ═══════════════════════════════════════════════════════
  // 第一步：找到 domParent（要把 DOM 挂到哪个父节点上）
  // ═══════════════════════════════════════════════════════
  let domParentFiber = fiber.return
  while (domParentFiber && !domParentFiber.dom) {
    domParentFiber = domParentFiber.return
  }
  const domParent = domParentFiber!.dom!

  // ═══════════════════════════════════════════════════════
  // 第二步：根据 effectTag 执行对应的 DOM 操作
  // ═══════════════════════════════════════════════════════
  if (fiber.effectTag === 'PLACEMENT' && fiber.dom != null) {
    domParent.appendChild(fiber.dom)
  } else if (fiber.effectTag === 'UPDATE' && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate!.props, fiber.props)
  } else if (fiber.effectTag === 'DELETION') {
    commitDeletion(fiber, domParent)
  }

  // ═══════════════════════════════════════════════════════
  // 第三步：递归处理子节点和兄弟节点
  // ═══════════════════════════════════════════════════════
  commitWork(fiber.child)
  commitWork(fiber.sibling)
}
```

#### 难点一：为什么要"向上找 domParent"？

函数组件没有真实 DOM。当我们要把一个 `<div>` 挂载到页面上时，它的 Fiber 父节点可能是函数组件（没有 DOM），需要继续往上找：

```text
Fiber 树：
  wipRoot (dom: <div id="root">)
    │
    ▼ child
  App Fiber (dom: null ← 函数组件！)
    │
    ▼ child
  Counter Fiber (dom: null ← 函数组件！)
    │
    ▼ child
  div Fiber (dom: <div>, effectTag: PLACEMENT)

当 commitWork 处理 div Fiber 时：
  fiber.return = Counter Fiber → dom 为 null，跳过
  Counter.return = App Fiber → dom 为 null，跳过
  App.return = wipRoot → dom 为 <div id="root"> ✅

  domParent = <div id="root">
  domParent.appendChild(<div>)

  最终 DOM：<div id="root"> <div> ... </div> </div>
```

如果不做这个向上查找，直接用 `fiber.return.dom`，就会拿到 `null`，然后 `null.appendChild()` 直接报错。

#### 难点二：删除函数组件时，要向下找 DOM

删除和新增正好相反——函数组件没有 DOM，删除时需要向下找到第一个有 DOM 的子节点：

```ts
// 来自 src/mini-react/commit.ts
function commitDeletion(fiber: Fiber, domParent: HTMLElement | Text): void {
  if (fiber.dom) {
    // 有 DOM → 直接删除
    domParent.removeChild(fiber.dom)
  } else if (fiber.child) {
    // 没有 DOM（函数组件）→ 递归向下找
    commitDeletion(fiber.child, domParent)
  }
}
```

```text
假设要删除 <Wrapper> 组件：

Fiber 树：
  div (domParent)
    │
    ▼ child
  Wrapper Fiber (dom: null, effectTag: DELETION)
    │
    ▼ child
  InnerWrapper Fiber (dom: null ← 又一个函数组件)
    │
    ▼ child
  p Fiber (dom: <p>)  ← 这才是真正要从 DOM 中移除的节点

commitDeletion(Wrapper, div):
  Wrapper.dom 为 null → 递归 commitDeletion(InnerWrapper, div)
  InnerWrapper.dom 为 null → 递归 commitDeletion(p, div)
  p.dom 存在 → div.removeChild(<p>) ✅
```

#### 难点三：updateDom 如何最小化 DOM 操作？

当 effectTag 为 `UPDATE` 时，不是重新创建 DOM，而是对比新旧 props，只更新变化的部分：

```ts
// 来自 src/mini-react/dom.ts
export function updateDom(
  dom: HTMLElement | Text,
  prevProps: Props,
  nextProps: Props,
): void {
  // ① 移除旧的或已变化的事件监听器
  //    比如 onClick 从 handleA 变成了 handleB
  //    → 先 removeEventListener("click", handleA)
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2)  // "onClick" → "click"
      dom.removeEventListener(eventType, prevProps[name])
    })

  // ② 移除已删除的属性
  //    比如旧 props 有 className="red"，新 props 没有了
  //    → dom.className = ""
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach((name) => {
      ;(dom as any)[name] = ''
    })

  // ③ 设置新增或变化的属性
  //    比如 className 从 "red" 变成 "blue"
  //    → dom.className = "blue"
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      ;(dom as any)[name] = nextProps[name]
    })

  // ④ 添加新的事件监听器
  //    → addEventListener("click", handleB)
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2)
      dom.addEventListener(eventType, nextProps[name])
    })
}
```

用一个具体例子来看 updateDom 的四步操作：

```js
旧 props: { className: "red", onClick: handleA, title: "旧标题" }
新 props: { className: "blue", onClick: handleB }

① 移除旧事件：onClick 变了 → removeEventListener("click", handleA)
② 移除旧属性：title 在新 props 中不存在 → dom.title = ""
③ 设置新属性：className 变了 → dom.className = "blue"
④ 添加新事件：onClick 变了 → addEventListener("click", handleB)

最终效果：
  - class 从 red 变成 blue ✅
  - title 被移除 ✅
  - 点击事件从 handleA 换成 handleB ✅
  - 只操作了变化的部分，没有重建整个 DOM 节点 ✅
```

为什么事件要先移除再添加，而不是直接覆盖？因为 `addEventListener` 是累加的，不会自动替换旧的监听器。如果不先 `removeEventListener`，点击一次会同时触发 `handleA` 和 `handleB`。

#### 难点四：双缓冲切换

Commit 的最后一步是双缓冲切换：

```ts
setCurrentRoot(wipRoot)   // wipRoot 变成 currentRoot
setWipRoot(null)          // 清空 wipRoot
setDeletions([])          // 清空删除列表
```

```text
为什么叫"双缓冲"？这个概念来自图形学：

  显卡渲染画面时，不会直接画到屏幕上（否则用户会看到画了一半的画面）。
  而是先画到一个"后台缓冲区"，画完后一次性切换到"前台缓冲区"。

  React 的做法一样：
    wipRoot（后台缓冲区）：正在构建的新 Fiber 树
    currentRoot（前台缓冲区）：当前页面对应的 Fiber 树

  Commit 完成后：
    wipRoot 变成 currentRoot（后台 → 前台）
    下次更新时，新的 wipRoot 通过 alternate 指向 currentRoot
    → 可以对比新旧 Fiber，实现增量更新
```

#### 图解：一次 UPDATE 的完整 Commit 过程

```text
假设 count 从 10 变成 11，Reconcile 后的 Fiber 树：

  wipRoot
    │
    ▼ child
  Counter Fiber (函数组件, dom: null)
    │
    ▼ child
  div Fiber (dom: <div>, effectTag: UPDATE)
    │
    ▼ child
  p Fiber (dom: <p>, effectTag: UPDATE)
    │
    ▼ child
  text Fiber (dom: Text("10"), effectTag: UPDATE)
    新 props: { nodeValue: 11 }
    旧 props: { nodeValue: 10 }  ← 从 alternate 获取

commitRoot() 执行过程：

  ① deletions.forEach(commitWork)
     → deletions 为空，跳过

  ② commitWork(wipRoot.child) → commitWork(Counter Fiber)
     │
     ├─ Counter: 找 domParent
     │   Counter.return = wipRoot, wipRoot.dom = <div id="root"> ✅
     │   Counter.effectTag = undefined（函数组件没有 effectTag）
     │   → 什么都不做
     │
     ├─ commitWork(Counter.child) → commitWork(div Fiber)
     │   │
     │   ├─ div: domParent = <div id="root">（跳过 Counter，找到 wipRoot）
     │   │   effectTag = UPDATE
     │   │   → updateDom(<div>, oldProps, newProps)
     │   │   → 对比 props，这里 div 的 props 没变，实际无操作
     │   │
     │   ├─ commitWork(div.child) → commitWork(p Fiber)
     │   │   │
     │   │   ├─ p: domParent = <div>
     │   │   │   effectTag = UPDATE → updateDom(<p>, oldProps, newProps)
     │   │   │
     │   │   ├─ commitWork(p.child) → commitWork(text Fiber)
     │   │   │   │
     │   │   │   ├─ text: domParent = <p>
     │   │   │   │   effectTag = UPDATE
     │   │   │   │   → updateDom(Text("10"), {nodeValue:10}, {nodeValue:11})
     │   │   │   │   → dom.nodeValue = 11  🔥 页面上 10 变成 11！
     │   │   │   │
     │   │   │   └─ commitWork(text.child) → null, 返回
     │   │   │
     │   │   └─ commitWork(p.sibling) → null, 返回
     │   │
     │   └─ commitWork(div.sibling) → null, 返回
     │
     └─ commitWork(Counter.sibling) → null, 返回

  ③ commitEffectHooks()
     → deps=[] 没变，不执行 cleanup，不执行 callback

  ④ setCurrentRoot(wipRoot)  → 双缓冲切换
     setWipRoot(null)
     setDeletions([])

  完成！页面显示 11 ✅
```

### 3.7 图解：Counter 组件首次渲染的完整过程

```tsx
render(<App />, document.getElementById('root')!)
```

```text
Step 1: JSX 编译
  <App /> → createElement(App, null)
  → { type: App, props: { children: [] } }

Step 2: render() 创建根 Fiber
  wipRoot = {
    dom: <div id="root">,     ← 真实 DOM 容器
    props: { children: [{ type: App, ... }] },
    alternate: null,           ← 首次渲染
  }
  nextUnitOfWork = wipRoot

Step 3: workLoop 开始处理

  performUnitOfWork(wipRoot)
    → updateHostComponent: reconcile children
    → 创建 App Fiber { type: App, effectTag: PLACEMENT }
    → 返回 App Fiber

  performUnitOfWork(App Fiber)
    → updateFunctionComponent: 执行 App()
    → App() 返回 <Counter interval={1000} initialNum={10} />
    → 创建 Counter Fiber { type: Counter, effectTag: PLACEMENT }
    → 返回 Counter Fiber

  performUnitOfWork(Counter Fiber)
    → updateFunctionComponent: 执行 Counter(props)
    → useState(10) → state = 10, 存入 fiber.stateHooks[0]
    → useEffect(...) → 收集到 fiber.effectHooks[0]
    → Counter 返回 <div><p>{count}</p></div>
    → 创建 div Fiber { type: "div", effectTag: PLACEMENT }
    → 返回 div Fiber

  performUnitOfWork(div Fiber)
    → updateHostComponent: createDom → <div>
    → reconcile children → 创建 p Fiber
    → 返回 p Fiber

  performUnitOfWork(p Fiber)
    → updateHostComponent: createDom → <p>
    → reconcile children → 创建 text Fiber "10"
    → 返回 text Fiber

  performUnitOfWork(text Fiber)
    → updateHostComponent: createDom → Text("10")
    → 无 children
    → 无 sibling，return 到 p → 无 sibling，return 到 div
    → 无 sibling，return 到 Counter → 无 sibling，return 到 App
    → 无 sibling，return 到 wipRoot
    → 返回 undefined → workLoop 结束

Step 4: commitRoot()
  commitWork:
    App Fiber → 函数组件，无 DOM，跳过
    Counter Fiber → 函数组件，无 DOM，跳过
    div Fiber → PLACEMENT → root.appendChild(<div>)
    p Fiber → PLACEMENT → div.appendChild(<p>)
    text Fiber → PLACEMENT → p.appendChild(Text("10"))

  commitEffectHooks:
    Counter 的 useEffect → 首次渲染 → 执行 callback
    → setInterval 启动，每秒 setCount(c => c + 1)

  页面显示: <div id="root"><div><p>10</p></div></div> ✅
```

这就是从 JSX 到页面像素的完整旅程。理解了这条流水线，接下来看 Hooks 如何嵌入其中就清晰多了。

---

## 4. Hooks 运行的前提：Fiber 架构

要理解 Hooks，必须先理解 Fiber。因为 **Hook 的数据就存储在 Fiber 节点上**。

### 4.1 什么是 Fiber

每个 React 组件在运行时都对应一个 Fiber 节点。Fiber 是一个普通的 JavaScript 对象，长这样：

```ts
// 来自 src/mini-react/types.ts
interface Fiber {
  type?: string | FunctionComponent  // "div" 或 Counter 函数
  props: Props                       // JSX 属性
  dom: HTMLElement | Text | null     // 对应的真实 DOM（函数组件为 null）

  // ---- 链表指针（Fiber 架构的核心） ----
  child: Fiber | null                // 第一个子节点
  sibling: Fiber | null              // 下一个兄弟节点
  return: Fiber | null               // 父节点

  // ---- 双缓冲 ----
  alternate: Fiber | null            // 上一次渲染的对应 Fiber

  // ---- Reconcile 标记 ----
  effectTag?: 'PLACEMENT' | 'UPDATE' | 'DELETION'

  // ---- 🔑 Hook 数据就存在这里 ----
  stateHooks?: StateHook<any>[]      // useState 的数据
  effectHooks?: EffectHook[]         // useEffect 的数据
}
```

注意最后两个属性：`stateHooks` 和 `effectHooks`。**这就是 Hook 数据的存储位置。**

函数组件本身是无状态的（每次调用都是全新执行），但它对应的 Fiber 节点是持久的。Hooks 把状态"寄存"在 Fiber 上，函数组件每次执行时从 Fiber 上取回状态，这就是状态不丢失的秘密。

### 4.2 函数组件的 Fiber 处理流程

当调度器处理到一个函数组件的 Fiber 时，会执行以下步骤：

```ts
// 来自 src/mini-react/fiber.ts
function updateFunctionComponent(fiber: Fiber): void {
  // 1️⃣ 设置全局指针：告诉 Hooks "当前正在渲染哪个组件"
  setWipFiber(fiber)

  // 2️⃣ 重置 Hook 索引：从第 0 个 Hook 开始
  setStateHookIndex(0)

  // 3️⃣ 初始化 Hook 数组（本轮渲染的 Hook 会依次 push 进来）
  fiber.stateHooks = []
  fiber.effectHooks = []

  // 4️⃣ 执行函数组件！useState/useEffect 就是在这一步被调用的
  const children = [fiber.type(fiber.props)]
  //                 ^^^^^^^^^^^^^^^^^^^^^^^^
  //                 比如执行 Counter({ initialNum: 10, interval: 1000 })
  //                 函数体内的 useState(10) 会读写 fiber.stateHooks
  //                 函数体内的 useEffect(...) 会写入 fiber.effectHooks

  // 5️⃣ 对返回的子元素进行 Reconcile
  reconcileChildren(fiber, children)
}
```

这段代码揭示了一个关键事实：**Hooks 不是魔法，它们只是在函数组件执行期间，通过全局变量 `wipFiber` 访问当前 Fiber 节点上的数据。**

用一张图表示：

```text
  ┌─────────────────────────────────────────────────┐
  │              Fiber 节点（持久存在）                │
  │                                                   │
  │  stateHooks: [ {state: 10, queue: []} ]          │
  │  effectHooks: [ {callback: fn, deps: []} ]       │
  │  alternate ──→ 上一次渲染的 Fiber                 │
  │                                                   │
  └──────────────────────┬──────────────────────────┘
                         │
                         │ wipFiber 指向这里
                         │
  ┌──────────────────────▼──────────────────────────┐
  │         函数组件执行（每次渲染重新执行）            │
  │                                                   │
  │  function Counter(props) {                        │
  │    const [count, setCount] = useState(10)         │
  │    //     ↑ 从 fiber.stateHooks[0] 读取           │
  │                                                   │
  │    useEffect(() => { ... }, [])                   │
  │    //  ↑ 写入 fiber.effectHooks[0]                │
  │                                                   │
  │    return <div><p>{count}</p></div>               │
  │  }                                                │
  └──────────────────────────────────────────────────┘
```

---

## 5. useState 源码级实现

现在进入最核心的部分。我们逐行拆解 `useState` 的实现。

### 5.1 数据结构

```ts
// 来自 src/mini-react/types.ts
interface StateHook<T> {
  state: T                          // 当前状态值
  queue: Array<(prev: T) => T>      // 待执行的更新队列
}
```

每个 `useState` 调用对应一个 `StateHook` 对象。多次调用 `useState` 就会有多个对象，按顺序存储在 `fiber.stateHooks` 数组中。

### 5.2 完整实现（带逐行注释）

```ts
// 来自 src/mini-react/hooks.ts

// ---- 模块级全局变量 ----
let wipFiber: Fiber | null = null    // 当前正在渲染的函数组件 Fiber
let stateHookIndex: number = 0       // 当前是第几个 useState 调用

export function useState<T>(initialState: T): [T, (action: T | ((prev: T) => T)) => void] {

  // 🔑 关键步骤 1：捕获当前 Fiber 的引用
  // 这个闭包引用会被 setState 使用，即使在未来的事件回调中调用
  const currentFiber = wipFiber!

  // 🔑 关键步骤 2：从旧 Fiber 取出上一次的 Hook
  // alternate 是上一次渲染的 Fiber，stateHooks[index] 是对应位置的 Hook
  // 首次渲染时 alternate 为 null，oldHook 为 undefined
  const oldHook = wipFiber!.alternate?.stateHooks?.[stateHookIndex] as StateHook<T> | undefined

  // 🔑 关键步骤 3：创建本轮的 Hook 对象
  const stateHook: StateHook<T> = {
    state: oldHook ? oldHook.state : initialState,  // 有旧值用旧值，没有用初始值
    queue: oldHook ? oldHook.queue : [],             // 继承待处理的更新队列
  }

  // 🔑 关键步骤 4：执行所有 pending 的更新
  // 比如用户连续调用了 3 次 setState(prev => prev + 1)
  // queue 里就有 3 个函数，依次执行得到最终 state
  stateHook.queue.forEach((action) => {
    stateHook.state = action(stateHook.state)
  })
  stateHook.queue = []  // 执行完清空

  // 🔑 关键步骤 5：递增索引，存入 Fiber
  stateHookIndex++
  wipFiber!.stateHooks!.push(stateHook)

  // 🔑 关键步骤 6：定义 setState 函数
  function setState(action: T | ((prev: T) => T)): void {
    // 统一转为函数形式：setState(5) → () => 5
    const isFunction = typeof action === 'function'
    stateHook.queue.push(isFunction ? (action as (prev: T) => T) : () => action)

    // 🔥 触发重新渲染！
    // 以当前组件的 Fiber 为起点，创建新的 work-in-progress 树
    setWipRoot({
      ...currentFiber,
      alternate: currentFiber,  // 旧 Fiber 变成 alternate
    } as Fiber)
    setNextUnitOfWork(getWipRoot()!)  // 调度器开始工作
  }

  return [stateHook.state, setState]
}
```

### 5.3 图解：useState 的两次渲染

以 `const [count, setCount] = useState(10)` 为例：

```text
═══════════════════════════════════════════════════════════════
  第一次渲染（Mount）
═══════════════════════════════════════════════════════════════

  Fiber {
    alternate: null          ← 没有旧 Fiber
    stateHooks: []           ← 空数组，等待填充
  }

  执行 useState(10):
    oldHook = undefined      ← alternate 为 null，取不到
    stateHook = { state: 10, queue: [] }   ← 使用 initialState
    fiber.stateHooks = [ { state: 10, queue: [] } ]
                               ↑ push 进去

  返回: [10, setState]

═══════════════════════════════════════════════════════════════
  用户点击按钮，调用 setCount(prev => prev + 1)
═══════════════════════════════════════════════════════════════

  setState 被调用:
    stateHook.queue.push(prev => prev + 1)
    → queue = [ prev => prev + 1 ]

    创建新的 wipRoot，触发重新渲染 ⚡

═══════════════════════════════════════════════════════════════
  第二次渲染（Update）
═══════════════════════════════════════════════════════════════

  新 Fiber {
    alternate: 旧Fiber       ← 指向第一次渲染的 Fiber
    stateHooks: []           ← 空数组，等待填充
  }

  执行 useState(10):
    oldHook = { state: 10, queue: [prev => prev + 1] }
                ↑ 从 alternate.stateHooks[0] 取出

    stateHook = { state: 10, queue: [prev => prev + 1] }
                         ↑ 继承旧 state    ↑ 继承 queue

    执行 queue:
      state = (prev => prev + 1)(10) = 11

    stateHook = { state: 11, queue: [] }   ← queue 清空

  返回: [11, setState]
```

### 5.4 为什么 setState 不会立即更新

注意 `setState` 的实现：它只是把 action 推入 queue，然后设置 `wipRoot` 触发新一轮渲染。**state 的计算发生在下一次渲染时**，不是 `setState` 调用时。

```ts
const [count, setCount] = useState(0)

function handleClick() {
  setCount(count + 1)  // 推入 queue: [() => 1]
  setCount(count + 1)  // 推入 queue: [() => 1, () => 1]
  console.log(count)   // 还是 0！因为还没重新渲染

  // 下次渲染时：
  // queue 依次执行：state = 1, state = 1
  // 最终 count = 1（不是 2！）
}

// 正确写法：用函数形式
function handleClickCorrect() {
  setCount(prev => prev + 1)  // queue: [prev => prev + 1]
  setCount(prev => prev + 1)  // queue: [prev => prev + 1, prev => prev + 1]

  // 下次渲染时：
  // state = (prev => prev + 1)(0) = 1
  // state = (prev => prev + 1)(1) = 2
  // 最终 count = 2 ✅
}
```

这就是为什么 React 文档推荐 `setState(prev => prev + 1)` 而不是 `setState(count + 1)`。

---

## 6. Hooks 的规则：不是约定，是实现决定的

React 官方有两条 Hook 规则：

1. 只在函数组件的顶层调用 Hook
2. 不要在循环、条件、嵌套函数中调用 Hook

很多人以为这是"最佳实践"或"代码风格"。不是的，**这是实现机制决定的硬性约束**。

### 6.1 Hook 靠数组索引匹配

回顾 `useState` 的实现：

```ts
// 取旧 Hook 的方式：通过索引
const oldHook = wipFiber!.alternate?.stateHooks?.[stateHookIndex]

// 每次调用 useState，索引 +1
stateHookIndex++
wipFiber!.stateHooks!.push(stateHook)
```

多个 `useState` 的匹配完全依赖调用顺序：

```ts
function MyComponent() {
  const [name, setName] = useState('张三')    // index 0
  const [age, setAge] = useState(25)          // index 1
  const [email, setEmail] = useState('')      // index 2
  // ...
}
```

```text
第一次渲染:
  stateHooks = [
    { state: '张三', queue: [] },   ← index 0: name
    { state: 25, queue: [] },       ← index 1: age
    { state: '', queue: [] },       ← index 2: email
  ]

第二次渲染:
  stateHookIndex = 0 → 取 alternate.stateHooks[0] → '张三' ✅
  stateHookIndex = 1 → 取 alternate.stateHooks[1] → 25     ✅
  stateHookIndex = 2 → 取 alternate.stateHooks[2] → ''     ✅
```

### 6.2 条件调用会导致索引错位

```ts
function MyComponent({ showName }) {
  // ❌ 条件调用 Hook
  if (showName) {
    const [name, setName] = useState('张三')  // 有时 index 0，有时不存在
  }
  const [age, setAge] = useState(25)          // 有时 index 1，有时 index 0
  // ...
}
```

```js
第一次渲染（showName = true）:
  stateHooks = [
    { state: '张三' },   ← index 0: name
    { state: 25 },       ← index 1: age
  ]

第二次渲染（showName = false）:
  useState('张三') 被跳过了！

  useState(25) 执行:
    stateHookIndex = 0
    oldHook = alternate.stateHooks[0] → { state: '张三' }
    //                                    ^^^^^^^^^^^^^^^^
    //                                    age 拿到了 name 的值！💥

  age 变成了 '张三'，整个状态全乱了。
```

这不是 bug，是数据结构决定的。数组 + 索引匹配，顺序必须稳定。

> 真实 React 用的是链表（`fiber.memoizedState`）而不是数组，但原理一样——都是按顺序遍历，没有 key 来标识"这是哪个 Hook"。

---

## 7. useEffect 源码级实现

`useEffect` 的实现分为两个阶段：**收集**（Render 阶段）和 **执行**（Commit 阶段）。

### 7.1 数据结构

```ts
// 来自 src/mini-react/types.ts
interface EffectHook {
  callback: () => void | (() => void)  // effect 函数，可返回 cleanup
  deps: any[] | undefined              // 依赖数组
  cleanup?: () => void                 // 上一次 effect 返回的清理函数
}
```

### 7.2 收集阶段（Render 时）

```ts
// 来自 src/mini-react/hooks.ts

export function useEffect(callback: () => void | (() => void), deps?: any[]): void {
  const effectHook: EffectHook = {
    callback,
    deps,
    cleanup: undefined,
  }
  // 仅仅是收集，推入当前 Fiber 的 effectHooks 数组
  // 不执行任何副作用！
  wipFiber!.effectHooks!.push(effectHook)
}
```

就这么简单。`useEffect` 在 Render 阶段什么都不做，只是把 effect 信息存到 Fiber 上。

### 7.3 执行阶段（Commit 时）

真正的复杂度在 Commit 阶段。来自 `src/mini-react/commit.ts`：

```ts
function commitEffectHooks(): void {
  const wipRoot = getCurrentRoot()!

  // ═══════════════════════════════════════════
  // 第一步：清理旧 Effect（先 cleanup，再执行新的）
  // ═══════════════════════════════════════════
  function runCleanup(fiber: Fiber | null): void {
    if (!fiber) return

    // 遍历旧 Fiber（alternate）的 effectHooks
    fiber.alternate?.effectHooks?.forEach((hook, index) => {
      const newDeps = fiber.effectHooks?.[index]?.deps

      // 如果旧 effect 没有 deps，或者 deps 变化了 → 执行 cleanup
      if (!hook.deps || (newDeps && !isDepsEqual(hook.deps, newDeps))) {
        hook.cleanup?.()  // 调用上一次 effect 返回的清理函数
      }
    })

    runCleanup(fiber.child)    // 递归子节点
    runCleanup(fiber.sibling)  // 递归兄弟节点
  }

  // ═══════════════════════════════════════════
  // 第二步：执行新 Effect
  // ═══════════════════════════════════════════
  function run(fiber: Fiber | null): void {
    if (!fiber) return

    fiber.effectHooks?.forEach((newHook, index) => {

      // 情况 1：首次渲染（没有 alternate）→ 直接执行
      if (!fiber.alternate) {
        newHook.cleanup = newHook.callback() as (() => void) | undefined
        return
      }

      // 情况 2：没有 deps → 每次渲染都执行
      if (!newHook.deps) {
        newHook.cleanup = newHook.callback() as (() => void) | undefined
        return
      }

      // 情况 3：deps 有值 → 对比是否变化
      if (newHook.deps.length > 0) {
        const oldHook = fiber.alternate?.effectHooks?.[index]
        if (oldHook && !isDepsEqual(oldHook.deps!, newHook.deps)) {
          newHook.cleanup = newHook.callback() as (() => void) | undefined
        }
      }

      // 情况 4：deps 为空数组 [] 且不是首次 → 不执行
      // （什么都不做，自然就跳过了）
    })

    run(fiber.child)
    run(fiber.sibling)
  }

  // 先清理，再执行
  runCleanup(wipRoot)
  run(wipRoot)
}
```

### 7.4 图解：useEffect 的生命周期

```js
useEffect(() => {
  const timer = setInterval(() => {
    setCount(c => c + 1)
  }, 1000)
  return () => clearInterval(timer)  // cleanup 函数
}, [])
```

```text
═══════════════════════════════════════════════════════════════
  第一次渲染（Mount）
═══════════════════════════════════════════════════════════════

  Render 阶段:
    useEffect 被调用 → 收集到 fiber.effectHooks[0]:
    {
      callback: () => { setInterval(...); return () => clearInterval(...) },
      deps: [],
      cleanup: undefined
    }

  Commit 阶段:
    runCleanup: fiber.alternate 为 null → 跳过
    run: fiber.alternate 为 null（首次渲染）→ 执行 callback
      → 启动定时器
      → cleanup = () => clearInterval(timer)

═══════════════════════════════════════════════════════════════
  第二次渲染（Update，由 setCount 触发）
═══════════════════════════════════════════════════════════════

  Render 阶段:
    useEffect 被调用 → 收集到新 fiber.effectHooks[0]:
    {
      callback: () => { setInterval(...); return ... },
      deps: [],          ← 还是空数组
      cleanup: undefined
    }

  Commit 阶段:
    runCleanup:
      旧 deps = [], 新 deps = []
      isDepsEqual([], []) → true → 不执行 cleanup ✅

    run:
      deps.length === 0 且不是首次 → 不执行 callback ✅
      定时器继续运行，没有被重复创建

═══════════════════════════════════════════════════════════════
  组件卸载（Deletion）
═══════════════════════════════════════════════════════════════

  runCleanup 会执行 cleanup:
    → clearInterval(timer)
    → 定时器被清除 ✅
```

### 7.5 deps 的四种情况总结

```ts
// 1. 不传 deps → 每次渲染都执行
useEffect(() => { console.log('每次都执行') })

// 2. 空数组 → 只在 Mount 时执行一次
useEffect(() => { console.log('只执行一次') }, [])

// 3. 有依赖 → 依赖变化时执行
useEffect(() => { console.log(`count 变了: ${count}`) }, [count])

// 4. cleanup → 在下次 effect 执行前 或 卸载时调用
useEffect(() => {
  const handler = () => { ... }
  window.addEventListener('resize', handler)
  return () => window.removeEventListener('resize', handler)  // cleanup
}, [])
```

底层判断逻辑：

```text
                    ┌─ 首次渲染？──→ 是 ──→ 执行 callback
                    │
  commitEffectHooks ├─ deps 为 undefined？──→ 是 ──→ 执行 callback
                    │
                    ├─ deps.length > 0？──→ 对比新旧 deps
                    │                        ├─ 不同 → 执行 callback
                    │                        └─ 相同 → 跳过
                    │
                    └─ deps 为 []？──→ 跳过（只在首次执行过了）
```

---

## 8. 完整流程串联：一次点击触发了什么

以我们的 Counter 组件为例，定时器每秒触发 `setCount(count => count + 1)`，完整流程如下：

```tsx
function Counter({ initialNum, interval }) {
  const [count, setCount] = useState(initialNum)

  useEffect(() => {
    const timer = setInterval(() => {
      setCount(count => count + 1)  // ← 定时器每秒触发这里
    }, interval)
    return () => clearInterval(timer)
  }, [])

  return <div><p>{count}</p></div>
}
```

```text
═══════════════════════════════════════════════════════════════
  Step 1: setCount 被调用
═══════════════════════════════════════════════════════════════

  setCount(count => count + 1)
    │
    ├─ stateHook.queue.push(count => count + 1)
    │
    └─ 创建新的 wipRoot = { ...currentFiber, alternate: currentFiber }
       设置 nextUnitOfWork = wipRoot
       → 调度器在下一个空闲时间片开始工作

═══════════════════════════════════════════════════════════════
  Step 2: Scheduler 调度（时间分片）
═══════════════════════════════════════════════════════════════

  requestIdleCallback(workLoop)
    │
    └─ workLoop(deadline):
         while (nextUnitOfWork && deadline.timeRemaining() > 1ms):
           nextUnitOfWork = performUnitOfWork(nextUnitOfWork)
                            │
                            ├─ 处理 Counter Fiber（函数组件）
                            │   ├─ setWipFiber(fiber)
                            │   ├─ setStateHookIndex(0)
                            │   ├─ 执行 Counter(props)
                            │   │   ├─ useState(10)
                            │   │   │   ├─ oldHook = { state: 10, queue: [c => c+1] }
                            │   │   │   ├─ 执行 queue: state = 11
                            │   │   │   └─ 返回 [11, setState]
                            │   │   ├─ useEffect(..., [])
                            │   │   │   └─ 收集到 effectHooks
                            │   │   └─ 返回 <div><p>11</p></div>
                            │   └─ reconcileChildren(fiber, children)
                            │
                            ├─ 处理 div Fiber（宿主组件）
                            │   ├─ fiber.dom 已存在 → 跳过创建
                            │   └─ reconcileChildren
                            │       └─ 对比旧 <p> 和新 <p>
                            │           → type 相同 → effectTag = UPDATE
                            │
                            └─ 处理 p Fiber → 处理文本节点 "11"
                                → 对比旧 "10" → type 相同 → UPDATE

═══════════════════════════════════════════════════════════════
  Step 3: Commit 阶段（同步，不可中断）
═══════════════════════════════════════════════════════════════

  commitRoot()
    │
    ├─ deletions.forEach(commitWork)     // 处理删除（本次没有）
    │
    ├─ commitWork(wipRoot.child)         // 递归处理 DOM
    │   ├─ Counter: 函数组件，无 DOM，跳过 DOM 操作
    │   ├─ div: effectTag = UPDATE → updateDom(div, oldProps, newProps)
    │   ├─ p: effectTag = UPDATE → updateDom(p, oldProps, newProps)
    │   └─ "11": effectTag = UPDATE → dom.nodeValue = "11"
    │                                    ↑ 页面上的数字从 10 变成 11！
    │
    ├─ commitEffectHooks()
    │   ├─ runCleanup: deps=[] 没变 → 不清理
    │   └─ run: deps=[] 且非首次 → 不执行
    │
    └─ currentRoot = wipRoot             // 双缓冲切换
       wipRoot = null                    // 本轮渲染结束
```

整个过程：`setState` → 标记更新 → 调度器空闲时处理 → Reconcile 对比新旧 → Commit 更新 DOM。

---

## 9. Mini React vs 真实 React：Hook 实现的差异

| 维度 | Mini React | 真实 React |
|------|-----------|-----------|
| Hook 存储 | `fiber.stateHooks` 数组 | `fiber.memoizedState` 链表 |
| Hook 匹配 | 数组索引 `stateHooks[index]` | 链表顺序遍历 `hook = hook.next` |
| mount/update | 同一个函数处理 | 分为 `mountState` 和 `updateState` 两套 |
| 调度 | `requestIdleCallback` | 自实现 Scheduler（MessageChannel，默认 5ms 时间片） |
| effect 执行 | commit 时同步执行 | `useEffect` 异步调度，`useLayoutEffect` 同步执行 |
| 批量更新 | 每次 setState 触发一轮渲染 | 自动批处理（React 18+） |

真实 React 中 Hook 的链表结构：

```text
fiber.memoizedState
  → { memoizedState: 10, queue: {...}, next: ─→ }
                                                │
    { memoizedState: {deps: [], ...}, next: ─→ }
                                                │
    { memoizedState: ..., next: null }

每个节点对应一个 Hook 调用（useState / useEffect / useRef / ...）
```

Mini React 用数组简化了这个结构，但核心思想完全一致：**按顺序存储，按顺序读取**。

### 9.1 Commit 阶段：Mini React 合并了真实 React 的三个子阶段

真实 React 的 `commitRoot` 内部其实拆成了三个子阶段：

```ts
// 真实 React 的 commitRootImpl
function commitRootImpl() {
  // ① BeforeMutation：更新前
  //    → 类组件：调用 getSnapshotBeforeUpdate
  //    → 函数组件：调度 useEffect 的异步执行
  commitBeforeMutationEffects(root, transitions)

  // ② Mutation：执行实际的 DOM 操作
  //    → appendChild / removeChild / 更新 DOM 属性
  commitMutationEffectsOnFiber(transitions, root)

  // 双缓冲切换：workInProgress 树变成 current 树
  root.current = transitions

  // ③ Layout：更新后
  //    → 类组件：调用 componentDidMount / componentDidUpdate
  //    → 函数组件：同步执行 useLayoutEffect 的 callback
  commitLayoutEffects(transitions, root, lanes)
}
```

而 Mini React 把这些全部合并成了一步：

```ts
// Mini React 的 commitRoot
function commitRoot() {
  deletions.forEach(commitWork)  // 删除
  commitWork(wipRoot.child)      // 新增 + 更新（PLACEMENT / UPDATE）
  commitEffectHooks()            // useEffect
  currentRoot = wipRoot          // 双缓冲切换
}
```

并排对比：

```js
Mini React（简化版）：          真实 React（完整版）：

commitRoot() {                  commitRootImpl() {
  // 全部混在一起                  // ① BeforeMutation（更新前）
  deletions.forEach(commitWork)    //    getSnapshotBeforeUpdate
  commitWork(wipRoot.child)        //    调度 useEffect
  commitEffectHooks()              //
  currentRoot = wipRoot            // ② Mutation（执行 DOM 操作）
}                                  //    appendChild / removeChild / 更新属性
                                   //    ← 对应 Mini React 的 commitWork
                                   //
                                   //    root.current = finishedWork（双缓冲切换）
                                   //
                                   // ③ Layout（更新后）
                                   //    componentDidMount / componentDidUpdate
                                   //    useLayoutEffect callback
                                   //    ← 对应 Mini React 的 commitEffectHooks
                                   //
                                   //    异步执行 useEffect（下一个微任务）
                                   // }
```

为什么真实 React 要拆成三个阶段？因为不同的 API 对执行时序有严格要求：

| 需求 | Mini React | 真实 React |
|------|-----------|------------|
| `getSnapshotBeforeUpdate` 需要在 DOM 变更前读取旧 DOM | 不支持 | BeforeMutation 阶段处理 |
| `useLayoutEffect` 需要在 DOM 变更后、浏览器绘制前同步执行 | 和 useEffect 混在一起 | Layout 阶段同步执行 |
| `useEffect` 需要异步执行，不阻塞绘制 | 同步执行 | BeforeMutation 调度，commit 后异步执行 |
| `componentDidMount` 需要能读到新 DOM | 不支持类组件 | Layout 阶段，此时 DOM 已更新 |
| 双缓冲切换的时机 | commitWork 之后 | Mutation 和 Layout 之间 |

Mini React 能正常工作是因为它只支持函数组件 + useState + useEffect，不需要这么精细的时序控制。真实 React 要处理类组件生命周期、useLayoutEffect、Suspense 等复杂场景，所以必须拆开。

---

## 总结

回到最初的问题：Hooks 为什么出现？

1. **Class 组件的逻辑复用太痛苦**（HOC 嵌套、Render Props 回调），Hooks 让逻辑复用变成了"函数调函数"
2. **生命周期按时间拆分逻辑**（mount/update/unmount），Hooks 按关注点聚合逻辑（一个 useEffect 管一件事）
3. **this 绑定是不必要的心智负担**，函数组件天然没有 this

而 Hooks 能工作的底层原因：

1. **Fiber 节点是持久的**，函数组件每次执行是全新的，但 Fiber 不会丢失
2. **Hook 数据存储在 Fiber 上**（`stateHooks` / `effectHooks`），通过 `alternate` 在新旧 Fiber 间传递
3. **全局指针 `wipFiber`** 让 Hook 函数知道"我属于哪个组件"
4. **数组索引匹配**让 Hook 知道"我是这个组件的第几个 Hook"——这也是为什么 Hook 不能条件调用

理解了这些，你就理解了 React 最核心的运行机制。

---

> 本文的所有代码来自项目 `src/mini-react/` 目录，可以直接 `npm run dev` 运行查看效果。
