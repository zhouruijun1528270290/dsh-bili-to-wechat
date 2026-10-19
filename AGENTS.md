# 给 AI 的接入说明

你在看一个小到不需要架构的仓库：**把一份 Markdown 日报变成一条一条推送出去的消息**。

上游（比如 [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll)）负责找视频、写报告；
你负责在**合适的时间**，把其中一条**发到某个聊天软件**里，像人随手分享那样。

这个仓库**不**抓 B 站、**不**登录、**不**推送、**不**存任何数据。它只有纯函数。
动手之前先读完下面四条「不变量」——每一条都对应一次真实的线上事故。

---

## 1. 你的任务

1. 找一个能发消息的渠道（微信机器人 / Telegram / 邮件 / 控制台都行）。
2. 写一个循环：定时读报告 → `parseReport` → 给每条排时间（`planDueAt`）→ 到点了 `itemToMessages` 发出去。
3. 用 `test/report.test.mjs` 的写法，为你自己的渠道补测试。

`examples/console.mjs` 是最小可运行版本（不需要任何账号）。
`examples/ilink.mjs` 是微信 iLink 官方机器人通道的参考骨架。

---

## 2. 接口契约

### `parseReport(md, { filename }) → { title, date, intro, items[] }`

`items[]` 每一项：

| 字段 | 说明 |
| --- | --- |
| `bv` | BV 号（唯一键） |
| `title` | 视频标题，不含书名号和 UP 名 |
| `up` | UP 主，**只取第一段**（上游常写成 `某人 · 6:54 · 播放 3313`） |
| `duration` | `mm:ss` / `hh:mm:ss`，拿不到就是空串 |
| `reason` | **口语化的那一句**（「我的一句」优先），退化到中性理由 |
| `snippet` | 引用块或「」里的那句 |
| `link` | `https://www.bilibili.com/video/<bv>` |

所有字段都可能是空串 —— 解析器宁可退化，也不能抛错把整份报告废掉。

### `itemToMessages(item, { linkStyle, maxChars }) → string[]`

返回 **1~2 个气泡**：先「标题 + 地址」，再「评价」。评价为空时只有 1 个。

`linkStyle`：`'url'`（默认）| `'bv'` | `'none'`。拼错了回退 `'url'`。

### `planDueAt(count, { nowMs, minDelayMin, maxDelayMin, gapMin, rand }) → number[]`

给 `count` 条排推送时刻（毫秒时间戳），**严格递增**，全部落在 `[minDelayMin, maxDelayMin]` 分钟内。

### `fetchCover(bv, { timeoutMs }) → { bytes, url } | null`

B 站公开接口拿封面，不需要登录。**拿不到返回 `null`** —— 封面是锦上添花。

### `reportStamp(text) → string`

12 位指纹，用来判断「同一天的报告被追加过」（同一天可能刷好几轮）。

---

## 3. 四条不变量（每条都有血）

### ① 只认段首标题里的 BV，不从正文捞

上游写「这一轮一条都没挑出来」时，正文常有个**候选列表**。
从正文捞 BV，会把候选当成真视频排进队列，推给用户一条没有观感的空壳。

**空报告就该是 0 条。宁可少推。**

### ② 标题和地址之间必须是空行（`\n\n`）

微信的 bot 文字气泡会把**单个换行吞成空格**。
写成 `标题\n地址` 会收到一行挤在一起的字；写成 `标题\n\n地址` 才是两行。

### ③ 一条消息不要超过 2000 字符，而且**一次连发别超过 4 条**

- 超长会被渠道截断；自己截断（`maxChars`）比被截断安全。
- 实测：连发第 5 条起会被拒（`-2 prepare failed`），要等一段时间才能再发。
  **所以设计成「一次只发一条、散在几个小时里」，不要一口气把一天的日报全推出去。**

### ④ 发送失败**不要丢**

失败要留在队列里，退避后再试；`-14` 是 token 过期（得重新登录），`-2` 是被限流。

丢掉一次 = 当天少一条；而且你不会知道它丢了。

**推论：先记账再出队。** 发成功 → 写「已发」→ 出队；这个顺序反了就会重复推。

---

## 4. 常见失败模式

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 报告解析出 0 条 | 上游改了模板（比如 `###BV…` 没空格、或 `####`） | 解析器已放宽到 `#{2,6}` + 可选空格；仍为 0 就打个日志，别静默 |
| 标题里出现 `《《…》》` | 标题从正文抓时把书名号也带上了 | 见不变量①；标题只取 `《》` 里的内容 |
| 消息发出去了但没显示 | 渠道 `message_state` 用了 `GENERATING(1)` | 必须用 `FINISH(2)` |
| 调用返回成功，但消息没到 | 服务器把错误码放在 `errcode`，只检查 `ret` 会静默失败 | 两个字段都要看：`const code = json?.errcode ?? json?.ret` |
| 明明刚登录，却报 `-14 session timeout` | **缺 iLink 专用请求头**，不是 token 过期 | 五个头都要带：`iLink-App-Id: bot`、`iLink-App-ClientVersion: 1`、`SKRouteTag: 1001`、`X-WECHAT-UIN: base64(uint32)`、`AuthorizationType: ilink_bot_token`。先补头，别急着重新扫码 |
| 发图失败 | 消息里的 `aes_key` 写成了 base64(密钥) | 必须是 **base64(密钥的 hex 文本)** |
| 机器人发不出话 | 没有 `context_token` | 只能等对方先发一条消息；机器人**不能主动建会话** |

---

## 5. 怎么算接对了

跑这三件事，全过再接真渠道：

```bash
node examples/console.mjs      # 应该打印出 2 条视频、每条 2 个气泡、时间递增
node test/report.test.mjs      # 18 个用例全绿
```

然后自己确认：

- [ ] 空报告 → 0 条，没有从候选列表里凑数
- [ ] 一条视频出来是**两个气泡**，不是一整段
- [ ] 连发 3 条以上不会被渠道拒（如果被拒，说明你的间隔太小）
- [ ] 拔网线 / 让渠道报错一次 → 那条**还在队列里**，没有消失

---

## 6. 别做这些事

- **别改 `parseReport` 的语义去「多推一点」。** 少推一条的代价远小于推一条垃圾。
- **别把 `context_token`、`bili_credential.json`、cookie 提交进仓库。** 全部走环境变量。
- **别在报告读到就立刻全发。** 人不会一次给你甩 10 个视频。
- **别为了「更完整」把中性理由替换掉口语那一句。** 口语那句才是人味所在。

---

## 7. 目录

```
report.mjs              全部纯函数，无依赖
sample/2026-10-19.md    一份样张（跑 examples 用）
examples/console.mjs    最小可运行示例
examples/ilink.mjs      微信 iLink 骨架（需自己的 token）
test/report.test.mjs    可执行的规格说明
```
