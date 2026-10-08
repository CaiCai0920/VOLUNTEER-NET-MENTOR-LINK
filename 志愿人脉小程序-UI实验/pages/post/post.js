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

  // 发布：媒体传云存储 -> 帖子行写云数据库 -> 返回社区页
  onSubmit() {
    const self = this
    if (this.data.submitting) return
    const content = (this.data.content || '').trim()
    if (!content && !this.data.files.length) {
      wx.showToast({ title: '写点什么或选张图吧', icon: 'none' })
      return
    }
    // 发布前确保云端会话就绪（启动时的静默登录可能还没完成或已失败，这里兜底重试）；
    // 存储上传强制要求凭证，缺会话时带图发布会报 MISSING_CREDENTIALS
    ensureCloudSignIn()
      .catch(function () {
        return false
      })
      .then(function (signedIn) {
        // 带图发布却没有云端会话 —— 存储通道必然被拒，先别浪费用户一次上传等待，
        // 直接引导去登录页（手机号短信验证通过后 SDK 会落盘会话，回来就能传图）。
        if (self.data.files.length && !signedIn) {
          wx.hideLoading()
          return new Promise(function (resolve) {
            wx.showModal({
              title: '需要先完成身份核验',
              content: '发送图片需要云端身份凭证。完成一次手机号核验后即可正常发图（纯文字帖不受影响）。',
              confirmText: '去核验',
              cancelText: '只发文字',
              success(res) {
                if (res.confirm) {
                  // navigateTo 保留发帖页在栈内，核验完返回时草稿（文字/图片）还在
                  wx.navigateTo({ url: '/pages/login/login?needSession=1' })
                } else {
                  // 用户选择只发文字：丢掉已选媒体继续走
                  self.setData({ files: [] })
                }
                resolve(null)
              },
              fail() {
                resolve(null)
              }
            })
          })
        }
        return true
      })
      .then(function (proceed) {
        if (proceed === null) return null
        return store.getMe()
      })
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
        // 凭证类错误：吐司装不下原因，用弹窗把完整错误亮出来，直接给下一步动作
        const isCredential = /MISSING_CREDENTIALS|Credentials missing|credential|未授权|access_denied|小程序未授权|invalid_client|token/i.test(raw)
        if (isCredential) {
          console.error('[post] 发布失败(凭证):', raw)
          wx.showModal({
            title: '图片通道需要身份确认',
            content:
              '云端拒绝了上传凭证。完成一次短信核验后再发即可。' +
              '若刚核验过仍失败，请截图此弹窗反馈。\n错误详情：' +
              raw.slice(0, 180),
            confirmText: '去核验',
            cancelText: '知道了',
            success(res) {
              if (res.confirm) {
                wx.navigateTo({ url: '/pages/login/login?needSession=1' })
              }
            }
          })
          return
        }
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
