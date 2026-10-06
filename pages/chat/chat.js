const store = require('../../utils/store')
const util = require('../../utils/util')

const STATUS_TEXT = { open: '待认领', claimed: '答疑中', closed: '已解决' }
const POLL_MS = 3000

Page({
  data: {
    threadId: '',
    thread: { major: '', question: '' },
    me: null,
    isAsker: true,
    themeClass: 'theme-asker',
    otherName: '',
    otherInitial: '',
    peerReadText: '',
    statusText: '',
    canClaim: false,
    canClose: false,
    messages: [],
    draft: '',
    intoView: '',
    sending: false
  },

  onLoad(query) {
    this.setData({ threadId: query.id || '' })
    this.boot()
  },

  // 首次进入：先确认身份（云端），再拉会话
  boot() {
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        self.setData({ me: me })
        self.refresh(false)
        return null
      })
      .catch(function () {})
  },

  onShow() {
    // 回到页面立刻重算一次（身份可能已在外面切换，已读状态也可能被对方更新）
    if (this.data.threadId && this.data.me) this.refresh(true)
    this.startPoll()
  },

  onHide() {
    this.stopPoll()
  },

  onUnload() {
    this.stopPoll()
  },

  startPoll() {
    const self = this
    this.stopPoll()
    this.timer = setInterval(function () {
      self.refresh(true)
    }, POLL_MS)
  },

  stopPoll() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  // 组装消息列表：按时间插入分隔、标出哪条是自己发的
  buildMessages(list, me) {
    const out = []
    let lastTs = 0
    list.forEach(function (m) {
      const showTime = m.createdAt - lastTs > 5 * 60 * 1000
      lastTs = m.createdAt
      out.push({
        id: m.id,
        seq: m.seq,
        body: m.body,
        senderName: m.senderName,
        initial: util.initial(m.senderName),
        mine: m.senderId === me.id,
        timeText: util.formatTime(m.createdAt),
        showTime: showTime
      })
    })
    return out
  },

  refresh(silent) {
    const self = this
    // 分侧铁律：以「当前登录身份」实时判定——自己发的永远在右，切换身份后
    // 旧身份发的消息一律视为对方（在左）。每次刷新都重新读取身份，防止页面
    // 实例残留旧身份导致分侧错乱。
    store
      .getMe()
      .then(function (me) {
        me = me || self.data.me
        if (!me) return null
        const identityChanged = !self.data.me || self.data.me.id !== me.id
        if (identityChanged) self.setData({ me: me })
        const threadId = self.data.threadId
        return store.getThread(threadId).then(function (thread) {
          if (!thread) {
            if (!silent) {
              wx.showToast({ title: '会话不存在', icon: 'none' })
              setTimeout(function () {
                wx.navigateBack()
              }, 800)
            }
            return null
          }
          const isAsker = me.id === thread.askerId
          // 打开会话即计为「我已读」（云端 vm_reads，只增不减）
          return store
            .markRead(thread.id, me.id)
            .then(function () {
              // 会话与对方已读指针重新取一次（markRead 只影响自己，不影响对方）
              return Promise.all([store.getThread(thread.id), store.listMessages(thread.id)])
            })
            .then(function (out) {
              const freshThread = out[0] || thread
              const messages = self.buildMessages(out[1], me)
              const otherId = isAsker ? freshThread.mentorId || '' : freshThread.askerId
              return store.readStateOf(thread.id, otherId).then(function (peer) {
                self.render(freshThread, me, isAsker, messages, peer, silent, identityChanged)
                return null
              })
            })
        })
      })
      .catch(function () {
        // 错误已由 store 统一提示
      })
  },

  render(freshThread, me, isAsker, messages, peer, silent, identityChanged) {
    const otherName = isAsker ? freshThread.mentorName || '待认领' : freshThread.askerName

    // 逐条已读/未读回执：我发出的每一条消息，按「对方读到第几条」单独标记。
    // 用消息序号比较而不是毫秒时间戳 —— 同一毫秒内连发两条也不会误判成已读。
    messages.forEach(function (msg) {
      if (!msg.mine) return
      msg.read = msg.seq <= peer.seq
      msg.readText = msg.read ? '已读' : '未读'
    })

    // 顶部对方阅读进度：让对方读完时页面上有明确的可见变化
    let peerReadText = ''
    const otherId = isAsker ? freshThread.mentorId || '' : freshThread.askerId
    if (otherId && messages.length) {
      peerReadText = peer.seq > 0 ? '对方已读至 ' + util.formatTime(peer.at) : '对方尚未查看'
    }

    // 数据没变就不重复渲染，避免轮询把页面刷得一闪一闪；
    // 身份变化（切换后旧身份即对方）时强制重算，保证分侧与主题同步刷新。
    // 已读状态（peer.seq / peer.at）纳入签名，对方一读完这里立刻重绘。
    const signature =
      me.id +
      '|' +
      freshThread.status +
      '|' +
      (freshThread.mentorId || '') +
      '|' +
      messages.length +
      '|' +
      peer.seq +
      '|' +
      peer.at
    if (!identityChanged && silent && signature === this.signature) return
    this.signature = signature

    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: isAsker ? '#28314E' : '#AA283A',
      fail: function () {}
    })

    this.setData({
      thread: freshThread,
      me: me,
      isAsker: isAsker,
      themeClass: isAsker ? 'theme-asker' : 'theme-mentor',
      otherName: otherName,
      otherInitial: util.initial(otherName),
      peerReadText: peerReadText,
      statusText: STATUS_TEXT[freshThread.status] || '答疑中',
      canClaim: freshThread.status === 'open' && !isAsker && me.role === 'mentor',
      canClose: freshThread.status !== 'closed' && isAsker,
      messages: messages
    })
    this.scrollToBottom(messages)
  },

  scrollToBottom(messages) {
    const last = messages[messages.length - 1]
    this.setData({ intoView: last ? 'msg-' + last.id : 'chat-bottom' })
  },

  onDraftInput(e) {
    this.setData({ draft: e.detail.value })
  },

  onSend() {
    const self = this
    const body = (this.data.draft || '').trim()
    if (!body) {
      wx.showToast({ title: '还没写内容', icon: 'none' })
      return
    }
    if (this.data.sending) return
    this.setData({ sending: true, draft: '' })
    store
      .addMessage(this.data.threadId, body)
      .then(function (msg) {
        self.setData({ sending: false })
        if (!msg) {
          wx.showToast({ title: '发送失败，请重试', icon: 'none' })
          self.setData({ draft: body })
          return null
        }
        self.refresh(true)
        return null
      })
      .catch(function () {
        self.setData({ sending: false, draft: body })
      })
  },

  onClaim() {
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) return null
        return store.claimThread(self.data.threadId, me).then(function (thread) {
          if (!thread || thread.mentorId !== me.id) {
            wx.showToast({ title: '刚被其他学长抢先认领啦', icon: 'none' })
            self.refresh(true)
            return null
          }
          return store
            .addMessage(
              self.data.threadId,
              '你好，我是' + me.major + '的' + me.name + '，这条我来帮你看看。'
            )
            .then(function () {
              wx.showToast({ title: '已认领', icon: 'success' })
              self.refresh(true)
              return null
            })
        })
      })
      .catch(function () {})
  },

  onClose() {
    const self = this
    wx.showModal({
      title: '标记为已解决',
      content: '确认这条提问已经答疑完成了吗？',
      confirmText: '确认',
      cancelText: '再等等',
      success(res) {
        if (!res.confirm) return
        store
          .closeThread(self.data.threadId)
          .then(function () {
            wx.showToast({ title: '已标记', icon: 'success' })
            self.refresh(true)
            return null
          })
          .catch(function () {})
      }
    })
  },

  goHelp() {
    wx.navigateTo({ url: '/pages/help/help' })
  }
})
