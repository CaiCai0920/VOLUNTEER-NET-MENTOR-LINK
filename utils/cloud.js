/**
 * 云端客户端（唯一初始化点）
 * ------------------------------------------------------------------
 * 所有页面 / 数据层统一从这里拿 cloud 实例：
 *   - endpoint / publishableKey 来自 WorkBuddy 云服务的 publicConfig（开通时下发）
 *   - wx 注入诊断包装：云端请求失败时会在调试面板打印方法 / URL / 状态码
 * 不要在别处重复 createMiniProgramWorkBuddyCloud，也不要手写 wx.request 访问云端。
 */

const publicConfig = {
  resourceId: 'wbcs_vdFuvJVArH5a7OxQuPECUs',
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_Tfw8sbHq6elhJWIxT3JMu7_3GN3Mc6Ynbz3NKn2q6Ozw90XCyQuVR6s'
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
 * 二进制上传补丁
 * ------------------------------------------------------------------
 * SDK 的小程序 fetch 适配器目前只支持字符串 body，传 ArrayBuffer 会抛
 * 「暂不支持非字符串 body（ArrayBuffer/FormData 待补）」，导致学生证照片
 * 等二进制上传全部失败。官方存储文档推荐的正是 ArrayBuffer 直传，因此
 * 在这里把存储层实例的 fetch 换成增强版：
 *   - 字符串 body → 走 SDK 原生 fetch（凭证注入 / 日志行为不变）
 *   - 二进制 body → 走 wx.request 的 ArrayBuffer 通道（wx 原生能力），
 *     并复刻 createCloudFetch 的凭证注入（publishableKey + 登录令牌），
 *     否则网关会报「the client credential is invalid or revoked」。
 * 只替换实例属性，不改 SDK 源码；SDK 后续版本修复后可整体删掉本补丁。
 */
var PUBLISHABLE_KEY_HEADER = 'x-wb-webapp-access-key'

function installBinaryUploadPatch(storage, wxInstance, cloudClient, publishableKey) {
  function toPlainHeaders(input) {
    const out = {}
    if (!input) return out
    if (typeof input.forEach === 'function') {
      input.forEach(function (value, key) {
        out[String(key)] = value
      })
    } else {
      Object.keys(input).forEach(function (key) {
        out[key] = input[key]
      })
    }
    return out
  }

  function buildResponseLike(result) {
    const header = {}
    Object.keys(result.header || {}).forEach(function (key) {
      header[String(key).toLowerCase()] = result.header[key]
    })
    const bodyText =
      typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
    return {
      ok: result.statusCode >= 200 && result.statusCode < 300,
      status: result.statusCode,
      statusText: '',
      headers: {
        forEach: function (callback) {
          Object.keys(header).forEach(function (key) {
            callback(header[key], key)
          })
        }
      },
      text: function () {
        return Promise.resolve(bodyText)
      },
      json: function () {
        return Promise.resolve(JSON.parse(bodyText))
      }
    }
  }

  function sendBinary(input, init, headers) {
    return new Promise(function (resolve, reject) {
      wxInstance.request({
        url: String(input),
        method: ((init && init.method) || 'GET').toUpperCase(),
        header: headers,
        data: init.body,
        responseType: 'text',
        success(result) {
          resolve(buildResponseLike(result))
        },
        fail(err) {
          reject(new Error('wx.request failed: ' + ((err && err.errMsg) || 'network error')))
        }
      })
    })
  }

  function binaryFetch(input, init) {
    const body = init ? init.body : undefined
    const isBinary =
      body !== undefined &&
      body !== null &&
      typeof body !== 'string' &&
      typeof body.pipe !== 'function'
    if (!isBinary) return null
    // 与 createCloudFetch 同款凭证注入：publishableKey 必带，登录令牌有则带
    const headers = toPlainHeaders(init && init.headers)
    headers[PUBLISHABLE_KEY_HEADER] = publishableKey
    const hasAuth = Object.keys(headers).some(function (key) {
      return key.toLowerCase() === 'authorization'
    })
    return cloudClient.auth
      .getAccessToken()
      .catch(function () {
        return undefined
      })
      .then(function (token) {
        if (token && !hasAuth) headers.Authorization = 'Bearer ' + token
        return sendBinary(input, init, headers)
      })
  }

  const targets = []
  if (storage.fileApi) targets.push(storage.fileApi)
  if (storage.runtime && storage.runtime.fileApi && storage.runtime.fileApi !== storage.fileApi) {
    targets.push(storage.runtime.fileApi)
  }
  targets.forEach(function (fileApi) {
    const originalFetch = fileApi.fetch
    fileApi.fetch = function (input, init) {
      return binaryFetch(input, init) || originalFetch(input, init)
    }
  })
}

installBinaryUploadPatch(cloud.storage, diagnosticWx, cloud, publicConfig.publishableKey)

module.exports = { cloud, publicConfig }
