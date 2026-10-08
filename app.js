const store = require('./utils/store')
const community = require('./utils/community')
const { ensureCloudSignIn } = require('./utils/cloud')

App({
  globalData: {
    // 当前登录的用户档案，页面通过 await store.getMe() 读取最新值
    me: null
  },

  onLaunch() {
    // 云端请求失败的统一提示：不静默吞错，并把真实原因提示出来
    store.setErrorHandler(function (msg) {
      const m = String(msg || '')
      let title = '网络开小差了，稍后再试'
      if (/domain list|合法域名/i.test(m)) {
        // 请求域名还没注册进小程序后台：需要重新走一次发布
        title = '域名未注册：请重新发布一次'
      } else if (/request:fail|timeout|timed?\s?out|ERR_/i.test(m)) {
        title = '连不上云端，请检查手机网络'
      } else if (m) {
        title = ('请求失败：' + m).slice(0, 40)
      }
      console.error('[cloud] 原始错误:', m)
      wx.showToast({ title: title, icon: 'none', duration: 3200 })
    })
    // 首次启动（云端用户表为空）时写入示例学长库，保证学长生源不是空的
    store.seedIfEmpty()
    // 首次启动（云端帖子表为空）时写入几条演示帖，社区瀑布流不至于空着
    community.seedIfEmpty()
    // 老库升级：补种新增的演示帖（逐条判断，已存在的不动）
    community.seedDemoPosts()
    // 信息广场首期知识节点（表为空时写入）
    community.seedInfoIfEmpty()
    // 演示评论补种（表为空时写入，详情页评论区开箱有内容）
    community.seedCommentsIfEmpty()
    // 云端静默登录（wx.login 换正式会话）：存储网关已收紧为强制凭证，
    // 不登录的话发帖带图上传会报 401 MISSING_CREDENTIALS。失败静默降级。
    ensureCloudSignIn().then(function (ok) {
      // 登录没成功（服务端未授权该小程序 / 无网络）：发帖带图会被网关拒，
      // 给一次明确提示，避免用户在发布页反复撞「发布失败」。
      if (ok === false) {
        console.warn('[cloud] 静默登录未成功，图片上传将在发布时再次尝试')
      }
    })
  }
})
