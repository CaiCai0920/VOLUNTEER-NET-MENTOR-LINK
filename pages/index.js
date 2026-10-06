const store = require('../../utils/store')
const util = require('../../utils/util')

const ROLE_TEXT = { asker: '新生', mentor: '学长学姐' }
const STATUS_TEXT = { open: '待认领', claimed: '答疑中', closed: '已解决' }
const STATUS_CLASS = { open: 'warm', claimed: '', closed: 'green' }

// 双端主题色：新生蓝 #28314E / 学长红 #AA283A（辅色1米白/辅色2对调，见 app.wxss 变量）
const THEME = {
  asker: { bg: '#28314E', tab: '#28314E' },
  mentor: { bg: '#AA283A', tab: '#AA283A' }
}

function applyTheme(role) {
  const theme = THEME[role === 'mentor' ? 'mentor' : 'asker']
  wx.setNavigationBarColor({
    frontColor: '#ffffff',
    backgroundColor: theme.bg,
    fail: function () {}
  })
}

Page({
  data: {
    me: { name: '', major: '', role: 'asker' },
    roleText: '',
    isAsker: true,
    themeClass: 'theme-asker',
    myThreads: [],
    openThreads: [],
    mentorThreads: [],
    onlineMentors: [],
    ready: false
  },

  onShow() {
    this.refresh()
    this.startHeartbeat()
  },

  onHide() {
    this.stopHeartbeat()
  },

  onUnload() {
    this.stopHeartbeat()
  },

  // 在线心跳：打开大厅期间每 15 秒上报一次「我还在看」，
  // 同时把「在线学长」列表按心跳重新拉一遍（别人上下线都能及时反映）
  startHeartbeat() {
    const self = this
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(function () {
      const me = self.data.me
      if (!me || !me.id) return
      store.touchActive(me.id)
      self.refreshOnline()
    }, 15000)
  },

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  },

  // 只刷新「在线答疑」横滑卡（轻量：不重拉全部会话）
  refreshOnline() {
    const self = this
    const me = this.data.me
    if (!me || !me.id) return
    store
      .listOnlineMentors(me)
      .then(function (list) {
        self.setData({ onlineMentors: self.decorateMentors(list) })
        return null
      })
      .catch(function () {})
  },

  decorateMentors(list) {
    return (list || []).map(function (m) {
      return {
        id: m.id,
        name: m.name,
        initial: util.initial(m.name),
        major: m.major,
        grade: m.grade || '在读',
        topics: (m.topics || '').split(' ').filter(function (t) {
          return !!t
        }),
        lastSeen: '正在看大厅'
      }
    })
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  // 组装一条会话在列表里需要的展示字段（数据由 store.loadBoard 一次拉齐）
  decorate(d, me, isAsker) {
    const thread = d.thread
    const msgs = d.messages
    const last = msgs.length ? msgs[msgs.length - 1] : null
    const otherName = isAsker ? thread.mentorName || '待认领' : thread.askerName
    // 对方（这条会话里的另一方）的已读指针，用来给列表标注最后一条的已读状态
    const otherId = isAsker ? thread.mentorId || '' : thread.askerId
    // 大厅聚合只拉了自己的已读指针；对方的指针缺失时按「未读」展示，
    // 点进聊天页会拿到精确值
    const peer = d.peerRead || { seq: 0, at: 0 }
    let lastText = '还没有消息'
    if (last) {
      // 大厅预览同样分侧：自己的消息以「我：」开头，对方消息署名，左右归属一目了然
      const mine = last.senderId === (me ? me.id : '')
      const prefix = mine ? '我：' : (last.senderName ? last.senderName + '：' : '')
      lastText = prefix + util.truncate(last.body, 34)
    } else if (thread.question) {
      lastText = '提问：' + util.truncate(thread.question, 34)
    }
    const lastMine = !!last && last.senderId === (me ? me.id : '')
    return {
      id: thread.id,
      major: thread.major,
      question: util.truncate(thread.question, 60),
      askerName: thread.askerName,
      askerInitial: util.initial(thread.askerName),
      // 学长视角下，这条提问是不是自己（旧身份）发起的——标出来方便演示切换
      ownAsk: !isAsker && thread.askerId === me.id,
      otherName: otherName,
      otherInitial: util.initial(otherName),
      statusText: STATUS_TEXT[thread.status] || '答疑中',
      statusClass: STATUS_CLASS[thread.status] || '',
      timeText: util.fromNow(thread.updatedAt),
      lastText: lastText,
      // 我发的最后一条在列表里也标出已读 / 未读，不用点进去就能看到
      lastMine: lastMine,
      lastRead: lastMine && peer.seq >= last.seq,
      unread: d.unread,
      count: msgs.length
    }
  },

  refresh() {
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          // 还没登记身份，先去登记页
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        applyTheme(me.role)
        const isAsker = me.role !== 'mentor'
        // 在线答疑：只列「当前真的打开着页面」的学长学姐（按心跳判定，排除自己和自己的另一身份）
        const mentorsPromise = store.listOnlineMentors(me)
        const boardPromise = store.loadBoard(me)
        return Promise.all([mentorsPromise, boardPromise]).then(function (out) {
          const onlineMentors = self.decorateMentors(out[0])
          const board = out[1]
          self.setData({
            ready: true,
            me: me,
            roleText: ROLE_TEXT[me.role] || '新生',
            isAsker: isAsker,
            themeClass: isAsker ? 'theme-asker' : 'theme-mentor',
            onlineMentors: onlineMentors,
            myThreads: board.myThreads.map(function (d) {
              return self.decorate(d, me, true)
            }),
            openThreads: board.openThreads.map(function (d) {
              return self.decorate(d, me, false)
            }),
            mentorThreads: board.mentorThreads.map(function (d) {
              return self.decorate(d, me, false)
            })
          })
          getApp().globalData.me = me
          return null
        })
      })
      .catch(function () {
        // 错误已由 store 统一提示
      })
  },

  goAsk() {
    wx.navigateTo({ url: '/pages/ask/ask' })
  },

  // 点在线学长卡片：带上学长 id 进提问页，方向与对象都替你预选好
  goAskMentor(e) {
    const id = e.currentTarget.dataset.id || ''
    wx.navigateTo({ url: '/pages/ask/ask?id=' + id })
  },

  // 身份切换：同一人双身份互切，切换后整页配色、导航栏、tab 同步换色
  onSwitchRole(e) {
    const self = this
    const role = e.currentTarget.dataset.role === 'mentor' ? 'mentor' : 'asker'
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        const current = me.role === 'mentor' ? 'mentor' : 'asker'
        if (current === role) return null
        return store.switchRole(role).then(function (picked) {
          if (!picked) return null
          getApp().globalData.me = picked
          wx.showToast({
            title: role === 'mentor' ? '已切换为学长学姐端（红）' : '已切换为新生端（蓝）',
            icon: 'none'
          })
          self.refresh()
          return null
        })
      })
      .catch(function () {})
  },

  goHelp() {
    wx.navigateTo({ url: '/pages/help/help' })
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
  },

  // 学长点「我来答」：认领这条提问，然后直接进聊天页
  onClaim(e) {
    const self = this
    const id = e.currentTarget.dataset.id
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        return store.claimThread(id, me).then(function (thread) {
          if (!thread) {
            wx.showToast({ title: '这条提问不存在了', icon: 'none' })
            return null
          }
          if (thread.mentorId !== me.id) {
            // 条件更新没命中：刚被别人抢先认领了
            wx.showToast({ title: '刚被其他学长抢先认领啦', icon: 'none' })
            self.refresh()
            return null
          }
          // 认领后自动发一句开场白，让对方知道有人接了
          return store
            .addMessage(
              id,
              '你好，我是' + me.major + '的' + me.name + '，这条问题我来帮你看看。'
            )
            .then(function () {
              wx.showToast({ title: '认领成功', icon: 'success' })
              setTimeout(function () {
                wx.navigateTo({ url: '/pages/chat/chat?id=' + id })
              }, 400)
              return null
            })
        })
      })
      .catch(function () {})
  }
})
