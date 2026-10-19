# dsh-bili-notify

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

## 许可

MIT。见 `LICENSE`。上游 `dsh-bili-scroll` 同样是 MIT，作者 [c1overzz](https://github.com/c1overzz)。

本项目与 B 站、DeepSeek 官方均无关，只是把别人写好的报告转发出去。
