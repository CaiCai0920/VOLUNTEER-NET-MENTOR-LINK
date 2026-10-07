const store = require('./utils/store')
const community = require('./utils/community')

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
    community.seedQAIfMissing()
  }
})
