# dsh-bili-to-wechat

把 [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll) 写出来的日报，**一条一条推到你常用的聊天软件里**。

刷 B 站找视频那部分我不做，我只做后半截：解析报告、排时间、把一条视频拆成「标题+地址」和「我的一句话」两个气泡发出去。

```bash
node examples/console.mjs     # 不需要任何账号，直接看输出
node test/report.test.mjs     # 18 个用例
```

## 为什么不用「一口气推完」

真人不会把一天的日报一次甩给你。实测连发第 5 条起渠道就开始拒（`-2 prepare failed`），
所以这里的默认姿势是：**一条一条来，间隔十几分钟到几小时，散在空闲时段里。**

## 里面有什么

```
report.mjs              纯函数：解析 / 排版 / 排时间 / 拿封面
sample/2026-10-19.md    样张
examples/console.mjs    最小示例（打印到控制台）
examples/ilink.mjs      微信 iLink 官方机器人通道的骨架
test/report.test.mjs    可执行的规格说明
AGENTS.md               给 AI 的接入说明（接口契约 + 四条不变量）
```

## 接自己的渠道

```js
import { parseReport, itemToMessages, planDueAt } from './report.mjs'

const { items } = parseReport(md, { filename: '2026-10-19.md' })
const due = planDueAt(items.length)          // 现在起 15~240 分钟内散开

items.forEach((item, i) => {
  queue.push({ dueAt: due[i], bubbles: itemToMessages(item) })
})
// 到点了：bubbles 逐个发出去，发送失败就留在队列里退避重试
```

`AGENTS.md` 里的四条不变量是踩出来的，接之前值得读一遍 —— 尤其是「标题和地址之间要用空行」和「失败不要丢」。

## 如果接在会聊天的机器人上

推送是**旁路**发的，不经过对话会话 —— 所以机器人不记得自己发过什么，也不知道现在几点。
对方回一句「你发的那个视频讲的啥」，它会一脸茫然，人设当场崩。

`AGENTS.md` 第 7 节写了怎么补：推成功就记一条，下一条消息前注入一次（用完清零）；外加一行时间头。
两小段文本，不碰这里的任何函数。

## 反过来的情况：对方甩一个链接给你

他发个 B 站链接（或者 `b23.tv` 短链）过来问「这个你看过吗」——
机器人这时候是瞎的，要么装懂编内容，要么反问「你想让我看什么」，两种都露馅。

`AGENTS.md` 第 8 节写了怎么接：认出 BV 或短链 → 取标题、简介、热评 → 拼成一段话，
**并且明确告诉它「你没看过画面」**。那段话里真正起作用的不是数据，是这句约束。

⚠️ 这一节会让仓库**开始出网**（解短链 + 调 B 站 API），和上面「只有纯函数」的定位冲突。
只做推送的话，跳过它就行。

## 许可

MIT。见 `LICENSE`。上游 `dsh-bili-scroll` 同样是 MIT，作者 [c1overzz](https://github.com/c1overzz)。

本项目与 B 站、DeepSeek 官方均无关，只是把别人写好的报告转发出去。
