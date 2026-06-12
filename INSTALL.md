# 安装与配置（OMP 版）

本仓库是 [`pi-feishu-lark`](https://github.com/AX1202/pi-feishu-lark) 的 **OMP 兼容分支**：在 [Oh My Pi (`omp`)](https://omp.sh) 下运行，已修好 pi→omp 迁移遗留的连接、收消息、回复等问题。下面是从本仓库安装并跑通的完整步骤。

> 适用对象：使用 `omp` 命令行的用户。原版用 `pi` 命令、配置在 `~/.pi/`；本分支用 `omp` 命令、配置在 `~/.omp/`。

---

## 1. 从 GitHub 安装

**全新安装**（机器上还没装过 `pi-feishu-lark`）：

```bash
omp plugin install github:shawroger/pi-feishu-lark
```

**从 npm 版切换到本分支**：如果之前装过 npm 版（`~/.omp/plugins/package.json` 里是 `"pi-feishu-lark": "^0.2.1"`），**必须先卸载再装**，不能直接装 GitHub 版——否则会报 bun `DependencyLoop` 错误（本分支 `version` 仍是 `0.2.1`，与 npm 的 `^0.2.1` 范围撞车，被当成自依赖）：

```bash
omp plugin uninstall pi-feishu-lark
omp plugin install github:shawroger/pi-feishu-lark
```

装好后 `~/.omp/plugins/package.json` 里应是 `"pi-feishu-lark": "github:shawroger/pi-feishu-lark"`。插件源码是 TypeScript，由 omp 直接加载,**无需编译**——仓库里提交的就是运行的代码。以后更新用 `omp plugin upgrade pi-feishu-lark` 重新拉取 master。

---

## 2. 飞书开发者后台配置（最关键，决定能不能收到消息）

在 <https://open.feishu.cn/app>（Lark 用 <https://open.larksuite.com/app>）创建一个**自建应用**，然后：

1. **凭证与基础信息**：记下 `App ID` 和 `App Secret`（第 3 步要用）。
2. **添加应用能力 → 机器人**：启用「机器人」能力。
3. **事件与回调 → 订阅方式**：必须选 **「使用长连接接收事件/回调」**。
   > ⚠️ 这是「显示已连接但收不到消息」最常见的原因。如果这里选的是「将事件发送至开发者服务器地址」（webhook URL 模式），长连接虽然连得上，但平台不会把消息推过来，机器人永远收不到任何消息。
4. **事件与回调 → 添加事件**：订阅 **「接收消息 `im.message.receive_v1`」**。
5. **权限管理**：至少开通
   - `im:message.p2p_msg:readonly`（接收用户发给机器人的单聊消息）
   - 需要群聊时再加 `im:message.group_at_msg:readonly`（接收群里 @ 机器人的消息）；
   - 或者直接开 `im:message`（收发消息）。
   - 群聊策略用 `open`（群里不 @ 也回复）时，还需在后台开启机器人「**获取群组中所有消息**」权限。
6. **创建版本并发布**：以上事件 / 权限改动，**必须**到「版本管理与发布 → 创建版本 → 申请发布」走一遍才生效。
   > ⚠️ 第二常见的坑：只改了事件 / 权限但没发版 = 不生效。

---

## 3. 在 OMP 内初始化并启动

```bash
/feishu setup     # 填入 App ID / App Secret，选 feishu 或 lark
/feishu start     # 启动后台桥接
```

状态栏出现 **`Feishu: 已连接 / Connected`** 即成功。然后在飞书里：

- **私聊**：直接私聊机器人发消息；
- **群聊**：把机器人拉进群，按群聊策略决定是否要 `@`。

---

## 4. 命令速查

OMP 里管理桥接：

| 命令 | 作用 |
| --- | --- |
| `/feishu setup` | 初始化配置（App ID / Secret / 域名） |
| `/feishu start` | 启动后台桥接 |
| `/feishu stop` | 停止桥接 |
| `/feishu restart` | 重启桥接，重新加载最新代码和配置 |
| `/feishu status` | 查看连接状态、当前 owner、配置 |
| `/feishu bind` | 把飞书消息绑定到当前终端会话（共享上下文，回复发回飞书） |
| `/feishu unbind` | 解除绑定，恢复后台独立会话 |
| `/feishu debug` | 查看最近调试日志 |
| `/feishu reset` | 清除配置和映射（保留会话历史） |

### 双向绑定：飞书 ↔ 当前终端会话

默认每个飞书会话由后台独立 OMP 会话处理，和你终端里正在跑的会话互不相通。在某个终端执行 `/feishu bind` 后，发给机器人的纯文本消息会注入**这个终端当前的会话**（共享上下文与历史），回复自动发回飞书；`/feishu unbind` 或退出该终端即恢复默认。说明：仅转发纯文本，带图片/附件的消息仍走后台独立会话；同一时间只有一个终端绑定生效；前台退出后绑定自动失效。

飞书里发给机器人的命令：

| 命令 | 作用 |
| --- | --- |
| `/new` | 为当前会话新建一个 OMP 会话 |
| `/resume` | 打开历史会话列表，切回以前的会话 |
| `/model` | 切换当前会话使用的模型 |
| `/stop` | 停止当前这条回复的处理 |
| `/workspace [绝对路径]` | 查看 / 切换当前会话绑定的工作区 |

---

## 5. 文件位置（OMP 路径）

| 路径 | 内容 |
| --- | --- |
| `~/.omp/agent/feishu/config.json` | 机器人凭证和基础配置 |
| `~/.omp/agent/feishu/state.json` | 飞书会话 ↔ OMP 会话映射 |
| `~/.omp/agent/feishu/debug.log` | 结构化调试日志（消息流转事件） |
| `~/.omp/agent/feishu/daemon.log` | 后台守护进程原始 stdout/stderr |
| `~/.omp/agent/locks.json` | 当前飞书连接的 owner 锁 |
| `~/.omp/agent/sessions/` | 每个飞书会话对应的 OMP 会话文件 |

后台桥接是独立常驻进程：OMP 主程序关掉后，机器人仍能在飞书里继续对话，无需让 OMP 前台运行。

---

## 6. 故障排查

**状态显示「已连接」但收不到消息**
几乎都是第 2 步后台配置问题，按顺序自查：
1. 订阅方式是不是「**使用长连接**」（不是 webhook URL）；
2. 是否订阅了 `im.message.receive_v1`；
3. 读消息权限是否开通；
4. 改完是否**创建版本并发布**。
然后 `tail ~/.omp/agent/feishu/debug.log`：发了消息却**没有** `feishu.message.received` 事件 ⇒ 平台没把事件推过来，就是上面的后台配置；有 `feishu.message.received` 但后面报 `feishu.handler.error` ⇒ 是处理 / 回复环节问题，看报错内容。

**回复时报错 / 看日志**
- `~/.omp/agent/feishu/daemon.log`：守护进程崩溃、SDK 报错都在这里；
- `~/.omp/agent/feishu/debug.log`：完整链路 `message.received → handler.parsed → handler.model → prompt.start → prompt.done → reply.text`。

**改了代码 / 配置不生效**
`/feishu restart` 重新拉起守护进程加载最新代码。若怀疑有残留进程占用 3001 端口，`/feishu stop` 后再 `/feishu start`。

**卡片按钮回调**
卡片回调默认监听 `0.0.0.0:3001/webhook/card`；如需走 WS 回包，把环境变量 `FEISHU_CARD_ACTION_MODE` 设为 `ws`。

---

## 7. 本分支相对原版的 OMP 兼容补丁

- `index.ts`：守护进程启动参数去掉 `--no-extensions`（omp 在 `--no-extensions` 下会连显式 `-e` 路径一起丢弃，导致插件根本没加载）；`looksLikeFeishuDaemon` 改按 `--mode rpc` + 扩展路径匹配（原来要求 pi 旧 flag `--no-builtin-tools`，omp 已改名 `--no-tools`，导致守护进程清理永远失效）。
- `conversation-manager.ts`：删除 pi 时代的 `session.bindExtensions({})`（omp 已移除该方法，扩展绑定改在 `createAgentSession` 内部按 `disableExtensionDiscovery` 处理）；这是收到消息后回复 `OMP error: session.bindExtensions is not a function` 的根因。
- `conversation-manager.ts`：适配 omp 改过的 `SessionManager.open` 签名——第三个参数由旧版的 `cwdOverride`（字符串）改成了 `storage`，且方法由同步变为异步。旧写法 `SessionManager.open(file, undefined, workspaceCwd)` 会把工作区路径当成 `storage` 传进去，触发 `storage.readText is not a function`，导致 gateway「已连接、一发消息就崩溃断开」。改为 `await SessionManager.open(file)`（cwd 仍由 `createAgentSession({ cwd: workspaceCwd })` 保证），并把读取会话工作区的 `getWorkspaceFromSessionFile` 改成 `async` 后 `await` 调用。
- `gateway-lock.ts`：锁文件路径由硬编码 `~/.pi/agent/locks.json` 改为 `getAgentDir()/locks.json`，让守护进程与主程序共用同一把锁。
- `cards.ts` / `message-handler.ts` / `rich-text.ts` / `conversation-manager.ts`：面向用户的文案 `Pi` → `OMP`。
