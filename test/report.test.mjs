// 可执行的规格说明 —— AI 读这个文件就知道该怎么接、什么不能破坏。
//
//   node --test
//
// 每条测试都在描述一个「真实踩过」的约束，不是凑数的。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  parseReport, itemToMessages, planDueAt, extractBvs, reportStamp, bvLink,
} from '../report.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sample = readFileSync(join(here, '..', 'sample', '2026-10-19.md'), 'utf8')

test('解析：只认 ### 段首的 BV，正文里的 BV 不算一条视频', () => {
  const r = parseReport(sample, { filename: '2026-10-19.md' })
  assert.equal(r.items.length, 2)
  assert.deepEqual(r.items.map((x) => x.bv), ['BV1GJ411x7h7', 'BV1xx411c7mD'])
  // 样张里「没挑中的」那一节提到了 BV1yy411c7mE —— 它必须**不**成为条目
  assert.ok(!r.items.some((x) => x.bv === 'BV1yy411c7mE'))
})

test('解析：日期从文件名或一级标题取', () => {
  assert.equal(parseReport(sample, { filename: '2026-10-19.md' }).date, '2026-10-19')
  assert.equal(parseReport('# 刷B站 · 2026-10-19\n\nx\n').date, '2026-10-19')
})

test('解析：口语化的「我的一句」优先于中性的「为什么值得」', () => {
  const r = parseReport(sample)
  assert.match(r.items[0].reason, /值得看的不是游戏/)
  assert.doesNotMatch(r.items[0].reason, /取舍比成品本身/)
})

test('解析：UP 只留第一段，别把播放量塞进标题行', () => {
  const md = '### BV1GJ411x7h7\n\n《标题》\n\n**UP主**：某人 · 6:54 · 播放 3313 · 评论 178\n'
  assert.equal(parseReport(md).items[0].up, '某人')
})

test('解析：标题取《…》，时长取 mm:ss', () => {
  const md = '### BV1GJ411x7h7\n\n《一碗白米饭》 · 干饭频道 · 08:02\n'
  const it = parseReport(md).items[0]
  assert.equal(it.title, '一碗白米饭')
  assert.equal(it.duration, '08:02')
})

test('解析：`###BV号`（不带空格）也要认 —— 模板一改就整链路静默失效', () => {
  const r = parseReport('###BV1GJ411x7h7\n\n《标题》\n')
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].bv, 'BV1GJ411x7h7')
})

test('解析：空报告是 0 条，不是「从候选里凑一条」', () => {
  const md = '# 刷B站 · 2026-10-19\n\n这一轮挑中 0 条。\n\n候选：BV1GJ411x7h7、BV1xx411c7mD\n'
  assert.equal(parseReport(md).items.length, 0)
})

test('解析：BOM 和 CRLF 不该让整份报告解析失败', () => {
  const md = '\uFEFF# 刷B站 · 2026-10-19\r\n\r\n### BV1GJ411x7h7\r\n\r\n《标题》\r\n'
  const r = parseReport(md)
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].title, '标题')
})

test('排版：一条视频两个气泡 —— 先说标题和地址，再说评价', () => {
  const item = { bv: 'BV1GJ411x7h7', title: '标题', duration: '2:38', up: '追梦者', reason: '这句是我的话', link: bvLink('BV1GJ411x7h7') }
  const b = itemToMessages(item)
  assert.equal(b.length, 2)
  assert.match(b[0], /《标题》 2:38 · 追梦者/)
  assert.match(b[0], /地址：https:\/\/www\.bilibili\.com\/video\/BV1GJ411x7h7/)
  assert.equal(b[1], '这句是我的话')
})

test('排版：标题和地址之间用空行，单个换行会被渠道吞成空格', () => {
  const b = itemToMessages({ bv: 'BV1GJ411x7h7', title: 'T' })
  assert.ok(b[0].includes('\n\n地址：'), '必须是空行分隔')
  assert.ok(!/[^\n]\n[^\n]/.test(b[0]), '除了那一个空行，不该出现单换行')
})

test('排版：没有评价就只发一个气泡，不要发空字符串', () => {
  const b = itemToMessages({ bv: 'BV1GJ411x7h7', title: 'T' })
  assert.equal(b.length, 1)
  assert.ok(!b.some((x) => x.trim() === ''))
})

test('排版：linkStyle 拼错要回退成 url，不能静默把地址弄丢', () => {
  const item = { bv: 'BV1GJ411x7h7', title: 'T' }
  assert.match(itemToMessages(item, { linkStyle: 'urls' })[0], /地址：https/)
  assert.match(itemToMessages(item, { linkStyle: 'bv' })[0], /地址：BV 号 BV1GJ411x7h7/)
  assert.doesNotMatch(itemToMessages(item, { linkStyle: 'none' })[0], /地址/)
})

test('排版：超长评价被截断，保证一条消息能一次发出去', () => {
  const b = itemToMessages({ bv: 'BV1GJ411x7h7', title: 'T', reason: '长'.repeat(200) }, { maxChars: 60 })
  assert.ok(b[1].length <= 61)
  assert.ok(b[1].endsWith('…'))
})

test('排期：条数、顺序、上下界都守住', () => {
  const now = 1_700_000_000_000
  const due = planDueAt(4, { nowMs: now, minDelayMin: 15, maxDelayMin: 240, gapMin: 20, rand: () => 0 })
  assert.equal(due.length, 4)
  for (let i = 1; i < due.length; i += 1) assert.ok(due[i] > due[i - 1], '必须严格递增')
  const mins = due.map((t) => (t - now) / 60000)
  assert.ok(mins[0] >= 15, '第一条不能早于 minDelayMin')
  assert.ok(Math.max(...mins) <= 240, '任何一条都不能晚于 maxDelayMin')
})

test('排期：窗口太窄时压 gap，但绝不滚过上限（滚过去就是凌晨发）', () => {
  const now = 1_700_000_000_000
  const due = planDueAt(6, { nowMs: now, minDelayMin: 10, maxDelayMin: 30, gapMin: 20, rand: () => 0.999 })
  const mins = due.map((t) => (t - now) / 60000)
  assert.ok(Math.max(...mins) <= 30)
  for (let i = 1; i < mins.length; i += 1) assert.ok(mins[i] >= mins[i - 1])
})

test('排期：0 条返回空数组', () => {
  assert.deepEqual(planDueAt(0), [])
})

test('指纹：稳定、12 位，改一个字就变', () => {
  const a = reportStamp(sample)
  assert.equal(a, reportStamp(sample))
  assert.equal(a.length, 12)
  assert.notEqual(a, reportStamp(sample + ' '))
})

test('抠 BV：去重且保持出现顺序', () => {
  assert.deepEqual(extractBvs('BV1GJ411x7h7 和 BV1xx411c7mD 还有 BV1GJ411x7h7'), ['BV1GJ411x7h7', 'BV1xx411c7mD'])
})
