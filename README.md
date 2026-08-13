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
- Material-inspired 深色运维主题，不依赖 React、MUI 或打包器
- 支持桌面、窄屏桌面与移动端响应式布局
- 支持保存多个 `MULTIBOT` 后端配置
- 浏览器本地保存后端 `baseUrl`、Bearer Token、UI 偏好、命令历史
- 展示 bot 列表、bot 详情、运行状态、能力状态、锁状态、最近回复与日志
- bot 列表按服务器筛选，默认只显示第一个服务器，并隐藏组合 ID 中的服务器前缀
- 支持启动、停止、重启单个 bot
- 支持通过控制台输入发送聊天或控制命令
- 支持实时查看 bot 背包与打开的窗口（箱子/工作台/熔炉等），拖拽移动/拆分物品，一键关闭窗口
- 支持实时 SSE 日志、状态同步和历史日志补回
- 支持实例列表、实例详情、创建、编辑、删除
- 支持编辑 `server.json`、共享 `default.config.json`、实例 `config.json`
- 支持实例编辑一键配置模板
- 实例配置按“服务器 / 共享默认 / 当前实例 / 高级 JSON”四个标签组织

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

面板合并日志时按时间戳排序，并对同一时间/级别/文案的重复事件做计数去重；SSE 补回的历史日志会与实时日志按时间正确合并，不会把旧日志追加到新日志之后。

## 刷新与渲染策略

面板的周期刷新采用“静默优先”策略，避免后台数据更新干扰正在进行的操作：

- 每 30 秒的后端轮询不会主动改连接状态，也不会在数据没有变化时触发重绘
- bot 列表 / bot 详情 / SSE 状态事件在内容没有变化时不会通知 UI 重新渲染
- 页面渲染按区域独立进行：日志流只增量追加新行，bot 列表只更新变化卡片的徽章与摘要，隐藏的弹窗不参与渲染
- 日志自动滚动只在用户本就位于底部附近时跟随，向上翻阅历史不会被强制拉回

## 界面与交互

当前界面参考 Material Design 的信息层级和交互状态，但仍保持原生静态页面架构：

- 顶部状态栏集中显示当前后端、连接状态和主要入口
- 运行状态、能力和日志级别使用统一的状态色与紧凑徽标
- Bot 列表在名称左侧显示 Minecraft 皮肤头像：面板进程代理微软/Mojang 官方接口取皮肤，浏览器裁脸后存 `localStorage`（TTL 30 天），头像不可用时保留首字母占位
- 二元配置使用 Switch，命令操作使用明确的按钮层级
- 所有主要控件都有 `hover`、按下、`focus-visible` 和禁用状态
- 窄屏下主布局、实例列表和配置网格会按断点重排，不依赖页面缩放
- 系统启用“减少动态效果”时，界面会关闭非必要过渡动画

这里没有安装 `@mui/material`。视觉升级只复用了 Material 风格的设计原则，继续保留无构建步骤、无框架的运行方式。

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

实例编辑器分成四个标签：

- `服务器`：实例目录、保存后启动选项和共享 `server.json` 连接参数
- `共享默认`：同一 `serverDir` 下共用的 `default.config.json`
- `当前实例`：一键模板和当前实例 `config.json` 的常用图形配置
- `高级 JSON`：三份配置文件的完整 JSON 文本

新建实例默认打开“服务器”，编辑已有实例默认打开“当前实例”。模板触发局部重绘后仍会停留在当前标签，不会把用户跳回第一个标签。

标签支持鼠标点击，也支持键盘操作：

- `←` / `→`：切换到相邻标签
- `Home`：切换到第一个标签
- `End`：切换到最后一个标签

实例编辑器最终仍然编辑三类 JSON：

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

- `server.json`：`host`、`port`、`auth`、`version`、`viewDistance`、`disableChatSigning`、`checkTimeoutInterval`、`restartOnDisconnect`、`restartDelayMs`、`restartJitterMs`，以及多级重连开关（`restartDelayScheduleMs` 分级延迟数组 + `restartDelayScheduleRepeatLast` 耗尽后是否重复最后一级）
- `default.config.json`：`trustedPlayers`、`trustedPlayersMergeParent`、`trustedPlayersFile`、`teleport.*`、`logging.*`、`behavior.*`、`capabilities.*`、`fish`、`attack.autoAttack`、`monitoring.enabled`、`recording.*`
- `config.json`：常用运行时开关和能力项，完整内容保留在“高级 JSON”标签

这层 GUI 不是新的数据源，只是帮你少手改 JSON；底层仍然按三份文件和后端合并规则生效。

多级重连与旧版固定延迟重连互斥：开启“多级重连”开关后，面板会写入默认分级延迟数组并移除 `restartDelayMs`；关闭开关则移除 `restartDelayScheduleMs` / `restartDelayScheduleRepeatLast`。`restartOnDisconnect` 仍是总开关，`restartJitterMs` 两种模式共用。

## 与后端的边界

`MULTIBOT_PANEL` 与 `MULTIBOT` 的边界非常明确：

- 面板服务器提供静态文件、`/healthz` 和头像代理 `GET /avatar/:username`
- 浏览器直接请求 `MULTIBOT` HTTP API
- 浏览器直接连接 `MULTIBOT` 的 `GET /api/events` SSE
- 面板服务器不转发、不缓存、不代理后端数据（唯一的例外是皮肤头像：`/avatar/:username` 由面板进程代理微软/Mojang 接口并进程内缓存，见下文“头像获取”）
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

## 背包与窗口

Bot 详情区可以实时查看当前背包与打开的窗口（箱子、大箱子、工作台、熔炉等，含服务器插件菜单）：

- 数据链路：MULTIBOT 后端监听 `updateSlot` / `windowOpen`，通过 SSE `inventory` 事件推送——`window`（全量，窗口开/关与 spawn 时）与 `patch`（增量，100ms 合并槽位变化）
- 面板在 SSE 连接建立与切换 bot 时各拉一次 `GET /api/bots/:id/inventory` 快照兑底，避免错过事件时序
- 槽位以窗口原始索引为准；增量的槽值为 `null` 表示该槽清空；未知窗口类型降级为格子列表并提示“未识别窗口”
- 操作：
  - **拖拽移动**：把物品拖到目标槽即移动整组；按住 **Shift** 拖 = 半组、**Alt/Ctrl** 拖 = 1 个（走后端 `chest move <源> <目标> [数量]` 命令）
  - **关闭窗口**：一键调 `POST /api/bots/:id/close-window`（幂等，无窗口也返回 ok）
- 物品图标从本地提取的图标集（`public/assets/items/`，见下文「纹理素材提取」）加载，缺失时回退显示名称首字 + 数量 + 耐久条（协议不传图片）

依赖后端 `WindowFeature`（MULTIBOT `src/features/window/`）提供的事件与端点，后端版本需包含该模块。

## 纹理素材提取（Mojang 资产，本地提取，不入库）

面板的 GUI 背景与物品图标素材**不随仓库分发**——它们来自你本地安装的正版 Minecraft 客户端，`public/assets/` 已加入 `.gitignore`。仓库只提供提取脚本（`scripts/`）与槽位坐标布局表（`public/components/inventory-panel.js` 的 `SLOT_LAYOUTS`），你需要自行从本地客户端提取。

### 素材来源

所有纹理都位于版本 jar 内（本质是 zip 归档，路径 `%APPDATA%\.minecraft\versions\<版本>\<版本>.jar`）：

- GUI 容器纹理：`assets/minecraft/textures/gui/container/*.png`——`inventory.png`（背包）、`generic_54.png`（双箱子）、`crafting_table.png`（工作台）、`furnace.png`（熔炉）、`smoker.png`、`blast_furnace.png`、`dispenser.png`、`hopper.png`、`shulker_box.png` 等
- 物品图标：`assets/minecraft/textures/item/*.png` 与 `assets/minecraft/textures/block/*.png`（方块类物品的图标来自方块贴图，如橡木木板、火把）

### 提取步骤

1. 把上面 GUI 容器纹理从版本 jar 解压到 `public/assets/gui/`（保留 jar 内原样 PNG）
2. 裁剪到实际绘制区域（去掉 256×256 图集四周透明边距，保证背景图与槽位布局表 1:1 坐标系，否则槽位百分比定位会错位）：

   ```powershell
   python scripts/crop-gui-textures.py
   ```

3. 生成单箱子背景（1.21 起单箱子没有静态纹理、由游戏代码绘制，故从双箱子 `generic_54.png` 按标准条带重排拼出 `chest.png` 176×167）：

   ```powershell
   python scripts/make-chest-png.py
   ```

4. 提取物品图标并生成索引（方块物品图标取方块贴图，同名时 item 优先）：

   ```powershell
   python scripts/extract-item-icons.py <你的版本jar路径>
   ```

### 槽位坐标从哪来

`analyze-inventory-png.py` 可扫描 `inventory.png` 里全部槽位：槽内为 ~128 灰像素，做连通域聚类后取质心即槽中心坐标，用于核对/生成 `SLOT_LAYOUTS` 布局表（背景图坐标系 = 绘制区域 176×166，槽位从 `(7,17)` 起按 18px 步进，1.8+ 未变）。

### 版权说明

纹理与游戏资产版权归 Mojang AB / Microsoft。本仓库不包含任何 Mojang 纹理图片，提取脚本与坐标数据仅用于个人学习用途；请勿将提取出的素材用于再分发或商业用途。

## 头像获取

Bot 列表的头像来自 Minecraft 正版皮肤，由面板进程代理官方接口获取：

1. `api.minecraftservices.com/minecraft/profile/lookup/name/<玩家名>` 拿 UUID（微软官方接口，替代即将弃用的 `api.mojang.com`）
2. `sessionserver.mojang.com/session/minecraft/profile/<uuid>` 拿皮肤纹理地址
3. 面板进程下载皮肤 PNG 并做 24 小时进程内缓存，通过 `GET /avatar/:username`（同源）返回给浏览器
4. 浏览器用 canvas 裁出 8×8 头部区域放大为 40×40，转成 `data:` URL 存入 `localStorage`（默认 30 天，TTL 与尺寸定义在 `public/skin.js`）。放大使用整数倍无平滑插值，保持像素硬边；64×64 双层皮肤会额外叠加 `(40,8)` 处的头部外层（帽子/头饰），64×32 老皮肤不绘制外层

要点：

- 实例配置里的 `username` 字段必须是与 Mojang 账户匹配的**游戏内名**，微软邮箱不会命中头像查询
- 查询失败（玩家不存在 / 网络异常 / 限流）会做 5 分钟失败防抖，避免反复请求触发官方限流
- 头像数据只经面板进程访问一次官方接口，之后面板缓存与浏览器 `localStorage` 共同兜底，刷新页面不再打上游
- 正版换肤后最多 24 小时（面板进程缓存）+ 30 天（浏览器缓存）内仍显示旧头像，属预期行为

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
node --test MULTIBOT_PANEL/test/instances-component.test.js
```

## 适合谁看

- 想直接使用面板：先看当前文件
- 想理解面板内部实现：看 `MULTIBOT_PANEL/TECHNICAL_ARCHITECTURE.md`
- 想继续维护或扩展面板：看 `MULTIBOT_PANEL/AGENTS.md`
