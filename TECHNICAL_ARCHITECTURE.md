# MULTIBOT_PANEL 技术文档

## 1. 定位

`MULTIBOT_PANEL` 是 `MULTIBOT` 的浏览器运维前端。

它不是一个“全栈管理后台”，而是一个刻意保持轻量的两段式系统：

- Node 侧：只负责提供静态文件与健康检查
- 浏览器侧：直接请求 `MULTIBOT` HTTP API，并直接消费 SSE 事件流

因此它的设计原则始终是：

- 不引入额外代理层
- 不复制后端状态机
- 不保存后端账号数据
- 尽量让面板状态来源于后端，而不是浏览器自行推断

## 2. 总体结构

```text
浏览器
  ├─ 加载 MULTIBOT_PANEL/public/index.html
  ├─ 初始化 app.js
  ├─ 从 localStorage 读取后端配置与 UI 偏好
  ├─ 通过 api.js 请求 MULTIBOT HTTP API
  ├─ 通过 sse.js 连接 MULTIBOT /api/events
  └─ 通过 state.js + components/* 渲染 UI

MULTIBOT_PANEL/index.js
  └─ 只负责静态资源服务与 /healthz

MULTIBOT
  ├─ 提供 /api/bots / /api/instances 等 HTTP API
  └─ 提供 /api/events SSE 事件流
```

## 3. 启动与静态服务

入口文件是 `MULTIBOT_PANEL/index.js`。

它做的事情非常有限：

1. 读取 `panel.config.json`
2. 创建一个 `http.createServer(...)`
3. 对 `GET /healthz` 返回 `{ ok: true, title }`
4. 对其他 `GET` / `HEAD` 请求，从 `public/` 目录返回静态文件

这里有几个设计点：

- 没有 Express、Koa、Vite 等额外依赖
- 没有 API 代理
- 没有 SSR
- 对静态路径做了目录穿越保护

这意味着面板部署成本很低，但也意味着：

- 浏览器必须能直接访问 `MULTIBOT` 后端地址
- Token 会直接用于浏览器发起的请求

## 4. 浏览器端模块划分

### 4.1 `public/index.html`

职责：

- 提供页面骨架
- 定义主布局和两个模态框容器
- 明确脚本加载顺序

该文件采用传统多 `<script defer>` 顺序加载，而不是打包器模块系统。

### 4.2 `public/app.js`

这是面板的主控制器。

它负责：

- 初始化 store
- 初始化 SSE 管理器
- 管理后端编辑器、实例弹窗、布局宽度等局部 UI 状态
- 触发 API 请求
- 把后端响应与 SSE 事件折叠进 store
- 调用各组件重新渲染

可以把它理解为：

- 一半是应用编排层
- 一半是控制器层

它不是 React/Vue 式组件树，也不是 Redux middleware 体系，而是一个显式串联的 vanilla JS orchestrator。

### 4.3 `public/api.js`

职责：

- 规范化 `baseUrl`
- 注入 Bearer Token
- 发送 JSON 请求
- 统一超时、网络错误、401 鉴权错误、HTTP 错误的报错形式

这里的一个重要原则是：

- API client 不解释业务语义，只负责请求与错误归一化

### 4.4 `public/sse.js`

职责：

- 连接后端 `GET /api/events`
- 手动解析 `text/event-stream`
- 处理断线重连
- 暴露 `onEvent` / `onStateChange` / `onError`

为什么要手动解析？

- 因为这里不是使用浏览器原生 `EventSource`
- 需要带鉴权头，所以采用 `fetch + ReadableStream` 方案

这也是它与普通 SSE 客户端最不同的地方。

### 4.5 `public/state.js`

职责：

- 定义初始状态
- 实现轻量 reducer
- 提供 `createStore(initialState)`

状态大体分成两层：

- `backends`
  - 多后端配置与每个后端的运行时视图
- `ui`
  - 日志过滤、命令历史、提示消息等浏览器本地状态

这个 store 是面板内部的真相来源，但它并不替代后端真相。
它更像是“后端状态的浏览器镜像 + 一些临时 UI 状态”。

### 4.6 `public/storage.js`

职责：

- 管理 `localStorage` 读写
- 约束后端配置对象结构
- 持久化 UI 偏好与命令历史

它只保存本地可丢失的浏览器状态，不保存 bot 业务数据。

### 4.7 `public/formatters.js`

职责：

- 把原始状态、时间、日志、锁信息转成适合展示的文本
- 对 HTML 做基础转义

这个模块的目标是统一展示语义，而不是承载业务逻辑。

### 4.8 `public/instance-presets.js`

职责：

- 定义实例编辑器的一键模板
- 判断模板是否已应用
- 把模板 patch 应用到当前 draft
- 把模板 patch 从 draft 中撤销

当前模板是对“编辑器里的 JSON draft”生效，而不是直接对磁盘文件生效。

### 4.9 实例编辑器的混合形态

实例编辑器现在同时保留三种输入方式：

- 结构化快捷表单
  - 适合改 `server.json`、`default.config.json`、`config.json` 里最常动的字段
- 一键模板
  - 适合快速套用常见能力组合
- 原始 JSON 文本框
  - 适合处理 GUI 暂未覆盖的字段，仍然按整文件保存

这三层共用同一个 draft，因此：

- 任何一层改动都会同步到同一份待保存草稿
- 保存时仍然是按完整 JSON 文件替换
- 页面刷新或后端轮询时，`app.js` 会尽量恢复当前草稿、滚动位置和焦点

### 4.10 `public/components/*`

组件目录下的文件都是“渲染器”：

- `status-bar.js`
- `backends.js`
- `bot-list.js`
- `bot-detail.js`
- `command-panel.js`
- `logs-panel.js`
- `instances.js`

这些模块的共同特征：

- 接受 `container + props`
- 直接写 `innerHTML`
- 立即绑定事件
- 不维护复杂内部状态

这是一个显式、可读性优先的渲染模型。

## 5. 状态模型

面板的状态可以分成三类：

### 5.1 持久化状态

保存在浏览器 `localStorage`：

- 后端配置列表
- 当前选中的后端 ID
- 命令历史
- 一部分 UI 偏好

### 5.2 后端运行时镜像

存在于内存 store：

- 每个后端的连接状态
- bot 列表
- bot 详情
- 日志缓存

### 5.3 纯 UI 临时状态

存在于 `app.js` 局部状态中：

- 后端编辑器是否打开
- 实例弹窗是否打开
- 当前实例编辑 draft
- 拖拽分栏宽度

为什么不把这些全塞进 `state.js`？

- 因为这些状态不是跨模块共享的业务真相
- 它们更像当前页面会话中的控制器状态

## 6. 数据流

### 6.1 冷启动

1. 加载 `index.html`
2. 依次加载 `storage.js`、`formatters.js`、`api.js`、`state.js`、`sse.js`、组件与 `app.js`
3. `app.js` 在 `DOMContentLoaded` 后初始化
4. 从 `localStorage` 恢复后端配置与 UI 偏好
5. 创建 store
6. 渲染空界面或恢复上次选中的后端
7. 如果存在有效选中后端，则拉取 bot 列表并建立 SSE

### 6.2 普通 HTTP 同步

常见流程：

1. 用户点击某个按钮
2. `app.js` 调用 `apiClient`
3. HTTP 响应回来后 dispatch 到 store
4. `store.subscribe(...)` 触发重新渲染

### 6.3 SSE 实时同步

`sse.js` 收到事件后：

1. 解析一个个 SSE block
2. 回调到 `app.js`
3. `app.js` 根据事件类型更新 store
4. 触发对应 bot 或后端视图刷新

### 6.4 实例编辑

实例编辑器是一个典型“本地 draft -> 保存”的流程：

1. 打开实例详情
2. 读取后端返回的 `serverConfig` / `defaultBotConfig` / `botConfig`
3. 转成三个可编辑 JSON 字符串
4. 在本地维护 draft
5. 保存时重新 parse 成对象
6. 调用实例 API

当前面板在实例编辑器保存时会采用“整文件替换”语义，以支持真正删除 JSON 字段。

## 7. 与后端 API 的关系

### 7.1 为什么不做代理

这个面板选择让浏览器直接请求后端，而不是通过面板服务器转发，原因有几个：

- 面板服务器可以保持极简
- 前后端边界清晰
- 调试更直接
- 不需要维护一套二次 API

代价是：

- 浏览器必须能直接访问后端地址
- Bearer Token 直接存于浏览器本地

### 7.2 核心接口

面板高度依赖这些后端接口：

- `GET /api/bots`
- `GET /api/bots/:id`
- `POST /api/bots/:id/start`
- `POST /api/bots/:id/stop`
- `POST /api/bots/:id/restart`
- `POST /api/bots/:id/command`
- `GET /api/events`
- `GET /api/instances`
- `GET /api/instances/:serverDir/:botDir`
- `POST /api/instances`
- `PATCH /api/instances/:serverDir/:botDir`
- `DELETE /api/instances/:serverDir/:botDir`

面板原则上不定义新的业务协议，只消费这些既有接口。

## 8. 控制台输入策略

面板并不简单地把输入框内容全部当命令发送。

当前策略是“尽量贴近旧版控制台语义”：

- 带控制命令前缀的文本优先按命令
- 普通文本直接按聊天
- 某些命令失败时允许回退

这样做的目的，是让面板的输入行为与旧终端控制体验保持一致，而不是变成另一个完全不同的控制入口。

## 9. 日志模型

面板里的日志来源主要有两类：

- 拉详情时拿到的已有日志
- SSE 持续推送的新日志

为了避免重复堆积，`state.js` 里有一层去重逻辑：

- 使用 botId / timestamp / level / message 组合键去重
- 每个 bot 的日志在前端只保留最近一段窗口

这意味着面板更关注“实时可用”和“浏览体验”，而不是日志全量归档。

全量日志归档仍是 `MULTIBOT` 后端自己的职责。

## 10. 实例管理模型

实例管理是当前面板最重的一个子系统。

它除了显示实例列表外，还承载：

- 磁盘文件可视化
- 多个 JSON 文件协同编辑
- 共享配置与实例配置的区别展示
- 一键模板

### 10.1 三份配置文件

实例编辑器里的三份 JSON 各自角色不同：

- `server.json`
  - 面向同 `serverDir` 的共享运行时连接字段
- `default.config.json`
  - 面向同 `serverDir` 的共享 bot 默认配置
- `<botDir>/config.json`
  - 当前实例自己的 bot 配置

### 10.2 保存语义

当前面板把编辑器当成“文件编辑器”，而不是“补丁编辑器”。

因此它保存时采用整文件替换语义，这样：

- 删除字段会真实删除
- 不会因为后端深合并而把旧字段悄悄保留

### 10.3 模板系统

模板系统作用在当前 draft 上，而不是直接写磁盘。

它的好处是：

- 模板行为可预览
- 用户仍可继续手工调整 JSON
- 多个模板可以叠加

## 11. 安全边界

这个面板不是强安全产品，更多是“本地或受信网络中的运维工具”。

当前安全边界主要依赖：

- 后端 Bearer Token
- 浏览器同源上下文
- 不在面板服务器落盘保存 token

因此建议：

- 不要把面板暴露到公开互联网
- 不要在不受信浏览器环境中长期保存 token
- 需要更高安全级别时，应优先增强 `MULTIBOT` 后端鉴权与部署方式

## 12. 测试结构

面板测试主要覆盖四类内容：

### 12.1 静态服务

- `test/static-server.test.js`

验证：

- 配置加载
- `/healthz`
- 静态文件返回
- 404 行为

### 12.2 API 适配层

- `test/api-adapter.test.js`

验证：

- 请求头
- 方法与 payload
- 鉴权错误 / 网络错误归一化

### 12.3 SSE 解析与管理

- `test/sse-manager.test.js`

验证：

- SSE block 解析
- 连接与重连逻辑

### 12.4 状态与工具模块

- `test/state-reducer.test.js`
- `test/storage.test.js`
- `test/instance-presets.test.js`

验证：

- reducer 更新逻辑
- localStorage 持久化
- 实例模板应用与撤销

## 13. 适合继续扩展的方向

面板当前架构适合继续扩展这些点：

- 增加新的 bot 详情视图卡片
- 增加新的实例模板
- 增加更多日志过滤器
- 增加更多批量操作入口
- 增加针对 recorder / diagnostics 的专门面板

但不建议轻易做这些事：

- 引入前端框架重写整套 UI
- 在面板服务器里做代理层
- 让面板自行持有过多后端业务规则

因为那会破坏它目前“薄前端 + 直接对接后端”的结构优势。

## 14. 一句话总结

`MULTIBOT_PANEL` 的核心思想不是“做一个复杂后台”，而是：

在尽量少的前端基础设施下，提供一个足够实用、可维护、能直接映射 `MULTIBOT` 后端能力的浏览器控制面板。
