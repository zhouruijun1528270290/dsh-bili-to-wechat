// 三十秒跑通的假渠道：不需要任何账号，只把「该发什么」打印出来。
//
//   node examples/console.mjs
//
// 这就是你要接的全部接口：拿到一个字符串数组（气泡），按顺序发出去。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseReport, itemToMessages, planDueAt } from '../report.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'sample', '2026-10-19.md')
const md = readFileSync(file, 'utf8')

const report = parseReport(md, { filename: '2026-10-19.md' })
console.log(`报告：${report.title}  日期 ${report.date}  共 ${report.items.length} 条\n`)

const now = Date.now()
const due = planDueAt(report.items.length, { nowMs: now, minDelayMin: 15, maxDelayMin: 240, gapMin: 20 })

report.items.forEach((item, i) => {
  const when = new Date(due[i]).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  console.log(`── 第 ${i + 1} 条 · 计划 ${when} 发 ──`)
  for (const bubble of itemToMessages(item, { linkStyle: 'url' })) {
    console.log(`[气泡] ${JSON.stringify(bubble)}`)
  }
  console.log('')
})

console.log('真实渠道要做的就是：到点了，把上面那些气泡按顺序发出去。')
