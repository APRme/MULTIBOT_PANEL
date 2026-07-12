# MULTIBOT_PANEL

`MULTIBOT_PANEL` 是 `MULTIBOT` 的独立网页运维面板。

它本身不托管 bot、不代理后端 API，也不保存账号文件；它只负责：

- 提供本地静态网页入口
- 在浏览器里保存后端连接信息与 UI 偏好
- 直接对接 `MULTIBOT` 的 HTTP API 与 SSE 事件流

可以把 `MULTIBOT` 理解为“多 bot 后端”，把 `MULTIBOT_PANEL` 理解为它的“浏览器控制台 + 实例管理界面”。

## 文档导航

- 使用简介：当前文件
- 技术架构：`MULTIBOT_PANEL/TECHNICAL_ARCHITECTURE.md`
- 面板协作约定：`MULTIBOT_PANEL/AGENTS.md`
- 后端接口与配置：`MULTIBOT/README.md`、`MULTIBOT/CONFIGURATION_GUIDE.md`

## 当前能力

- 原生 `HTML / CSS / JavaScript` 单页应用
- 独立 Node 静态服务，无前端构建步骤
- 支持保存多个 `MULTIBOT` 后端配置
- 浏览器本地保存后端 `baseUrl`、Bearer Token、UI 偏好、命令历史
- 展示 bot 列表、bot 详情、运行状态、能力状态、锁状态、最近回复与日志
- 支持启动、停止、重启单个 bot
- 支持通过控制台输入发送聊天或控制命令
- 支持实时 SSE 日志、状态同步和历史日志补回
- 支持实例列表、实例详情、创建、编辑、删除
- 支持编辑 `server.json`、共享 `default.config.json`、实例 `config.json`
- 支持实例编辑一键配置模板

## 目录结构

```text
MULTIBOT_PANEL/
├─ index.js                      # 面板静态服务器入口
├─ panel.config.json             # 面板监听地址与标题
├─ public/                       # 浏览器侧静态资源
│  ├─ index.html                 # 页面骨架与脚本加载顺序
│  ├─ app.js                     # 主控制器，串联 API / SSE / store / UI
│  ├─ api.js                     # HTTP API 访问封装
│  ├─ sse.js                     # SSE 管理器
│  ├─ state.js                   # 轻量 store + reducer
│  ├─ storage.js                 # localStorage 持久化
│  ├─ instance-presets.js        # 实例编辑器一键模板
│  └─ components/                # 各面板渲染模块
├─ test/                         # 面板侧测试
└─ start-multibot-panel.*        # 启动脚本
```

## 启动

### PowerShell

```powershell
cd MULTIBOT_PANEL
.\start-multibot-panel.ps1
```

### 批处理

```powershell
cd MULTIBOT_PANEL
.\start-multibot-panel.bat
```

### 直接运行入口

```powershell
cd MULTIBOT_PANEL
node .\index.js
```

## 默认地址

- 面板地址：`http://127.0.0.1:18081`
- 健康检查：`http://127.0.0.1:18081/healthz`
- 默认配置文件：`MULTIBOT_PANEL/panel.config.json`

```json
{
  "host": "127.0.0.1",
  "port": 18081,
  "title": "MULTIBOT Panel"
}
```

## 前置条件

使用面板前，需要至少准备一个可访问的 `MULTIBOT` 后端：

- 默认后端地址：`http://127.0.0.1:18080`
- 后端必须启用 HTTP API
- 需要知道后端的 Bearer Token

如果后端未启动、地址错误或 Token 错误，面板会显示连接失败或鉴权失败。

## 使用简介

### 1. 添加后端

在后端管理弹窗里填写：

- `name`：给这条后端连接起一个本地名称
- `baseUrl`：例如 `http://127.0.0.1:18080`
- `token`：对应 `MULTIBOT` 的 API Token

这些信息只保存在当前浏览器的 `localStorage` 中，不会回传给面板服务器。

### 2. 选择后端

选中某个后端后，面板会：

- 拉取 bot 列表
- 拉取当前选中 bot 的详情
- 建立 `GET /api/events` SSE 长连接
- 持续接收实时状态和日志

如果当前后端被禁用，面板不会主动连接它。

### 3. 选择 bot

选中 bot 后，右侧详情区会显示：

- 基础运行状态
- 锁状态、能力状态、部分运行时摘要
- 最近回复
- 日志流
- 控制台输入区

## 控制台输入语义

面板控制台输入已经对齐旧版 `afk.js` 的常用逻辑：

- 输入 `/health`：按控制命令发送
- 输入 `你好`：直接按聊天发送
- 输入 `/未识别命令`：如果后端未识别，通常会按普通聊天回退处理
- 输入 `/exit` 或 `exit`：停止当前实例

这和早期“所有输入都当命令发给后端”的逻辑不同。

## 日志同步

面板日志来自两条路径：

- 实时路径：浏览器通过 `GET /api/events` 接收 `log` SSE 事件
- 补回路径：SSE 建连或重连时，后端先发送 `bootstrap.logsByBotId`

`bootstrap.logsByBotId` 会按 bot id 分组返回最近历史日志，用于补回：

- 面板打开前已经发生的启动日志
- SSE 断线期间错过的日志
- 登录、资源包、启动超时、报错等属于单个假人的信息

补回日志不会增加未读数量；后续实时 `log` 事件仍会按假人单独归档并计入未读。

## 实例管理

实例管理弹窗对应后端这些接口：

- `GET /api/instances`
- `GET /api/instances/:serverDir/:botDir`
- `POST /api/instances`
- `PATCH /api/instances/:serverDir/:botDir`
- `PUT /api/instances/:serverDir/:botDir`
- `DELETE /api/instances/:serverDir/:botDir`

删除实例只删除对应 Bot 目录。即使它是该服务器下最后一个 Bot，`server.json`、`default.config.json`、共享名单和聚合日志也会保留。

实例详情里会显示：

- `server.json`
- `default.config.json`
- 当前实例自己的 `config.json`
- 相关磁盘路径

## 编辑实例配置

实例编辑器支持直接编辑三类 JSON：

- `server.json`
- `default.config.json`
- 当前实例自己的 `config.json`

关键规则：

- `server.json` 影响同一 `serverDir` 下的所有 bot
- `default.config.json` 也影响同一 `serverDir` 下的所有 bot
- 当前实例自己的 `config.json` 优先级高于 `default.config.json`
- `server.json` 里如果还保留旧式 `connection` 包裹，面板会按同一层级兼容显示和保存
- 如果你要让受信任玩家名单按上层配置合并，可在 JSON 里写 `trustedPlayersMergeParent: true`
- 保存时按“整文件替换”语义提交，删除字段也会真正落盘

后端合并优先级是：

```text
当前实例 config.json > serverDir/default.config.json > 内建默认值
```

如果删除了某个字段，但运行后看起来仍然生效，优先检查这个字段是否来自 `default.config.json` 或内建默认值。

## 一键配置模板

实例编辑器支持一键模板，用于快速写入常用配置，例如：

- 自动启动
- 白名单传送
- 接受资源包
- 禁用实体处理
- 禁用地形处理
- 自动钓鱼
- 自动攻击
- 录制

模板按钮会高亮显示“当前 draft 已满足该模板项”。

再次点击已高亮的模板时，面板会尽量移除该模板引入的配置项，而不是无条件覆盖整份配置。

## 图形化快速配置

实例编辑器里现在还提供了一层“快速配置”表单，覆盖这些常用项：

- `server.json`：`host`、`port`、`auth`、`version`、`viewDistance`、`disableChatSigning`、`checkTimeoutInterval`、`restartOnDisconnect`、`restartDelayMs`、`restartJitterMs`
- `default.config.json`：`trustedPlayers`、`trustedPlayersMergeParent`、`trustedPlayersFile`、`teleport.*`、`logging.*`、`behavior.*`、`capabilities.*`、`fish`、`attack.autoAttack`、`monitoring.enabled`、`recording.*`
- `config.json`：常用运行时开关和能力项，下面仍保留完整 JSON 编辑区

这层 GUI 不是新的数据源，只是帮你少手改 JSON；底层仍然按三份文件和后端合并规则生效。

## 与后端的边界

`MULTIBOT_PANEL` 与 `MULTIBOT` 的边界非常明确：

- 面板服务器只提供静态文件和 `/healthz`
- 浏览器直接请求 `MULTIBOT` HTTP API
- 浏览器直接连接 `MULTIBOT` 的 `GET /api/events` SSE
- 面板服务器不转发、不缓存、不代理后端数据
- bot 账号、会话、认证缓存都仍由 `MULTIBOT` 管理

## 常见问题

### 面板打不开

先确认：

- `MULTIBOT_PANEL` 已经启动
- `panel.config.json` 里的监听地址没有被占用
- 浏览器访问的是 `http://127.0.0.1:18081`

### 后端显示离线

常见原因：

- `baseUrl` 填错
- `MULTIBOT` 后端没启动
- Token 错误
- 浏览器或网络环境拦截了 SSE

### 改了配置但启动后还是旧行为

优先检查：

- 是否实际保存成功
- 改的是不是当前实例的 `config.json`
- 同名字段是否来自 `default.config.json`
- 是否通过实例 API / 面板保存路径触发了后端运行时更新

单独调用 `POST /api/bots/:id/restart` 只会重启当前 runtime，不会重新扫描磁盘上的实例配置文件。

### 页面刷新后输入丢失

面板已经做了草稿与滚动位置恢复；如果你仍然看到整页回到顶部，优先检查浏览器控制台里是否有脚本报错，通常是某个面板组件渲染异常而不是 SSE 重连本身。

## 开发与测试

这个面板没有前端构建流程，修改后刷新浏览器即可。

常用测试：

```powershell
node --test MULTIBOT_PANEL/test/*.test.js
```

更常见的定向测试：

```powershell
node --test MULTIBOT_PANEL/test/api-adapter.test.js
node --test MULTIBOT_PANEL/test/sse-manager.test.js
node --test MULTIBOT_PANEL/test/state-reducer.test.js
node --test MULTIBOT_PANEL/test/storage.test.js
node --test MULTIBOT_PANEL/test/static-server.test.js
```

## 适合谁看

- 想直接使用面板：先看当前文件
- 想理解面板内部实现：看 `MULTIBOT_PANEL/TECHNICAL_ARCHITECTURE.md`
- 想继续维护或扩展面板：看 `MULTIBOT_PANEL/AGENTS.md`
