const store = require('../../utils/store')
const util = require('../../utils/util')
const community = require('../../utils/community')

Page({
  data: {
    ready: false,
    loading: true,
    colA: [],
    colB: []
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  // 拉帖子 + 给封面媒体换签名链接；奇偶交替拆两列，凑出瀑布流
  refresh() {
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        return community.listPosts(50).then(function (posts) {
          const decorated = posts.map(function (p) {
            const cover = p.media.length ? p.media[0] : null
            return {
              id: p.id,
              userName: p.userName,
              initial: util.initial(p.userName),
              content: p.content,
              topic: p.topic,
              timeText: util.fromNow(p.createdAt),
              coverType: cover ? cover.type : '',
              coverPath: cover ? cover.path : '',
              coverUrl: '',
              previewUrls: [],
              isQA: p.topic === '答疑',
              claimed: !!p.claimedBy
            }
          })
          // 只给封面换签名链接（第一批先渲染文字，图到了再补上）
          const paths = decorated
            .filter(function (p) {
              return !!p.coverPath
            })
            .map(function (p) {
              return p.coverPath
            })
          return community.signedUrlsOf(paths).then(function (map) {
            decorated.forEach(function (p) {
              p.coverUrl = map[p.coverPath] || ''
              // 精简版：可预览的就是封面这一张图
              p.previewUrls = p.coverType === 'image' && p.coverUrl ? [p.coverUrl] : []
            })
            self.setData({
              ready: true,
              loading: false,
              colA: decorated.filter(function (p, i) {
                return i % 2 === 0
              }),
              colB: decorated.filter(function (p, i) {
                return i % 2 === 1
              })
            })
            return null
          })
        })
      })
      .catch(function () {
        self.setData({ loading: false })
      })
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

  // 悬浮发布按钮 -> 发帖页
  goPost() {
    wx.navigateTo({ url: '/pages/post/post' })
  },

  // 点图片封面：全屏预览该帖的所有图片
  onPreview(e) {
    const urls = e.currentTarget.dataset.urls || []
    const current = e.currentTarget.dataset.url || urls[0]
    if (current) wx.previewImage({ urls: urls, current: current })
  },

  // 点卡片主体：进帖子详情页
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/post-detail/post-detail?id=' + id })
  },

  // 认领答疑帖：生成答疑会话（工作台「我接的」可见），帖子标记已认领
  onClaim(e) {
    const self = this
    const id = e.currentTarget.dataset.id
    const claimed = e.currentTarget.dataset.claimed
    if (claimed) {
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
        return community.getPost(id).then(function (post) {
          if (!post) {
            wx.showToast({ title: '帖子不存在', icon: 'none' })
            return null
          }
          if (post.claimedBy) {
            wx.showToast({ title: '该帖已被认领', icon: 'none' })
            return null
          }
          return community.claimPost(post, me).then(function () {
            wx.showToast({ title: '已认领 · 可在工作台查看', icon: 'none', duration: 2200 })
            self.refresh()
            return null
          })
        })
      })
      .catch(function () {
        wx.showToast({ title: '认领失败，请重试', icon: 'none' })
      })
  }
})
