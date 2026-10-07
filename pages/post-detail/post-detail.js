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
    claimed: false
  },

  onLoad(options) {
    this.postId = options.id || ''
    this.refresh()
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
          return null
        })
      })
      .catch(function () {
        self.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
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
