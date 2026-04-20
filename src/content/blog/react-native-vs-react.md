---
title: React Native 对比指南
description: >-
  会写 React 不代表会写 React Native。本文系统梳理两者的差异：从共享 Reconciler
  但渲染靶子不同的心智模型，到标签组件、StyleSheet 样式、Flexbox
  布局、事件、Hooks、导航路由、存储网络、平台差异化、FlatList、图片字体、动画手势、表单键盘、调试打包，最后附 20 条高频踩坑清单。
pubDate: '2026-04-20'
tags:
  - react-native
  - react
draft: false
publish: true
slug: react-native-vs-react
---
# React vs React Native：完整对比指南

> 你会写 React，不代表你会写 React Native。
> 虽然共用同一套 Reconciler 和 Hooks 运行时，但 RN 没有 DOM、没有 CSS、没有浏览器 API。
> 这份文档把所有"在 React 里能写，在 RN 里不能写"的坑一次性列清楚。

## 目录

1. [核心心智模型差异](#1-核心心智模型差异)
2. [标签与组件对照表](#2-标签与组件对照表)
3. [样式系统：没有 CSS，只有 StyleSheet](#3-样式系统没有-css只有-stylesheet)
4. [布局：Flexbox 是唯一选择](#4-布局flexbox-是唯一选择)
5. [事件系统：onClick 不存在](#5-事件系统onclick-不存在)
6. [Hooks：哪些能用，哪些独有](#6-hooks哪些能用哪些独有)
7. [路由：没有 URL，用 Navigation](#7-路由没有-url用-navigation)
8. [存储、网络、平台 API](#8-存储网络平台-api)
9. [平台差异化代码](#9-平台差异化代码)
10. [列表渲染：别再用 map](#10-列表渲染别再用-map)
11. [图片、字体、资源处理](#11-图片字体资源处理)
12. [动画与手势](#12-动画与手势)
13. [表单与键盘](#13-表单与键盘)
14. [调试、打包、热更新](#14-调试打包热更新)
15. [常见踩坑清单](#15-常见踩坑清单)

---

## 1. 核心心智模型差异

先记住一句话：**React Native 和 React 共用 Reconciler，但渲染目标完全不同。**

```text
React (Web)                          React Native
 ┌──────────────┐                     ┌──────────────┐
 │ React Core   │                     │ React Core   │   ← 同一个 react 包
 │ (Fiber/Hooks)│                     │ (Fiber/Hooks)│
 └──────┬───────┘                     └──────┬───────┘
        │                                    │
        ▼                                    ▼
 ┌──────────────┐                     ┌──────────────┐
 │ react-dom    │                     │ react-native │   ← Renderer 不同
 └──────┬───────┘                     └──────┬───────┘
        │                                    │
        ▼                                    ▼
    DOM / CSS                        Native View / Yoga
    (浏览器)                         (iOS UIView / Android View)
```

由此带来的根本差异：

| 维度 | React (Web) | React Native |
|------|-------------|--------------|
| 宿主环境 | 浏览器（有 DOM、window、document） | JS 引擎（Hermes/JSC），没有 DOM |
| 渲染产物 | HTML 元素 | 原生 UIView / Android View |
| 样式 | CSS / CSS-in-JS | JS 对象 + StyleSheet |
| 布局 | Flow / Flex / Grid / Float | 仅 Flexbox（Yoga 引擎） |
| 单位 | px / em / rem / % / vh | 无单位数字（dp / pt） |
| 路由 | URL + History API | 栈/Tab 导航（React Navigation） |
| 打包 | webpack / vite / esbuild | Metro |
| 调试 | Chrome DevTools | Flipper / React DevTools / Hermes |

---

## 2. 标签与组件对照表

**RN 里没有任何 HTML 标签。** 所有 UI 都必须用 RN 提供的组件。

### 2.1 基础组件映射

| React (Web) | React Native | 说明 |
|-------------|--------------|------|
| `<div>` | `<View>` | 最基础的容器，相当于 block 元素 |
| `<span>` / `<p>` / `<h1>` 等 | `<Text>` | **所有文字必须包在 `<Text>` 里**，否则直接崩溃 |
| `<img>` | `<Image>` | 本地图用 `require()`，远程图用 `{ uri }` |
| `<button>` | `<Pressable>` / `<TouchableOpacity>` / `<Button>` | `Button` 很弱，通常用 `Pressable` |
| `<input type="text">` | `<TextInput>` | 受控组件用法类似 |
| `<input type="checkbox">` | `<Switch>` | 风格是开关，不是勾选框 |
| `<ul>` / `<ol>` + map | `<FlatList>` / `<SectionList>` | 虚拟化列表，map 会有性能问题 |
| `<a href>` | `Linking.openURL()` | 没有超链接组件 |
| `<iframe>` | `<WebView>`（需装 `react-native-webview`） | 第三方库 |
| `<form>` | 无对应组件 | RN 没有表单概念，手动管理 state |
| `<select>` | `@react-native-picker/picker` | 第三方库 |
| `<textarea>` | `<TextInput multiline>` | 加 prop 即可 |
| `<canvas>` | `react-native-skia` / `react-native-svg` | 第三方库 |
| `<video>` | `react-native-video` | 第三方库 |

### 2.2 RN 独有的内置组件

```tsx
import {
  View, Text, Image, ScrollView,
  FlatList, SectionList, VirtualizedList,
  TextInput, Switch, Pressable,
  TouchableOpacity, TouchableHighlight, TouchableWithoutFeedback,
  Modal, ActivityIndicator, RefreshControl,
  SafeAreaView, KeyboardAvoidingView,
  StatusBar, Platform, StyleSheet,
  Animated, Dimensions, PixelRatio,
} from 'react-native';
```

几个必须知道的：

- **`SafeAreaView`**：自动避开刘海屏 / 底部 Home Indicator。顶层页面容器通常用它。
- **`KeyboardAvoidingView`**：键盘弹出时自动上推内容，避免遮挡输入框。
- **`ScrollView`**：能滚动但**不做虚拟化**，数据多了必卡，长列表必须用 `FlatList`。
- **`Modal`**：原生弹层，不是 CSS 定位模拟的。
- **`ActivityIndicator`**：菊花转圈加载动画。

### 2.3 最常见的低级错误

```tsx
// ❌ 直接写字符串会崩：Text strings must be rendered within a <Text> component
<View>Hello</View>

// ✅ 必须包 Text
<View><Text>Hello</Text></View>

// ❌ Text 里嵌套 View 在某些版本上行为异常
<Text>Hello <View /></Text>

// ✅ Text 里只嵌套 Text
<Text>Hello <Text style={{ color: 'red' }}>World</Text></Text>
```

---

## 3. 样式系统：没有 CSS，只有 StyleSheet

### 3.1 写法差异

```tsx
// React (Web)：CSS / className / style
<div className="card" style={{ color: 'red' }}>...</div>

// React Native：只有 style，值是 JS 对象
<View style={{ backgroundColor: 'red', padding: 16 }}>...</View>

// 推荐用 StyleSheet.create（可以做静态检查 + 引用优化）
const styles = StyleSheet.create({
  card: { backgroundColor: 'white', padding: 16, borderRadius: 8 },
});
<View style={styles.card} />

// 数组合并，后面覆盖前面
<View style={[styles.card, isActive && styles.active, { marginTop: 10 }]} />
```

### 3.2 CSS 里能写但 RN 里不能写的

| CSS 特性 | RN 是否支持 | 替代方案 |
|---------|------------|---------|
| 选择器 (`.foo:hover`) | ❌ 不支持 | `Pressable` 的 `style={({ pressed }) => ...}` |
| 伪类 (`::before`) | ❌ | 手动加一个 `View` |
| `display: grid` | ❌ | 只能 Flex 嵌套 |
| `display: block/inline` | ❌ | 默认就是 flex，无 block 概念 |
| `float` | ❌ | Flex 布局 |
| 继承（如字体继承） | ⚠️ 部分 | **Text 的样式不会被子 View 继承**，字体要在每个 Text 上设 |
| `em` / `rem` / `%` | ❌（宽高支持 %） | 用绝对数字 / `Dimensions` |
| `vh` / `vw` | ❌ | `Dimensions.get('window')` |
| `calc()` | ❌ | JS 算 |
| `box-shadow` | ⚠️ iOS 用 `shadow*`，Android 用 `elevation` | 两套分别写 |
| `transform` | ✅ 但写法不同 | `transform: [{ translateX: 10 }]` |
| `transition` | ❌ | `Animated` / `Reanimated` / `LayoutAnimation` |
| `@media` | ❌ | JS 判断 `Dimensions` / `useWindowDimensions` |
| 伪元素 `content` | ❌ | 手动组件 |
| `cursor` | ⚠️ Web-only | 移动端无意义 |

### 3.3 命名差异

RN 样式采用 **camelCase**，没有单位（默认就是 dp/pt，相对密度独立像素）：

```tsx
// CSS                              // RN
// background-color: red;           backgroundColor: 'red'
// font-size: 16px;                 fontSize: 16
// margin-top: 8px;                 marginTop: 8
// border-radius: 4px;              borderRadius: 4
// text-align: center;              textAlign: 'center'
```

### 3.4 阴影（经典跨平台坑）

```tsx
const shadow = {
  // iOS
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.2,
  shadowRadius: 4,
  // Android
  elevation: 4,
};
```

---

## 4. 布局：Flexbox 是唯一选择

**RN 里所有元素默认 `display: flex`，并且 `flexDirection: 'column'`**（和 Web 的默认 `row` 相反）。

```tsx
// Web 默认：block 元素纵向排列
// RN 默认：flex + column，所以也是纵向

// 想横向排列：
<View style={{ flexDirection: 'row' }}>
  <View /><View /><View />
</View>
```

常见不同：

| 属性 | Web 默认 | RN 默认 |
|------|---------|---------|
| `display` | `block`/`inline` | `flex` |
| `flexDirection` | `row` | `column` |
| `alignContent` | `stretch` | `flex-start` |
| `flexShrink` | `1` | `0` |
| `box-sizing` | `content-box` | 相当于 `border-box` |

布局独有属性：

- `aspectRatio`: 2 —— 保持宽高比
- `gap` / `rowGap` / `columnGap` —— 新版本支持，老版本要靠 margin

---

## 5. 事件系统：onClick 不存在

```tsx
// ❌ Web 写法
<button onClick={handleClick}>

// ✅ RN 写法
<Pressable onPress={handlePress}>
  <Text>按钮</Text>
</Pressable>
```

事件名对照：

| Web | RN |
|-----|-----|
| `onClick` | `onPress` |
| `onMouseDown` | `onPressIn` |
| `onMouseUp` | `onPressOut` |
| `onDoubleClick` | 手动实现 / `onPress` 计时 |
| `onMouseEnter/Leave` | `onHoverIn/Out`（仅 Web/桌面） |
| `onChange` (input) | `onChangeText`（只给字符串，不是 event 对象） |
| `onSubmit` (form) | `onSubmitEditing`（TextInput 上） |
| `onScroll` | `onScroll`（但 event.nativeEvent 结构不同） |
| `onKeyDown` | `onKeyPress`（仅部分场景，移动端基本无） |

触摸手势相关：

- `Pressable`：现代推荐，支持长按、状态回调
- `TouchableOpacity`：点下去半透明
- `TouchableHighlight`：点下去变色
- `TouchableWithoutFeedback`：无视觉反馈
- 复杂手势用 `react-native-gesture-handler`

---

## 6. Hooks:哪些能用，哪些独有

**React 的所有内置 Hook 在 RN 里 100% 可用**，因为共享同一个 react 包。

### 6.1 React 内置 Hook（RN 全部支持）

```tsx
import {
  useState, useEffect, useLayoutEffect,
  useRef, useMemo, useCallback,
  useContext, useReducer,
  useImperativeHandle, useDebugValue,
  useId, useTransition, useDeferredValue,
  useSyncExternalStore, useInsertionEffect,
} from 'react';
```

⚠️ **注意**：
- `useLayoutEffect` 在 RN 里会有警告"useLayoutEffect does nothing on the server"——移动端无此问题，Web 端 SSR 才有。
- `useInsertionEffect` 是为 CSS-in-JS 设计的，RN 里几乎用不到。

### 6.2 React Native 独有的 Hook

```tsx
import {
  useWindowDimensions,   // 响应式屏幕尺寸（替代 Dimensions.get）
  useColorScheme,        // 获取系统深色/浅色模式
  useAnimatedValue,      // (新)
} from 'react-native';

// 示例
const { width, height } = useWindowDimensions();  // 屏幕旋转自动更新
const scheme = useColorScheme();  // 'light' | 'dark' | null
```

### 6.3 生态库常用 Hook

| 库 | Hook | 用途 |
|----|------|------|
| `@react-navigation/native` | `useNavigation` | 拿到导航对象 |
| | `useRoute` | 拿当前路由参数 |
| | `useFocusEffect` | 页面聚焦/失焦副作用 |
| | `useIsFocused` | 当前页面是否聚焦 |
| `react-native-safe-area-context` | `useSafeAreaInsets` | 获取安全区 padding |
| `react-native-reanimated` | `useSharedValue` | 动画共享值 |
| | `useAnimatedStyle` | 派生动画样式 |
| | `useDerivedValue` | 派生值 |
| | `useAnimatedScrollHandler` | 滚动动画驱动 |
| `react-native-gesture-handler` | `useAnimatedGestureHandler` | 手势 |
| `@react-native-async-storage/async-storage` | 无 Hook | 需自己封装 |

### 6.4 Web 专用 Hook 在 RN 不能用

```tsx
// ❌ 这些都依赖 DOM / 浏览器 API
import { useId } from 'react';  // ✅ 可用，不依赖 DOM
// 但下面这类在 RN 没意义：
document.title = '...'          // ❌ 无 document
window.addEventListener(...)    // ❌ 无 window.addEventListener（有部分 polyfill）
localStorage.getItem(...)       // ❌ 用 AsyncStorage
```

---

## 7. 路由：没有 URL，用 Navigation

Web 路由依赖 URL，RN 没有这个概念，标准方案是 **React Navigation**。

```bash
npm i @react-navigation/native @react-navigation/native-stack
npm i react-native-screens react-native-safe-area-context
```

```tsx
// Web (react-router)
<BrowserRouter>
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/detail/:id" element={<Detail />} />
  </Routes>
</BrowserRouter>

// RN (React Navigation)
const Stack = createNativeStackNavigator();

<NavigationContainer>
  <Stack.Navigator>
    <Stack.Screen name="Home" component={Home} />
    <Stack.Screen name="Detail" component={Detail} />
  </Stack.Navigator>
</NavigationContainer>

// 跳转
navigation.navigate('Detail', { id: 1 });     // 相当于 push
navigation.goBack();                          // 相当于 history.back()
navigation.replace('Login');                  // 相当于 history.replace

// 取参数
const { id } = route.params;
```

常见导航器类型：
- `Stack`：页面压栈（最常用）
- `Tab`：底部 Tab
- `Drawer`：侧滑抽屉
- `MaterialTopTab`：顶部 Tab

---

## 8. 存储、网络、平台 API

### 8.1 存储

| Web | RN |
|-----|-----|
| `localStorage` / `sessionStorage` | `@react-native-async-storage/async-storage`（异步、只存字符串） |
| `IndexedDB` | `react-native-mmkv` / `expo-sqlite` / `watermelondb` |
| `Cookies` | `@react-native-cookies/cookies` |

```tsx
// AsyncStorage 是 Promise API
await AsyncStorage.setItem('token', 'abc');
const token = await AsyncStorage.getItem('token');  // 可能为 null
```

### 8.2 网络

- `fetch`：✅ 可用（RN 内置 polyfill）
- `XMLHttpRequest`：✅ 可用
- `WebSocket`：✅ 可用
- `axios`：✅ 可用
- `EventSource`（SSE）：❌ 默认不支持，需装 `react-native-sse`
- 下载文件：用 `react-native-blob-util` / `expo-file-system`
- HTTP/2 / HTTPS 证书：iOS ATS 默认只允许 HTTPS，开发可临时放开

### 8.3 其他浏览器 API

| Web API | RN 替代 |
|---------|---------|
| `window.location` | 无（用 Navigation） |
| `document` | 无 |
| `navigator.geolocation` | `@react-native-community/geolocation` / `expo-location` |
| `navigator.clipboard` | `@react-native-clipboard/clipboard` |
| `history.pushState` | `navigation.navigate` |
| `alert()` | `Alert.alert(...)` |
| `console.log` | ✅ 可用，输出到 Metro 终端 |
| `setTimeout/Interval` | ✅ 可用 |
| `URL` / `URLSearchParams` | ✅ 可用（有 polyfill） |

---

## 9. 平台差异化代码

RN 的代码会同时运行在 iOS 和 Android 上，某些场景需要区分：

### 9.1 Platform API

```tsx
import { Platform } from 'react-native';

Platform.OS;                       // 'ios' | 'android' | 'web' | 'windows' | 'macos'
Platform.Version;                  // iOS: '17.2', Android: 34

// 条件样式
const styles = StyleSheet.create({
  header: {
    paddingTop: Platform.OS === 'ios' ? 44 : 24,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 4 },
    }),
  },
});
```

### 9.2 平台专属文件

Metro 打包器会按后缀自动选择文件：

```text
Button.ios.tsx       ← iOS 构建时使用
Button.android.tsx   ← Android 构建时使用
Button.tsx           ← 共用
```

引入时写 `import Button from './Button'` 即可。

### 9.3 iOS / Android 行为差异要点

| 行为 | iOS | Android |
|------|-----|---------|
| 默认返回手势 | 从左边缘滑 | 物理/系统返回键 |
| StatusBar | 内容默认不延伸到 StatusBar 下 | 需要手动处理 |
| 字体 | 系统字体 "San Francisco" | "Roboto"，自定义字体文件名就是 `fontFamily` |
| 阴影 | `shadow*` | `elevation` |
| Ripple 效果 | 无 | `Pressable` 有 `android_ripple` |
| Overflow | 支持 `overflow: 'visible'` | 有些版本不支持 |
| 键盘遮挡 | 需要 `KeyboardAvoidingView behavior='padding'` | 通常 `'height'` |
| 字体渲染 | 无 `includeFontPadding` | 默认有 padding，常要 `includeFontPadding: false` |

---

## 10. 列表渲染：别再用 map

Web 里几千条数据用 `map` 没问题（至少不会立刻崩）。**RN 里 map 长列表是性能自杀**。

```tsx
// ❌ 数据一多就会卡
<ScrollView>
  {items.map(item => <Row key={item.id} {...item} />)}
</ScrollView>

// ✅ 使用 FlatList（窗口化渲染，只渲染可见项）
<FlatList
  data={items}
  keyExtractor={item => item.id}
  renderItem={({ item }) => <Row {...item} />}
  onEndReached={loadMore}
  onEndReachedThreshold={0.5}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
  ListHeaderComponent={<Header />}
  ListFooterComponent={loading ? <ActivityIndicator /> : null}
  ListEmptyComponent={<Empty />}
  // 性能优化
  initialNumToRender={10}
  maxToRenderPerBatch={10}
  windowSize={5}
  removeClippedSubviews
/>
```

更高性能的替代：`@shopify/flash-list`（同 API，性能显著更好）。

分组列表用 `SectionList`。

---

## 11. 图片、字体、资源处理

### 11.1 图片

```tsx
// 本地图（必须静态字符串，Metro 编译时解析）
<Image source={require('./logo.png')} />

// 远程图（对象格式，必须指定宽高或用 style）
<Image source={{ uri: 'https://x.com/a.png' }} style={{ width: 100, height: 100 }} />

// contain / cover / stretch / center
<Image source={...} resizeMode="cover" />
```

⚠️ 坑：
- 远程图**必须有明确宽高**，否则不显示。
- `require` 路径**不能是变量**（`require(url)` 不行）。
- 大图建议用 `react-native-fast-image`（有缓存）。

### 11.2 字体

- 把 .ttf/.otf 放进原生工程资源。
- iOS 要在 `Info.plist` 注册。
- Android 放 `android/app/src/main/assets/fonts/`。
- Expo 项目用 `expo-font` + `useFonts` Hook 方便很多。

### 11.3 SVG / Icon

- SVG 用 `react-native-svg`
- 图标用 `react-native-vector-icons` 或 `@expo/vector-icons`

---

## 12. 动画与手势

### 12.1 动画方案对比

| 方案 | 特点 | 场景 |
|------|------|------|
| `Animated`（内置） | 声明式，通过 `useNativeDriver` 可跑在 UI 线程 | 简单过渡、透明度、位移 |
| `LayoutAnimation`（内置） | 一行代码自动动画布局变化 | 列表增删、高度变化 |
| `react-native-reanimated` | 动画完全跑在 UI 线程，性能最好 | 复杂交互、手势驱动 |
| CSS `transition` | ❌ 不存在 | — |

```tsx
// Animated
const opacity = useRef(new Animated.Value(0)).current;
Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
<Animated.View style={{ opacity }}>...</Animated.View>

// Reanimated 3
const offset = useSharedValue(0);
const style = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
offset.value = withSpring(100);
<Animated.View style={style}>...</Animated.View>
```

### 12.2 手势

- 简单点按：`Pressable`
- 滑动/拖拽/多点/双指缩放：`react-native-gesture-handler`（基本必装）

---

## 13. 表单与键盘

RN 没有 `<form>`，完全手动管理：

```tsx
const [email, setEmail] = useState('');

<TextInput
  value={email}
  onChangeText={setEmail}        // 注意是 onChangeText，给的是纯字符串
  placeholder="邮箱"
  keyboardType="email-address"   // 控制键盘类型
  autoCapitalize="none"
  autoCorrect={false}
  secureTextEntry={false}        // 密码用 true
  returnKeyType="done"           // 键盘右下角按钮
  onSubmitEditing={handleSubmit} // 按回车/完成
/>
```

键盘避开：

```tsx
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  style={{ flex: 1 }}
>
  <ScrollView keyboardShouldPersistTaps="handled">
    {/* 表单 */}
  </ScrollView>
</KeyboardAvoidingView>
```

表单库推荐：`react-hook-form`（✅ 支持 RN）。

---

## 14. 调试、打包、热更新

| 工具 | Web | RN |
|------|-----|-----|
| 打包器 | webpack / vite | Metro |
| 开发服务器 | `npm run dev` | `npx react-native start` |
| 调试器 | Chrome DevTools | Flipper / Hermes Inspector / React DevTools |
| 热更新 | HMR 自动 | Fast Refresh（默认开启） |
| 真机调试 | 浏览器打开 | iOS Safari Web Inspector / Android Chrome inspect |

RN 独有能力：
- **远程 JS 热更新（CodePush / EAS Update）**：不走应用商店审核，直接推新 JS Bundle。但原生代码改动仍需发版。
- **Expo**：开箱即用的 RN 框架，带大量预装模块和云构建，上手门槛最低。

---

## 15. 常见踩坑清单

按"踩过的频率"排序：

1. **忘记用 `<Text>` 包字符串** → 直接崩。
2. **用 `onClick` 而不是 `onPress`** → 点没反应。
3. **远程 `<Image>` 没设宽高** → 图片不显示。
4. **直接 `style="color: red"` 字符串写法** → RN 必须对象。
5. **`margin: auto` 水平居中** → RN 里无效，用 `alignItems: 'center'`。
6. **用百分比设 `fontSize`** → 不支持，必须数字。
7. **`position: fixed`** → RN 没有 fixed，用 `position: absolute` + 顶层容器。
8. **`z-index` 在 Android 上经常失效** → 改用 `elevation` 或调整渲染顺序。
9. **长列表用 `map` + `ScrollView`** → 滚动卡顿，改用 `FlatList`。
10. **以为 `localStorage` 能用** → 用 `AsyncStorage`，而且是异步。
11. **在 render 里 `new Animated.Value()`** → 每次 render 都新建，用 `useRef`。
12. **`useNativeDriver: true` 时设了布局属性（`width/height/top/left`）** → 会报错，native driver 只支持 `transform` 和 `opacity`。
13. **`borderRadius` + `overflow: 'hidden'` 在 Android 上不裁剪图片** → 套一层 `View` + `borderRadius`。
14. **Text 样式以为能继承给子 View** → 不继承，跨 Text 也只继承部分属性。
15. **iOS 安全区没处理** → 内容被刘海/底部遮挡，必须 `SafeAreaView` 或 `useSafeAreaInsets`。
16. **键盘弹起遮住输入框** → 加 `KeyboardAvoidingView`。
17. **Android 字体垂直有额外留白** → 加 `includeFontPadding: false`。
18. **Modal 里的 `StatusBar` 在 iOS 上不生效** → Modal 上单独加 `<StatusBar />`。
19. **更新了原生依赖没跑 `pod install`（iOS）** → 构建报错，记得进 `ios/` 跑 `pod install`。
20. **以为改完 JS 就能跑，结果改的是原生配置** → 原生代码修改必须重新 build，不能只靠 Fast Refresh。

---

## 附：一张总览图

```text
                ┌──────────────────────────────────────────┐
                │          React Core (shared)             │
                │  Fiber / Reconciler / Hooks / Context    │
                └───────────────────┬──────────────────────┘
                                    │
                ┌───────────────────┴──────────────────────┐
                ▼                                          ▼
       ┌─────────────────┐                        ┌─────────────────┐
       │    react-dom    │                        │  react-native   │
       └────────┬────────┘                        └────────┬────────┘
                │                                          │
  HTML 标签 / CSS / DOM API               View/Text/Image / StyleSheet / Native API
                │                                          │
       浏览器 (DOM Tree)                    Yoga (Shadow Tree) → iOS/Android View
```

**一句话总结**：React 是一套声明式 UI 范式，Web 和 Native 是它的两个不同"渲染靶子"。上层业务逻辑、Hook、状态管理完全共享；下层一切关于"怎么画出来"的细节——标签、样式、事件、布局、存储、路由——都要换一套 API。
