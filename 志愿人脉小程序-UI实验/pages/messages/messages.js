const store = require('../../utils/store')
const util = require('../../utils/util')

// 消息中心：归档「已处理的答疑」与「收到的对话」
// ------------------------------------------------------------------
// 进行中 —— 已认领 / 有来有往的会话（status = open | claimed）
// 已归档 —— 已处理的答疑与已结束的对话（status = closed），只读存档，仍可点回看
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
    ready: false,
    pane: 'active',
    activeItems: [],
    archivedItems: []
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  // 双栏切换
  onPane(e) {
    this.setData({ pane: e.currentTarget.dataset.pane === 'archived' ? 'archived' : 'active' })
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
        const isAsker = me.role !== 'mentor'
        return store.loadBoard(me).then(function (board) {
          // 我参与的会话：我发起的 + 我认领的（学长视角）
          const mine = board.decorated.filter(function (d) {
            return d.thread.askerId === me.id || d.thread.mentorId === me.id
          })
          const active = []
          const archived = []
          mine.forEach(function (d) {
            const row = self.decorate(d, me, isAsker)
            if (d.thread.status === 'closed') archived.push(row)
            else active.push(row)
          })
          self.setData({
            ready: true,
            activeItems: active,
            archivedItems: archived
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
    const closed = thread.status === 'closed'
    return {
      id: thread.id,
      question: util.truncate(thread.question, 24),
      otherName: otherName,
      otherInitial: util.initial(otherName),
      // 头像按对方角色着色：我是新生 → 对方是学长（红）；我是学长 → 对方是新生（蓝）
      roleClass: isAsker ? 'role-mentor' : '',
      timeText: last ? util.fromNow(last.createdAt) : util.fromNow(thread.updatedAt),
      lastText: lastText,
      unread: d.unread,
      // 状态签：归档栏显示「已处理」，进行中栏显示「答疑中 / 待认领」
      statusText: closed ? '已处理' : (thread.status === 'claimed' ? '答疑中' : '待认领')
    }
  },

  // 底部分区条：首页 / 答疑 / 社区 / 消息
  onTopTab(e) {
    const map = {
      home: '/pages/index/index',
      ask: '/pages/index/index?tab=ask',
      community: '/pages/community/community'
    }
    const tab = e.currentTarget.dataset.tab
    if (tab === 'messages') return
    const url = map[tab]
    // redirectTo 替换当前页：分区之间切换不堆积页面层级
    if (url) wx.redirectTo({ url: url })
  },

  goChat(e) {
    wx.navigateTo({ url: '/pages/chat/chat?id=' + e.currentTarget.dataset.id })
  }
})
