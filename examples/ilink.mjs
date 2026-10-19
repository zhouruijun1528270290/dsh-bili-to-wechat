// 微信（iLink 官方机器人通道）参考实现 —— 不是一个能直接跑的成品，
// 而是一份「你的渠道大概长什么样」的骨架：拿 token、发文本、发图片、失败别丢。
//
// 运行前你需要三样东西（都在你自己的 bot 状态里，别提交进仓库）：
//   1. baseUrl —— 一般就是 https://ilinkai.weixin.qq.com
//   2. token   —— 扫码登录机器人后拿到的长期 token
//   3. contextToken —— ⚠️ 只能来自「对方发来的一条消息」。机器人**不能主动建会话**：
//                      没有这个 token 就发不出去。所以要等对方先说一句话。
//
//   node examples/ilink.mjs --dry      # 只打印，不真发
//
// 想跑真的：把下面的 TOKEN / CONTEXT_TOKEN / TO_USER_ID 从环境变量带进来。

import { pathToFileURL } from 'node:url'

const BASE = process.env.ILINK_BASE_URL || 'https://ilinkai.weixin.qq.com'
const TOKEN = process.env.ILINK_TOKEN || ''
const CONTEXT_TOKEN = process.env.ILINK_CONTEXT_TOKEN || ''
const TO_USER_ID = process.env.ILINK_TO_USER || ''
const DRY = process.argv.includes('--dry')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * ⚠️ 这套请求头是**必须**的，少一个就发不出去 —— 而且报错信息会误导你：
 *
 *   {"errcode":-14,"errmsg":"session timeout"}
 *
 * `-14` 看着像「token 过期了，去重新扫码吧」，其实**多数情况是缺请求头**。
 * 实测：同一 token、同一 payload，只补上这几个头，就从 -14 变成正常返回 message_id。
 *
 *   iLink-App-Id            'bot'
 *   iLink-App-ClientVersion '1'
 *   SKRouteTag              '1001'
 *   X-WECHAT-UIN            base64(uint32 十进制字符串)，每次随机
 *   AuthorizationType       'ilink_bot_token'
 *   Authorization           'Bearer <token>'
 *
 * 先按 -14 去重新登录，会白扫一次码、还可能把机器人换成新实例。先用这套头排除。
 */
function headers() {
  const uin = Buffer.from(String(Math.floor(Math.random() * 0xffffffff) >>> 0), 'utf8').toString('base64')
  const h = {
    'content-type': 'application/json',
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': '1',
    SKRouteTag: '1001',
    'X-WECHAT-UIN': uin,
  }
  if (TOKEN) {
    h.AuthorizationType = 'ilink_bot_token'
    h.Authorization = `Bearer ${TOKEN}`
  }
  return h
}

/**
 * 发一条文本。返回响应体（里面有 message_id）。
 *
 * ⚠️ 三条实测出来的硬规矩：
 *   1. 单条别超过 2000 字符（渠道会截），宁可自己切
 *   2. 一次连发**别超过 4 条** —— 第 5 条起会被拒：`-2 prepare failed`
 *   3. 内容里**单个换行会被吞成空格**，要换行就空一行（`\n\n`）
 */
export async function sendText(text, { contextToken = CONTEXT_TOKEN, toUserId = TO_USER_ID } = {}) {
  const body = {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: `bili-notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message_type: 2,          // 2 = BOT
      message_state: 2,         // 2 = FINISH（1=GENERATING 在普通会话里不渲染）
      item_list: [{ type: 1, text_item: { text } }],
      context_token: contextToken,
    },
    base_info: { channel_version: '1.0.0' },
  }
  if (DRY) return { dry: true, body }

  const r = await fetch(`${BASE}/ilink/bot/sendmessage`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  // ⚠️ 这个服务器把错误码放在 errcode 里，只有少数接口用 ret —— 两个都要看。
  //    只看 ret 的后果：errcode=-14 时 ret 是 undefined，会被当成成功，静默丢消息。
  const code = json?.errcode ?? json?.ret
  if (r.status !== 200 || (code !== undefined && code !== 0)) {
    // ⚠️ 常见错误码：-14 = token 过期（要重新登录）；-2 = 被限流，过一会儿再试
    throw new Error(`sendmessage 失败：HTTP ${r.status} code=${code} ${json?.errmsg ?? ''}`)
  }
  return json
}

/**
 * 发一张图片：三步 —— 要上传地址 → 传加密字节 → 发消息。
 *
 * `aes_key` 在消息里必须是 **base64(密钥的 hex 文本)**，不是 base64(密钥本身)。
 * 加密是 AES-128-ECB，填充到 `ceil((len+1)/16)*16`。
 */
export async function sendImage(bytes, { contextToken = CONTEXT_TOKEN, toUserId = TO_USER_ID } = {}) {
  const { createCipheriv, randomBytes, createHash } = await import('node:crypto')
  const aesKey = randomBytes(16)
  const padded = Math.ceil((bytes.length + 1) / 16) * 16
  const cipher = createCipheriv('aes-128-ecb', aesKey, null)
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()])

  if (DRY) return { dry: true, bytes: bytes.length, ciphertext: ciphertext.length }

  const auth = headers()
  const up = await fetch(`${BASE}/ilink/bot/getuploadurl`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      filekey: createHash('md5').update(bytes).digest('hex'),
      media_type: 1,                        // 1=IMAGE 2=VIDEO 3=FILE 4=VOICE
      to_user_id: toUserId,
      rawsize: bytes.length,
      rawfilemd5: createHash('md5').update(bytes).digest('hex'),
      filesize: padded,
      no_need_thumb: true,
      aeskey: aesKey.toString('hex'),
      base_info: { channel_version: '1.0.0' },
    }),
  }).then((r) => r.json())
  if (!up?.upload_full_url && !up?.upload_param) throw new Error(`getuploadurl 失败：${JSON.stringify(up)}`)

  const put = await fetch(up.upload_full_url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(ciphertext.length) },
    body: ciphertext,
    redirect: 'error',
  })
  const param = put.headers.get('x-encrypted-param')
  if (!param) throw new Error(`上传没拿到 x-encrypted-param（HTTP ${put.status}）`)

  const json = await fetch(`${BASE}/ilink/bot/sendmessage`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: `bili-notify-img-${Date.now()}`,
        message_type: 2,
        message_state: 2,
        item_list: [{
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: param,
              aes_key: Buffer.from(aesKey.toString('hex')).toString('base64'),
              encrypt_type: 1,
            },
            mid_size: ciphertext.length,
          },
        }],
        context_token: contextToken,
      },
      base_info: { channel_version: '1.0.0' },
    }),
  }).then((r) => r.json())
  const code = json?.errcode ?? json?.ret
  if (code !== undefined && code !== 0) {
    throw new Error(`sendmessage(图片) 失败：code=${code} ${json?.errmsg ?? ''}`)
  }
  return json
}

// ── 骨架：一个「到点就发一条」的循环。真实实现要把它接到你的常驻进程里。 ──
let queue = []        // [{ dueAt, bubbles: string[], tries: 0 }]

export async function tick() {
  const now = Date.now()
  const i = queue.findIndex((q) => Number(q.dueAt ?? 0) <= now)
  if (i < 0) return 0
  const job = queue[i]
  try {
    for (const [k, bubble] of job.bubbles.entries()) {
      await sendText(bubble)
      // ⚠️ 两个气泡之间留点间隔，否则客户端可能只显示一条
      if (k < job.bubbles.length - 1) await sleep(3000)
    }
    queue.splice(i, 1)
    return 1
  } catch (err) {
    // ⚠️ 失败**不要丢**：留在队列里，退避后再试。丢了就等于当天少推一条。
    job.tries = (job.tries ?? 0) + 1
    const backoffMin = /-14/.test(String(err?.message)) ? 60 : Math.min(30, 2 ** job.tries)
    job.dueAt = Date.now() + backoffMin * 60 * 1000
    throw err
  }
}

// 直接跑这个文件时打一段自检（Windows 上 `file://` + 盘符只有一个斜杠，别手拼 URL）
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  console.log('这是一个参考实现，不是成品。')
  console.log(`DRY=${DRY}  BASE=${BASE}`)
  console.log(TOKEN ? '已读到 ILINK_TOKEN' : '缺 ILINK_TOKEN（真实发送需要）')
  console.log(CONTEXT_TOKEN ? '已读到 ILINK_CONTEXT_TOKEN' : '缺 ILINK_CONTEXT_TOKEN（⚠️ 只能来自对方发来的一条消息）')
}
