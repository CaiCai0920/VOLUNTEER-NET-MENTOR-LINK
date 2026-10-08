/**
 * 云端客户端（唯一初始化点）
 * ------------------------------------------------------------------
 * 所有页面 / 数据层统一从这里拿 cloud 实例：
 *   - endpoint / publishableKey 来自 WorkBuddy 云服务的 publicConfig（开通时下发）
 *   - wx 注入诊断包装：云端请求失败时会在调试面板打印方法 / URL / 状态码
 *
 * 两条硬规矩（对照 docs/接口清单.md）：
 *   1. 不要在别处重复 createMiniProgramWorkBuddyCloud。
 *   2. 不要手写 wx.request 访问云端，也不要在页面里自己实现上传。
 *      媒体上传一律 community.uploadMedias -> cloud.storage.upload()。
 *      本文件只保留「拿会话」的辅助函数，不含任何上传实现。
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
 * 云端静默登录（wx.login code -> 正式会话）
 * ------------------------------------------------------------------
 * 存储网关要求凭证：匿名（只带 publishableKey）的云存储请求一律
 * 401 MISSING_CREDENTIALS —— 上传、下载、签名 URL、列目录全都拦
 * （数据库匿名通道不受影响，读写照旧）。
 * 小程序侧用 wx.login 的 code 走 signInWithWechat 换正式会话，SDK 自动
 * 落盘（workbuddy-cloud.session.*）并自动续期；会话就绪后所有云存储调用
 * 会自动带上 Authorization。
 * 登录失败不阻塞应用（静默降级为匿名：浏览 / 发文字帖仍可用），
 * 下一次调用会重新尝试登录。
 *
 * ⚠️ 当前这套应用还拿不到会话：微信登录未开通（网关 403 小程序未授权给
 *    WorkBuddy），手机号验码换会话被服务端以 invalid_grant 拒绝。因此
 *    community.uploadMedias 在无会话时会自动降级为「图片内联进数据库」。
 *    等这个开关在 WorkBuddy 侧打开后，无需改代码就会自动切回云存储。
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
 * 服务端按它校验写权限 —— 用本地档案 id 会被当作非本人而拒绝。
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
  getSessionUid
}
