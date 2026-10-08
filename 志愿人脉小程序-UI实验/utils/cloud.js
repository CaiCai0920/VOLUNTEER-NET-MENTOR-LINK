/**
 * 云端客户端（唯一初始化点）
 * ------------------------------------------------------------------
 * 所有页面 / 数据层统一从这里拿 cloud 实例：
 *   - endpoint / publishableKey 来自 WorkBuddy 云服务的 publicConfig（开通时下发）
 *   - wx 注入诊断包装：云端请求失败时会在调试面板打印方法 / URL / 状态码
 * 不要在别处重复 createMiniProgramWorkBuddyCloud，也不要手写 wx.request 访问云端。
 * （唯一例外是下面的 uploadBinary —— 见该函数注释。）
 */

const publicConfig = {
  resourceId: 'wbcs_vdFuvJVArH5a7OxQuPECUs',
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_Tfw8sbHq6elhJWIxT3JMu7_3GN3Mc6Ynbz3NKn2q6Ozw90XCyQuVR6s',
  // 小程序 appid：signInWithWechat 登录必须与当前账号一致（试用/正式是两套小程序）
  appId: 'wx72e9e3f4cc3c11c8'
}

const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

const diagnosticWx = createDiagnosticWx(wx)

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: diagnosticWx
})

/**
 * 二进制直传（ArrayBuffer -> 云存储）
 * ------------------------------------------------------------------
 * 为什么不用 SDK 的 cloud.storage.upload：
 *   SDK 的小程序 fetch 适配器（createMiniProgramFetch）只接受字符串 body，
 *   传 ArrayBuffer 会抛「暂不支持非字符串 body（ArrayBuffer/FormData 待补）」。
 *   之前试过改写 cloud.storage 上的 fetch 做旁路，但 cloud.storage 是
 *   WorkBuddyStorageBucket 包装类实例：它的 upload() 只做路径校验后转发给
 *   内部 fileApi，而 fileApi 的 fetch 在构造时已被自己的闭包捕获 ——
 *   改写包装类上的属性对真实调用链没有任何影响，所以补丁从未生效过。
 *
 * 因此这里直接走网关的存储端点，用 wx.request 原生 ArrayBuffer 通道：
 *   POST {endpoint}/.cloud/storage/object/runtime/{users|shared}/{owner}/{rest}
 *   header: x-wb-webapp-access-key（必带）+ Authorization（有会话则带）
 * 与 SDK createCloudFetch 的凭证注入规则完全一致（见 lib/miniprogram.js 第 81 行）。
 * 只在 SDK 官方补上二进制支持后，才能整体替换回 cloud.storage.upload。
 */

var STORAGE_PATH = '/.cloud/storage/object/runtime/'
var PUBLISHABLE_KEY_HEADER = 'x-wb-webapp-access-key'

/**
 * 上传（ArrayBuffer -> 云存储），带一次自动重试。
 * 第一次用原生二进制通道；如果网关以 4xx 拒绝（多数是它期望别的编码），
 * 自动换成 multipart/form-data 再试一次 —— 两条路都失败才把原始错误抛给上层。
 */
function uploadBinary(objectPath, arrayBuffer, options) {
  const opts = options || {}
  const contentType = opts.contentType || 'application/octet-stream'
  // 防御：readFile 忘记指定 encoding:'binary' 时会返回 utf8 字符串，
  // 直接发出去会变成损坏文件或 4xx。这里主动把字符串转回 ArrayBuffer，
  // 而不是把问题留给网关。
  const body = toBinaryBody(arrayBuffer)
  return requestBinary(objectPath, body, contentType, opts).catch(function (firstErr) {
    // 网络层错误直接抛，不值得再试（重试也是同样结果，还多等一次超时）
    if (/网络异常/.test(firstErr.message || '')) throw firstErr
    console.warn('[cloud] 二进制直传失败，改用 multipart 重试:', firstErr.message)
    return requestMultipart(objectPath, body, contentType, opts).catch(function () {
      throw firstErr
    })
  })
}

/** 把入参归一化成 ArrayBuffer：字符串按 latin1 逐字节还原，ArrayBuffer/View 直接取 buffer。 */
function toBinaryBody(input) {
  if (!input) return new ArrayBuffer(0)
  if (typeof input === 'string') {
    const out = new Uint8Array(input.length)
    for (let i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 0xff
    return out.buffer
  }
  if (input instanceof ArrayBuffer) return input
  if (input.buffer instanceof ArrayBuffer) return input.buffer
  return new ArrayBuffer(0)
}

/** 通道一：wx.request 原生 ArrayBuffer body（Content-Type 非 json/urlencoded 时原样发送）。 */
function requestBinary(objectPath, arrayBuffer, contentType, opts) {
  return getAccessTokenSafe().then(function (token) {
    const header = authHeaders(token, opts)
    header['Content-Type'] = contentType
    return new Promise(function (resolve, reject) {
      wx.request({
        url: publicConfig.endpoint + STORAGE_PATH + objectPath,
        method: 'POST',
        header: header,
        data: arrayBuffer,
        responseType: 'text',
        success(result) {
          if (isOk(result.statusCode)) {
            resolve({ path: objectPath, fullPath: objectPath })
            return
          }
          reject(new Error(storageErrorMessage(result.statusCode, result.data)))
        },
        fail(err) {
          reject(new Error('上传网络异常：' + ((err && err.errMsg) || 'unknown')))
        }
      })
    })
  })
}

/**
 * 通道二：multipart/form-data。
 * wx.request 无法直接构造 FormData，但小程序的上传域名也可用 wx.uploadFile；
 * 为保持"一次 wx.request"的简单性，这里手工拼 multipart 报文并让 wx.request
 * 带上标准 boundary —— 网关按 Content-Type 里的 boundary 解析即可。
 */
function requestMultipart(objectPath, arrayBuffer, contentType, opts) {
  const boundary = '----workbuddy' + Date.now().toString(16) + Math.random().toString(16).slice(2, 8)
  const head =
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="cacheControl"\r\n\r\n' +
    (opts.cacheControl || '3600') + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="blob"\r\n' +
    'Content-Type: ' + contentType + '\r\n\r\n'
  const tail = '\r\n--' + boundary + '--\r\n'
  const payload = concatBuffer(stringToBuffer(head), arrayBuffer, stringToBuffer(tail))
  return getAccessTokenSafe().then(function (token) {
    const header = authHeaders(token, opts)
    header['Content-Type'] = 'multipart/form-data; boundary=' + boundary
    return new Promise(function (resolve, reject) {
      wx.request({
        url: publicConfig.endpoint + STORAGE_PATH + objectPath,
        method: 'POST',
        header: header,
        data: payload,
        responseType: 'text',
        success(result) {
          if (isOk(result.statusCode)) {
            resolve({ path: objectPath, fullPath: objectPath })
            return
          }
          reject(new Error(storageErrorMessage(result.statusCode, result.data)))
        },
        fail(err) {
          reject(new Error('上传网络异常：' + ((err && err.errMsg) || 'unknown')))
        }
      })
    })
  })
}

function authHeaders(token, opts) {
  const header = {}
  header[PUBLISHABLE_KEY_HEADER] = publicConfig.publishableKey
  if (token) header.Authorization = 'Bearer ' + token
  header['cache-control'] = 'max-age=' + (opts.cacheControl || '3600')
  // 默认 upsert=true：发帖/学生证重传时覆盖同名路径，避免重试留下垃圾对象
  header['x-upsert'] = opts.upsert === false ? 'false' : 'true'
  return header
}

function isOk(status) {
  return status >= 200 && status < 300
}

function stringToBuffer(text) {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes.buffer
}

function concatBuffer(a, b, c) {
  const ua = new Uint8Array(a)
  const ub = new Uint8Array(b)
  const uc = new Uint8Array(c)
  const out = new Uint8Array(ua.length + ub.length + uc.length)
  out.set(ua, 0)
  out.set(ub, ua.length)
  out.set(uc, ua.length + ub.length)
  return out.buffer
}

/** 把网关返回的错误体整理成一句能直接判断原因的话。 */
function storageErrorMessage(status, data) {
  let payload = data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch (e) {
      payload = null
    }
  }
  const body = payload && typeof payload === 'object' ? payload : {}
  const nested = body.error && typeof body.error === 'object' ? body.error : {}
  const code = body.code || body.error || nested.code || ''
  const message = body.message || nested.message || body.error_description || ''
  const detail = [code, message].filter(Boolean).join(' ')
  if (status === 401 || status === 403) {
    return 'MISSING_CREDENTIALS 上传被拒（' + (detail || 'HTTP ' + status) + '）'
  }
  return detail || 'HTTP ' + status
}

function getAccessTokenSafe() {
  return cloud.auth
    .getAccessToken()
    .then(function (token) {
      return token || ''
    })
    .catch(function () {
      return ''
    })
}

/**
 * 云端静默登录（wx.login code -> 正式会话）
 * ------------------------------------------------------------------
 * 存储网关已收紧为强制凭证：匿名（只带 publishableKey）的文件上传会被
 * 401 MISSING_CREDENTIALS 拒绝（数据库匿名通道不受影响，读写照旧）。
 * 小程序侧用 wx.login 的 code 走 signInWithWechat 换正式会话，SDK 自动
 * 落盘（workbuddy-cloud.session.*）并自动续期；会话就绪后，数据库与
 * 二进制上传通道都会自动带上 Authorization，存储上传恢复可用。
 * 登录失败不阻塞应用（静默降级为匿名：浏览/发文字帖仍可用），下次
 * 调用会重新尝试登录。
 */
let cloudSignInPromise = null

function wxLoginCode() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success(res) {
        if (res && res.code) resolve(res.code)
        else reject(new Error('wx.login 无 code'))
      },
      fail(err) {
        reject(new Error('wx.login 失败：' + ((err && err.errMsg) || 'unknown')))
      }
    })
  })
}

function wechatSignIn() {
  let appid = publicConfig.appId
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync()
    if (info && info.miniProgram && info.miniProgram.appId) {
      appid = info.miniProgram.appId
    }
  } catch (e) {
    // 低版本基础库拿不到账号信息就用配置常量
  }
  return wxLoginCode()
    .then(function (code) {
      return cloud.auth.signInWithWechat(code, appid)
    })
    .then(function (res) {
      if (res && res.error) throw res.error
      return true
    })
}

function ensureCloudSignIn() {
  if (cloudSignInPromise) return cloudSignInPromise
  cloudSignInPromise = cloud.auth
    .getSession()
    .then(function (res) {
      // 已有会话（getSession 临近过期会自动续期）就不再重复登录
      if (res && res.data) return true
      return wechatSignIn()
    })
    .catch(function (e) {
      console.error('[cloud] 静默登录失败（降级匿名）:', (e && e.message) || e)
      // 登录失败清空缓存 Promise，下一次 ensureCloudSignIn 会重试
      cloudSignInPromise = null
      return false
    })
  return cloudSignInPromise
}

/** 当前是否已有可用云端会话（只看本地，不发请求）。 */
function hasCloudSession() {
  return cloud.auth
    .getSession()
    .then(function (res) {
      return !!(res && res.data)
    })
    .catch(function () {
      return false
    })
}

/**
 * 取当前云端会话的用户 uid（无会话返回空串）。
 * 存储路径的归属段（shared/<ownerUid>/...、users/<uid>/...）必须用这个 uid，
 * 服务端按它校验写权限——用本地档案 id 会被当作非本人而拒绝。
 */
function getSessionUid() {
  return cloud.auth
    .getSession()
    .then(function (res) {
      const user = res && res.data && res.data.user
      return (user && user.id) || ''
    })
    .catch(function () {
      return ''
    })
}

module.exports = {
  cloud,
  publicConfig,
  ensureCloudSignIn,
  hasCloudSession,
  getSessionUid,
  uploadBinary,
  // 路径构造与 SDK 的 scopePath 规则保持一致，避免两处规则漂移
  userPath: function (userId, relativePath) {
    return 'users/' + userId + '/' + relativePath
  },
  sharedPath: function (ownerId, relativePath) {
    return 'shared/' + ownerId + '/' + relativePath
  }
}
