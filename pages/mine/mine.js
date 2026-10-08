const store = require('../../utils/store')
const util = require('../../utils/util')

const ROLE_TEXT = { asker: '新生', mentor: '学长学姐' }

// 双端主题色：新生蓝 #28314E / 学长红 #AA283A（辅色1米白/辅色2对调，见 app.wxss 变量）
const THEME = {
  asker: { bg: '#28314E', tab: '#28314E' },
  mentor: { bg: '#AA283A', tab: '#AA283A' }
}

Page({
  // 底部导航：页面滚动时隐藏，停止 1.2s 后浮现（停留底部看消息时不被弹条打扰）
  onPageScroll() {
    if (this._tabTimer) clearTimeout(this._tabTimer)
    if (!this.data.tabsHide) this.setData({ tabsHide: true })
    this._tabTimer = setTimeout(() => {
      this.setData({ tabsHide: false })
    }, 1200)
  },

  data: {
    me: { name: '', major: '', role: 'asker', topics: '' },
    meInitial: '',
    roleText: '新生',
    themeClass: 'theme-asker',
    stats: { askCount: 0, answerThreads: 0, messageCount: 0 }
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        const theme = THEME[me.role === 'mentor' ? 'mentor' : 'asker']
        wx.setNavigationBarColor({
          frontColor: '#ffffff',
          backgroundColor: theme.bg,
          fail: function () {}
        })
        return store.stats(me.id).then(function (stats) {
          // 审核台只给「第一个注册的真实用户」（即创始人）用
          return store.isReviewer(me).then(function (isReviewer) {
            const pending = isReviewer
              ? store.listPendingReviews().then(function (list) {
                  return list.length
                })
              : Promise.resolve(0)
            return pending.then(function (pendingCount) {
              self.setData({
                me: me,
                meInitial: util.initial(me.name),
                roleText: ROLE_TEXT[me.role] || '新生',
                themeClass: me.role === 'mentor' ? 'theme-mentor' : 'theme-asker',
                stats: stats,
                isReviewer: isReviewer,
                pendingCount: pendingCount
              })
              return null
            })
          })
        })
      })
      .catch(function () {})
  },

  goEdit() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  goReview() {
    wx.navigateTo({ url: '/pages/review/review' })
  },

  goHelp() {
    wx.navigateTo({ url: '/pages/help/help' })
  },

  // 返回首页
  goHome() {
    wx.redirectTo({ url: '/pages/index/index' })
  },

  // 顶部分区条：答疑 / 社区 / 消息 / 个人（无底部导航，分区条是唯一分区入口）
  onTopTab(e) {
    const map = {
      home: '/pages/index/index',
      ask: '/pages/index/index?tab=ask',
      community: '/pages/community/community'
    }
    const url = map[e.currentTarget.dataset.tab]
    // redirectTo 替换当前页：分区之间切换不堆积页面层级
    if (url) wx.redirectTo({ url: url })
  },

  // 演示用：不用两台手机，切换身份就能自己演完双方
  onSwitch() {
    const self = this
    store
      .listMentors()
      .then(function (mentors) {
        const items = ['新生身份（提问方）'].concat(
          mentors.map(function (m) {
            return m.name + '（' + m.major + '）'
          })
        )
        wx.showActionSheet({
          itemList: items,
          success(res) {
            let pickedPromise = null
            if (res.tapIndex === 0) {
              // 切回新生身份：按当前人的实名信息找回自己的新生档案
              pickedPromise = store.switchRole('asker')
            } else {
              const mentor = mentors[res.tapIndex - 1]
              pickedPromise = mentor ? store.switchToMentor(mentor.id) : Promise.resolve(null)
            }
            pickedPromise
              .then(function (picked) {
                if (!picked) return null
                getApp().globalData.me = picked
                wx.showToast({ title: '已切换为' + picked.name, icon: 'success' })
                // 回到大厅，用新身份看列表（底部导航已移除，用 reLaunch 重置页面栈）
                setTimeout(function () {
                  wx.reLaunch({ url: '/pages/index/index' })
                }, 500)
                return null
              })
              .catch(function () {})
          }
        })
        return null
      })
      .catch(function () {})
  },

  onReset() {
    wx.showModal({
      title: '清空演示数据',
      content: '提问、聊天记录和自定义昵称都会删除，学长库会恢复成默认的示例数据。确定吗？',
      confirmText: '确定清空',
      confirmColor: '#AA283A',
      cancelText: '取消',
      success(res) {
        if (!res.confirm) return
        store
          .resetDemo()
          .then(function () {
            getApp().globalData.me = null
            wx.showToast({ title: '已清空', icon: 'success' })
            setTimeout(function () {
              wx.redirectTo({ url: '/pages/login/login' })
            }, 500)
            return null
          })
          .catch(function () {})
      }
    })
  }
})
