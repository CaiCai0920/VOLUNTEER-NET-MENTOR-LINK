const store = require('../../utils/store')
const { cloud } = require('../../utils/cloud')

Page({
  data: {
    loading: true,
    needSession: false,
    items: []
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const self = this
    self.setData({ loading: true })
    // 照片存在云存储里，读图需要登录态（注册时短信验证建立的那份会话）
    cloud.auth.getSession().then(function (sess) {
      const session = sess && sess.data
      if (!session) {
        self.setData({ loading: false, needSession: true, items: [] })
        return null
      }
      return store.listPendingReviews().then(function (list) {
        return Promise.all(
          list.map(function (u) {
            if (!u.idPhoto) return Promise.resolve('')
            // 内联图（data:）不需要签名，直接原样用；
            // 只有云存储路径才去问云端要签名 URL，否则缺会话时整体 401，
            // 连内联的证件照也一起显示不出来。
            if (u.idPhoto.indexOf('data:') === 0) return Promise.resolve(u.idPhoto)
            return cloud.storage
              .createSignedUrl(u.idPhoto, 1800)
              .then(function (r) {
                if (r && r.error) return ''
                const d = r && r.data
                if (!d) return ''
                if (typeof d === 'string') return d
                return d.signedUrl || d.url || d.path || ''
              })
              .catch(function () {
                return ''
              })
          })
        ).then(function (urls) {
          self.setData({
            loading: false,
            needSession: false,
            items: list.map(function (u, i) {
              return {
                id: u.id,
                name: u.name,
                roleText: u.role === 'mentor' ? '学长学姐' : '新生',
                realName: u.realName,
                studentId: u.studentId,
                major: u.major,
                phone: u.phone,
                photoUrl: urls[i],
                submittedAt: util_time(u.createdAt)
              }
            })
          })
          return null
        })
      })
    }).catch(function () {
      self.setData({ loading: false })
    })
  },

  // 点照片放大看
  onPreview(e) {
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ urls: [url] })
  },

  decide(e) {
    const self = this
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    const pass = status === 'approved'
    wx.showModal({
      title: pass ? '通过核验' : '驳回核验',
      content: pass ? '通过后对方昵称旁会亮起认证标识。' : '驳回后对方需要重新提交手机号与学生证照片。',
      confirmText: pass ? '通过' : '驳回',
      confirmColor: pass ? '#28314E' : '#AA283A',
      cancelText: '再想想',
      success(res) {
        if (!res.confirm) return
        store
          .setReviewStatus(id, status)
          .then(function () {
            wx.showToast({ title: pass ? '已通过' : '已驳回', icon: 'success' })
            self.refresh()
            return null
          })
          .catch(function () {})
      }
    })
  }
})

function util_time(ts) {
  if (!ts) return ''
  const d = new Date(Number(ts))
  if (isNaN(d.getTime())) return ''
  const p = function (n) {
    return n < 10 ? '0' + n : '' + n
  }
  return p(d.getMonth() + 1) + '月' + p(d.getDate()) + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes())
}
