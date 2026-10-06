const store = require('../../utils/store')
const util = require('../../utils/util')

Page({
  data: {
    ready: false,
    items: []
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  // 会话列表：数据由 store.loadBoard 一次拉齐（含最后一条消息与未读数）
  refresh() {
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        const isAsker = me.role !== 'mentor'
        return store.loadBoard(me).then(function (board) {
          // 我参与的会话：我发起的 + 我认领的（学长视角）
          const mine = board.decorated.filter(function (d) {
            return d.thread.askerId === me.id || d.thread.mentorId === me.id
          })
          self.setData({
            ready: true,
            items: mine.map(function (d) {
              return self.decorate(d, me, isAsker)
            })
          })
          return null
        })
      })
      .catch(function () {})
  },

  // 组装一条会话在消息列表里要展示的字段
  decorate(d, me, isAsker) {
    const thread = d.thread
    const msgs = d.messages
    const last = msgs.length ? msgs[msgs.length - 1] : null
    const otherName = isAsker ? thread.mentorName || '待认领' : thread.askerName
    let lastText = '还没有消息'
    if (last) {
      const mine = last.senderId === (me ? me.id : '')
      const prefix = mine ? '我：' : (last.senderName ? last.senderName + '：' : '')
      lastText = prefix + util.truncate(last.body, 40)
    } else if (thread.question) {
      lastText = '提问：' + util.truncate(thread.question, 40)
    }
    return {
      id: thread.id,
      question: util.truncate(thread.question, 30),
      otherName: otherName,
      otherInitial: util.initial(otherName),
      // 新生端头像用主色、学长端用辅色2（与聊天页同一套约定）
      warm: !isAsker,
      timeText: last ? util.fromNow(last.createdAt) : util.fromNow(thread.updatedAt),
      lastText: lastText,
      unread: d.unread
    }
  },

  // 顶部分区条：答疑 / 社区 / 消息 / 个人（无底部导航，分区条是唯一分区入口）
  onTopTab(e) {
    const map = {
      ask: '/pages/index/index',
      community: '/pages/community/community',
      messages: '/pages/messages/messages',
      mine: '/pages/mine/mine'
    }
    const url = map[e.currentTarget.dataset.tab]
    // redirectTo 替换当前页：分区之间切换不堆积页面层级
    if (url) wx.redirectTo({ url: url })
  },

  goChat(e) {
    wx.navigateTo({ url: '/pages/chat/chat?id=' + e.currentTarget.dataset.id })
  }
})
