const store = require('../../utils/store')
const util = require('../../utils/util')
const community = require('../../utils/community')

Page({
  data: {
    ready: false,
    loading: true,
    post: null,
    media: [],
    isQA: false,
    claimed: false,
    comments: [],
    draft: '',
    sending: false
  },

  onLoad(options) {
    this.postId = options.id || ''
    this.refresh()
    // 浏览即热度：精选区按 heat 聚合，看的越多越靠前
    community.bumpHeat(this.postId)
  },

  refresh() {
    const self = this
    community
      .getPost(this.postId)
      .then(function (post) {
        if (!post) {
          wx.showToast({ title: '帖子不存在', icon: 'none' })
          setTimeout(function () {
            wx.navigateBack()
          }, 900)
          return null
        }
        const media = post.media.map(function (m) {
          return { type: m.type, path: m.path, url: '' }
        })
        const paths = media.map(function (m) {
          return m.path
        })
        return community.signedUrlsOf(paths).then(function (map) {
          media.forEach(function (m) {
            m.url = map[m.path] || ''
          })
          self.setData({
            ready: true,
            loading: false,
            post: {
              userName: post.userName,
              initial: util.initial(post.userName),
              userRole: post.userRole,
              roleText: post.userRole === 'mentor' ? '学长学姐' : '新生',
              content: post.content,
              topic: post.topic,
              timeText: util.fromNow(post.createdAt)
            },
            media: media,
            isQA: post.topic === '答疑',
            claimed: !!post.claimedBy
          })
          // 正文就绪后拉评论区（失败静默，不影响正文展示）
          self.loadComments()
          return null
        })
      })
      .catch(function () {
        self.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      })
  },

  // ---------------------------------------------------------------- 评论区

  // 拉评论列表：旧在前；头像/时间/角色色在此装饰
  loadComments() {
    const self = this
    community
      .listComments(this.postId)
      .then(function (list) {
        const comments = (list || []).map(function (c) {
          return Object.assign({}, c, {
            initial: util.initial(c.userName),
            timeText: util.fromNow(c.createdAt),
            roleClass: c.userRole === 'mentor' ? 'role-mentor' : ''
          })
        })
        self.setData({ comments: comments })
        return null
      })
      .catch(function () {
        return null
      })
  },

  onCommentInput(e) {
    this.setData({ draft: e.detail.value })
  },

  // 发送评论：空文本拦截 → store.getMe() 取身份 → 入库 → 刷新列表
  onCommentSend() {
    const self = this
    const text = (this.data.draft || '').trim()
    if (!text) {
      wx.showToast({ title: '先写点内容吧', icon: 'none' })
      return
    }
    if (this.data.sending) return
    this.setData({ sending: true })
    store
      .getMe()
      .then(function (me) {
        return community.addComment({ id: self.postId }, me, text)
      })
      .then(function () {
        self.setData({ draft: '', sending: false })
        wx.showToast({ title: '评论已发布', icon: 'success' })
        self.loadComments()
        return null
      })
      .catch(function () {
        self.setData({ sending: false })
        wx.showToast({ title: '评论失败，稍后再试', icon: 'none' })
      })
  },

  // 点他人头像 → 进本帖的答疑聊天框（同一帖只开一条会话，消息页自动留入口）
  onAvatar(e) {
    const self = this
    const uid = e.currentTarget.dataset.uid
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        if (uid && uid === me.id) {
          wx.showToast({ title: '这是你自己的头像', icon: 'none' })
          return null
        }
        return store.findThreadByPost(self.postId, me.id).then(function (threadId) {
          if (threadId) {
            wx.navigateTo({ url: '/pages/chat/chat?id=' + threadId })
            return null
          }
          // 还没会话：学长点头像即认领开聊；新生只能等认领
          return community.getPost(self.postId).then(function (post) {
            if (!post) return null
            if (me.role !== 'mentor') {
              wx.showToast({ title: '还没有学长认领，先等等', icon: 'none' })
              return null
            }
            if (post.claimedBy) {
              wx.showToast({ title: '该帖已被认领', icon: 'none' })
              return null
            }
            return community.claimPost(post, me).then(function (newId) {
              wx.navigateTo({ url: '/pages/chat/chat?id=' + newId })
              return null
            })
          })
        })
      })
      .catch(function () {
        wx.showToast({ title: '打开聊天失败，请重试', icon: 'none' })
      })
  },

  // 全屏预览图片
  onPreview(e) {
    const urls = this.data.media
      .filter(function (m) {
        return m.type === 'image' && m.url
      })
      .map(function (m) {
        return m.url
      })
    const current = e.currentTarget.dataset.url || urls[0]
    if (current) wx.previewImage({ urls: urls, current: current })
  },

  // 返回上一页
  goBack() {
    wx.navigateBack()
  },

  // 认领答疑帖（与社区页同一套逻辑）
  onClaim() {
    const self = this
    if (this.data.claimed) {
      wx.showToast({ title: '该帖已被认领', icon: 'none' })
      return
    }
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        return community.getPost(self.postId).then(function (post) {
          if (!post || post.claimedBy) {
            wx.showToast({ title: '该帖已被认领', icon: 'none' })
            return null
          }
          return community.claimPost(post, me).then(function () {
            wx.showToast({ title: '已认领 · 可在工作台查看', icon: 'none', duration: 2200 })
            self.setData({ claimed: true })
            return null
          })
        })
      })
      .catch(function () {
        wx.showToast({ title: '认领失败，请重试', icon: 'none' })
      })
  }
})
