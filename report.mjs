// 把「B站日报」这份 Markdown 变成能直接推送的东西。
//
// 上游（比如 dsh-bili-scroll）只做一件事：把当天挑出的视频写成 `out\<日期>.md`，
// 每条的段首固定是 `### BV号`。它不负责推送，也不认识任何聊天平台。
//
// 这个文件是**纯函数**：不读环境、不写文件、不发网络（只有 fetchCover 例外，而且失败就返回 null）。
// 你要接的渠道（微信 / Telegram / 邮件 / 控制台）自己写，几十行就够 —— 见 examples/。
//
// 解析要宽：上游的报告模板以后可能改，字段缺了要退化成「至少把链接发出去」，
// 而不是整份报告都推不出去。

import { createHash } from 'node:crypto'

/** 一条 B 站视频的链接。 */
export function bvLink(bv) {
  return `https://www.bilibili.com/video/${bv}`
}

/** 从任意文本里抠出所有 BV 号（去重、保持出现顺序）。 */
export function extractBvs(text) {
  const out = []
  const seen = new Set()
  const re = /BV[0-9A-Za-z]{10}/g
  let m
  while ((m = re.exec(String(text ?? ''))) !== null) {
    if (seen.has(m[0])) continue
    seen.add(m[0])
    out.push(m[0])
  }
  return out
}

/** 去掉 markdown 装饰，留给人看的纯文本。 */
function clean(line) {
  return String(line ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/\s+$/, '')
    .trim()
}

/** 抓 `键：值` 这种字段。keys 是若干可能的写法。 */
function field(lines, keys) {
  const re = new RegExp(`^\\s*(?:[-*+]\\s*)?(?:\\*\\*)?(?:${keys.join('|')})(?:\\*\\*)?\\s*[:：]\\s*(.+)$`)
  for (const line of lines) {
    const m = re.exec(line)
    if (m) {
      const v = clean(m[1])
      if (v) return v
    }
  }
  return ''
}

/** UP 那一行常写成 `某人 · 6:54 · 播放 3313 · 评论 178` —— 只留第一段，别把统计塞进标题行。 */
function shortUp(value) {
  const v = String(value ?? '').split(/[·|｜]/)[0].trim()
  return v.replace(/[\s,，]+$/, '')
}

/** 时长优先从专门的字段里抓，退而求其次抓段内第一个 mm:ss。 */
function durationOf(lines) {
  const named = field(lines, ['时长', '长度', '播放时长'])
  if (named) return clean(named)
  for (const line of lines) {
    const m = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(line)
    if (m) return m[1]
  }
  return ''
}

/** 引用块（`> …`）里那一句，或正文里「」包着的那一句。 */
function snippetOf(lines) {
  for (const line of lines) {
    if (/^\s*>/.test(line)) {
      const v = clean(line)
      if (v) return v
    }
  }
  // 「」只从正文抓：标题里本来就可能带引号，从整段抓会把标题当成观感
  for (const line of lines) {
    if (/^#{1,6}\s*/.test(line)) continue
    const m = /「([^」]{2,80})」/.exec(line)
    if (m) return m[1].trim()
  }
  return ''
}

/** 口语化的那一句（正文给人看的就是它）；没有才退到中性的「为什么值得」。 */
function reasonOf(lines) {
  const voiced = field(lines, ['我的一句', '我的一句点评', '我的一句话', '我的看法', '我的感觉', '一句话点评'])
  if (voiced) return voiced
  const named = field(lines, ['为什么值得', '值得看的原因', '理由', '推荐理由'])
  if (named) return named
  for (const line of lines) {
    if (/^\s*[-*+]\s+/.test(line)) {
      const v = clean(line)
      if (!v) continue
      if (/^BV[0-9A-Za-z]{10}$/.test(v)) continue
      if (/https?:\/\//.test(v) || /bilibili\.com/i.test(v) || /BV[0-9A-Za-z]{10}/.test(v)) continue
      if (/^\[[^\]]*\]\([^)]*\)$/.test(v)) continue       // 纯 markdown 链接
      return v
    }
  }
  return ''
}

/** 标题：段首标题里的《…》优先 > `标题：…` > 段首标题去掉 BV 后剩下的 > 段内第一行正文。 */
function titleOf(heading, bv, lines) {
  const inBracket = /《([^》]{1,120})》/.exec(heading)
  if (inBracket) return inBracket[1].trim()

  const named = field(lines, ['标题', '视频标题', '名字'])
  if (named) return named

  const rest = clean(heading).replace(bv, '').replace(/^[\s·—\-–|,，:：]+/, '').replace(/[\s·—\-–|,，:：]+$/, '')
  if (rest) return rest

  // 上游更常见的写法是标题在**正文第一行**：`《标题》 · UP · 08:02`。
  // 只从段首标题抓《》会漏掉这种，退化成「整行当标题」，最后拼出 `《《标题》 · UP · 08:02》`。
  // 顺序要紧：段首能给出标题时绝不让正文里的《》劫持，所以放在 rest 之后。
  // 只认**以书名号开头**的正文行（`《标题》 · UP · 08:02`）。
  // 不能见到《》就抓：`为什么值得：推荐《别的视频》这期` 里的书名号是观感里提到的另一个视频。
  for (const line of lines) {
    const v = clean(line)
    if (!v.startsWith('《')) continue
    const inBody = /《([^》]{1,120})》/.exec(v)
    if (inBody) return inBody[1].trim()
  }

  for (const line of lines) {
    const v = clean(line)
    if (!v) continue
    if (/^BV[0-9A-Za-z]{10}$/.test(v)) continue
    if (/^(?:https?:\/\/)/.test(v)) continue
    if (/^(?:标题|UP主|up主|UP|作者|时长|长度|为什么值得|理由|推荐理由)\s*[:：]/.test(v)) continue
    return v
  }
  return ''
}

/**
 * 解析一份日报。
 *
 * @param {string} md 报告正文
 * @param {{ filename?: string }} [opts] 传文件名时可以从里面取日期（`2026-10-19.md`）
 * @returns {{ title: string, date: string, intro: string, items: Array<{ bv: string, title: string, up: string, duration: string, reason: string, snippet: string, link: string }> }}
 */
export function parseReport(md, { filename = '' } = {}) {
  const text = String(md ?? '').replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)

  let date = ''
  const fromName = /(\d{4}-\d{2}-\d{2})/.exec(filename)
  if (fromName) date = fromName[1]
  if (!date) {
    for (const line of lines) {
      if (!/^#\s/.test(line)) continue
      const m = /(\d{4}-\d{2}-\d{2})/.exec(line)
      if (m) { date = m[1]; break }
    }
  }

  let title = ''
  for (const line of lines) {
    if (/^#\s/.test(line)) { title = clean(line.replace(/^#\s+/, '')); break }
  }

  const items = []
  const seen = new Set()
  let current = null
  const flush = () => {
    if (!current) return
    // ⚠️ 只认标题里的 BV，**不从正文捞**。
    //    上游写「这轮一条都没挑出来」时，正文常有一个「候选」列表；
    //    从正文捞 BV 会把候选当成真视频排进队列，推给用户一条没有观感的东西。
    //    空报告就该是 0 条 —— 宁可少推。
    const bv = extractBvs(current.heading)[0]
    if (!bv || seen.has(bv)) { current = null; return }
    seen.add(bv)
    items.push({
      bv,
      title: titleOf(current.heading, bv, current.body),
      up: shortUp(field(current.body, ['UP主', 'up主', 'UP', '作者', 'up'])),
      duration: durationOf(current.body),
      reason: reasonOf(current.body),
      snippet: snippetOf(current.body),
      link: bvLink(bv),
    })
    current = null
  }

  for (const line of lines) {
    // 放宽到 2~6 个 #，且 `###BV…`（没有空格）也认 —— 上游模板一改就整链路静默失效，这个坑踩过
    const m = /^#{2,6}\s*(.*)$/.exec(line)
    if (m) {
      flush()
      current = { heading: m[1], body: [] }
    } else if (current) {
      current.body.push(line)
    }
  }
  flush()

  const intro = lines
    .filter((l) => !/^#{1,6}\s*/.test(l))
    .map(clean)
    .filter(Boolean)[0] ?? ''

  return { title, date, intro, items }
}

/**
 * 单条视频 → **两个气泡**：先发「标题 + 地址」，再发「评价」。
 *
 * 理由：真人推视频就是这么干的 —— 先把东西甩过来（标题、链接），再补一句自己的话。
 * 评价为空时只返回一个气泡（只有标题+地址），不要把空字符串也发出去。
 *
 * @param {object} item parseReport 的 items 里的一条
 * @param {{ linkStyle?: 'url'|'bv'|'none', maxChars?: number }} [opts]
 * @returns {string[]} 1~2 个气泡
 */
export function itemToMessages(item, { linkStyle = 'url', maxChars = 1800 } = {}) {
  if (!item) return []
  const meta = [item.duration, item.up].filter(Boolean).join(' · ')
  const head = `《${item.title || item.bv}》${meta ? ` ${meta}` : ''}`
  const style = linkStyle === 'bv' || linkStyle === 'none' ? linkStyle : 'url'   // 拼错就回退 url，别静默丢地址
  const addr = style === 'url'
    ? `地址：${item.link || bvLink(item.bv)}`
    : (style === 'bv' ? `地址：BV 号 ${item.bv}` : '')
  // ⚠️ 标题和地址之间必须是空行：微信的 bot 文字气泡会把**单个换行**吞成空格
  const first = addr ? `${head}\n\n${addr}` : head
  let words = `${item.reason || item.snippet || ''}`.trim()
  if (!words) return [first]
  // 一条消息要能一次发出去：超长会被渠道切片，切片中途失败重试就会重复 —— 先截断
  const budget = Math.max(40, Number(maxChars) || 1800)
  if (words.length > budget) words = `${words.slice(0, Math.max(0, budget - 1))}…`
  return [first, words]
}

/**
 * 给一批待推的条目排「什么时候发」。
 *
 * 每条在 `[minDelayMin, maxDelayMin]` 分钟内随机挑一个点，保持先后顺序、彼此至少隔 `gapMin` 分钟 ——
 * 一次只发一条，散在整个空闲时段里，像人想起来才发。
 *
 * ⚠️ 上下界都要守住：第 i 条的上限要给后面 n-1-i 条留出 gap，
 *    否则 gap 会累积、滚过 maxDelayMin（甚至滚到次日凌晨）。
 *
 * @param {number} count 条目数
 * @param {{ nowMs?: number, minDelayMin?: number, maxDelayMin?: number, gapMin?: number, rand?: () => number }} [opts]
 * @returns {number[]} 每条应当推送的时刻（毫秒时间戳），严格递增
 */
export function planDueAt(count, {
  nowMs = Date.now(), minDelayMin = 15, maxDelayMin = 240, gapMin = 20, rand = Math.random,
} = {}) {
  const n = Math.max(0, Number(count) || 0)
  const out = []
  if (!n) return out
  const lo = Math.max(0, Number(minDelayMin) || 0)
  const gap = Math.max(0, Number(gapMin) || 0)
  const maxMin = Math.max(lo, Number(maxDelayMin) || 0)
  // 条目太多、窗口太窄时把 gap 压到刚好塞得下 —— 宁可挨近一点，也不能滚过上限（滚过去就是凌晨发）
  const gapEff = n > 1 ? Math.min(gap, (maxMin - lo) / (n - 1)) : 0
  let prev = 0
  for (let i = 0; i < n; i += 1) {
    const floor = i === 0 ? lo : Math.max(lo, prev + gapEff)
    const ceil = Math.max(floor, maxMin - (n - 1 - i) * gapEff)
    const delay = Math.round(floor + rand() * (ceil - floor))
    out.push(nowMs + delay * 60 * 1000)
    prev = delay
  }
  return out
}

/**
 * 报告文件的指纹，用来判断「同一天的报告被改过了」（同一天可能追加多轮）。
 * @returns {string} 12 位十六进制
 */
export function reportStamp(text) {
  return createHash('sha1').update(String(text ?? '')).digest('hex').slice(0, 12)
}

/**
 * 抓一张封面图（B 站公开的 view 接口，不需要登录）。
 *
 * 拿不到就返回 null —— 封面是锦上添花，绝不能因为它失败就不推日报。
 *
 * @param {string} bv
 * @returns {Promise<{ bytes: Buffer, url: string } | null>}
 */
export async function fetchCover(bv, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return null
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    referer: bvLink(bv),
  }
  try {
    const r = await fetchImpl(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bv)}`, {
      headers,
      signal: ac.signal,
    })
    if (r.status !== 200) return null
    const j = await r.json()
    if (j?.code !== 0 || !j?.data?.pic) return null
    const pic = String(j.data.pic)
    if (!/^https?:\/\//.test(pic)) return null
    const img = await fetchImpl(pic, { headers, signal: ac.signal })
    if (img.status !== 200) return null
    const bytes = Buffer.from(await img.arrayBuffer())
    if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) return null
    return { bytes, url: pic }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
