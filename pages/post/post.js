const store = require('../../utils/store')
const community = require('../../utils/community')
const { ensureCloudSignIn } = require('../../utils/cloud')

Page({
  data: {
    topicList: community.TOPICS,
    topic: '生活',
    isClaim: false, // 独立选项：勾选后变为认领帖（话题固定「答疑」，广场朱红高亮可认领）
    customTopic: '', // 自定义分区：非空时优先于预设色块
    content: '',
    files: [], // 已选媒体：[{ tempFilePath, fileType: 'image'|'video' }]
    submitting: false
  },

  // 选图片 / 视频：一次最多 9 个，视频只能选 1 个（系统限制）
  onChoose() {
    const self = this
    const left = 9 - this.data.files.length
    if (left <= 0) {
      wx.showToast({ title: '最多选 9 个哦', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image', 'video'],
      sourceType: ['album', 'camera'],
      success(res) {
        const picked = (res.tempFiles || []).map(function (f) {
          return {
            tempFilePath: f.tempFilePath,
            fileType: f.fileType === 'video' ? 'video' : 'image'
          }
        })
        // 有视频时只保留第一个视频，视频不与别的媒体混排（精简版约束）
        const videos = picked.filter(function (f) {
          return f.fileType === 'video'
        })
        const images = picked.filter(function (f) {
          return f.fileType === 'image'
        })
        const merged = self.data.files
          .filter(function (f) {
            return f.fileType === 'image'
          })
          .concat(images)
        if (videos.length) merged.push(videos[0])
        self.setData({
          files: merged.slice(0, 9).map(function (f) {
            return {
              tempFilePath: f.tempFilePath,
              fileType: f.fileType
            }
          })
        })
      }
    })
  },

  // 删掉某个已选媒体
  onRemove(e) {
    const i = e.currentTarget.dataset.index
    const files = this.data.files.slice()
    files.splice(i, 1)
    this.setData({ files: files })
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  onTopic(e) {
    this.setData({ topic: e.currentTarget.dataset.topic })
  },

  // 认领帖开关：勾选即变为认领帖（发帖时话题强制「答疑」）
  onToggleClaim() {
    this.setData({ isClaim: !this.data.isClaim })
  },

  // 自定义话题：非空时优先于预设分区
  onCustomTopic(e) {
    this.setData({ customTopic: e.detail.value })
  },

  // 最终话题：认领帖 > 自定义 > 预设色块
  resolvedTopic() {
    if (this.data.isClaim) return '答疑'
    const custom = (this.data.customTopic || '').trim()
    return custom || this.data.topic
  },

  // 发布：媒体 -> 帖子行 -> 返回社区页
  // 媒体通道由 community.uploadMedias 内部按「有没有云端会话」自动选：
  // 有会话走云存储，无会话把图片压缩后内联进帖子。所以这里不再需要
  // 拦截「没登录就不能发图」—— 图片在两种状态下都能发出去。
  onSubmit() {
    const self = this
    if (this.data.submitting) return
    const content = (this.data.content || '').trim()
    if (!content && !this.data.files.length) {
      wx.showToast({ title: '写点什么或选张图吧', icon: 'none' })
      return
    }
    // 后台尽力拿一次会话（拿到就能走云存储，拿不到也不影响发图）；
    // 不阻塞、不弹窗，失败静默降级成内联图片。
    ensureCloudSignIn().catch(function () {
      return false
    })
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        const files = self.data.files
        if (!files.length && !content) return null
        self.setData({ submitting: true })
        wx.showLoading({ title: files.length ? '发布中…' : '发送中…' })
        return community
          .uploadMedias(me.id, files)
          .then(function (media) {
            return community.createPost(me, {
              content: content,
              topic: self.resolvedTopic(),
              media: media
            })
          })
          .then(function () {
            wx.hideLoading()
            wx.showToast({ title: '发布成功', icon: 'success' })
            setTimeout(function () {
              wx.navigateBack()
            }, 500)
            return null
          })
      })
      .catch(function (e) {
        wx.hideLoading()
        self.setData({ submitting: false })
        const raw = String((e && e.message) || '未知错误')
        wx.showToast({
          title: ('发布失败：' + raw).slice(0, 60),
          icon: 'none',
          duration: 4000
        })
        // 同时把完整错误打到控制台，真机调试时能直接看到原因
        console.error('[post] 发布失败:', raw)
      })
  }
})
