const store = require('../../utils/store')
const {
  cloud,
  uploadBinary,
  sharedPath,
  ensureCloudSignIn,
  hasCloudSession
} = require('../../utils/cloud')

const ROLE_TEXT = { asker: '新生', mentor: '学长学姐' }
const CUSTOM_INDEX = store.MAJORS.indexOf(store.CUSTOM_MAJOR)

Page({
  data: {
    me: null,
    roleText: '',
    canBack: false,
    majors: store.MAJORS,
    majorIndex: 0,
    isCustom: false,
    customMajor: '',
    topicChips: [],
    agreed: false,
    submitting: false,
    form: { name: '', role: 'asker', major: store.MAJORS[0], realName: '', studentId: '' },
    // ---- 身份核验（03 区）----
    needVerify: true,
    phone: '',
    smsCode: '',
    codeSent: false,
    countdown: 0,
    sending: false,
    pendingOtp: null,
    photoTemp: '',
    // 资料是否已通过核验：为 true 时「补会话」模式可跳过学生证重传
    verifyApproved: false,
    // 是否为了发图而专门来补一个云端会话（?needSession=1 进入时为 true）
    needSession: false
  },

  onLoad(options) {
    // 海报页用自定义导航：从「我的 → 修改资料」进来时给一个返回入口
    const pages = getCurrentPages()
    this.setData({ canBack: pages.length > 1 })
    // 发帖页带 ?needSession=1 进来：明确为了发图要一个云端会话
    this.needSession = !!(options && options.needSession)
    this.setData({ needSession: this.needSession })
    const self = this
    // 先补一次云端会话：已核验用户不会重走短信核验，若不在这里补，
    // 会话可能一直是空的，之后发图会被存储网关拒（MISSING_CREDENTIALS）。
    ensureCloudSignIn()
      .catch(function () {
        return false
      })
      .then(function (ok) {
        self._signedIn = !!ok
        if (!ok) {
          // 静默登录失败通常意味着云端未开通本小程序的微信登录；
          // 此时短信核验仍能建立会话（verifyOtp 会落盘 token）。
          console.warn('[login] 云端静默登录未成功，如发图失败请确认云端微信登录开关')
        }
        return null
      })
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          self.setData({
            needVerify: true,
            topicChips: store.TOPICS.map(function (name) {
              return { name: name, on: false }
            })
          })
          wx.setNavigationBarTitle({ title: '登记身份' })
          return null
        }
        const chips = store.TOPICS.map(function (name) {
          return { name: name, on: (me.topics || '').indexOf(name) > -1 }
        })
        // 我的学院若不在全校大类清单里，说明是自行填写的 → 回到「自行填写」并回填
        const known = store.MAJORS.indexOf(me.major || '')
        const isCustom = known < 0 && !!me.major
        // 已通过核验的资料修改不再强制重新验证；未通过（含驳回）必须重新提交
        const needVerify = me.verifyStatus !== 'approved'
        const approved = me.verifyStatus === 'approved'
        self.setData({
          me: me,
          roleText: ROLE_TEXT[me.role] || '新生',
          agreed: true,
          needVerify: needVerify,
          verifyApproved: approved,
          phone: me.phone || '',
          topicChips: chips,
          majorIndex: isCustom ? CUSTOM_INDEX : Math.max(0, known),
          isCustom: isCustom,
          customMajor: isCustom ? me.major : '',
          form: {
            name: me.name,
            role: me.role,
            major: me.major,
            realName: me.realName || '',
            studentId: me.studentId || ''
          }
        })
        wx.setNavigationBarTitle({ title: '修改资料' })
        return null
      })
      .catch(function () {})
  },

  onUnload() {
    if (this.codeTimer) clearInterval(this.codeTimer)
  },

  onNameInput(e) {
    this.setData({ 'form.name': e.detail.value })
  },

  onRealNameInput(e) {
    this.setData({ 'form.realName': e.detail.value })
  },

  onStudentIdInput(e) {
    this.setData({ 'form.studentId': e.detail.value })
  },

  onRoleTap(e) {
    this.setData({ 'form.role': e.currentTarget.dataset.role })
  },

  onMajorChange(e) {
    const index = Number(e.detail.value)
    const isCustom = index === CUSTOM_INDEX
    this.setData({
      majorIndex: index,
      isCustom: isCustom,
      customMajor: isCustom ? this.data.customMajor : '',
      'form.major': store.MAJORS[index]
    })
  },

  onCustomMajorInput(e) {
    this.setData({ customMajor: e.detail.value })
  },

  onTopicTap(e) {
    const target = e.currentTarget.dataset.name
    const chips = this.data.topicChips.map(function (item) {
      return item.name === target ? { name: item.name, on: !item.on } : item
    })
    this.setData({ topicChips: chips })
  },

  onAgreeTap() {
    this.setData({ agreed: !this.data.agreed })
  },

  onBack() {
    wx.navigateBack({ delta: 1, fail: function () {} })
  },

  // ---------------- 身份核验：手机验证码 + 学生证照片 ----------------

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },

  onSmsInput(e) {
    this.setData({ smsCode: e.detail.value })
  },

  // 获取验证码：先本地校验手机号格式，再请求云端下发短信。
  // 发送成功后把 challenge 存起来，提交时用，重发倒计时 60 秒。
  onSendCode() {
    if (this.data.countdown > 0 || this.data.sending) return
    const phone = (this.data.phone || '').trim()
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' })
      return
    }
    const self = this
    this.setData({ sending: true })
    cloud.auth
      .sendOtp({ phone: phone })
      .then(function (sent) {
        self.setData({ sending: false })
        if (sent.error) {
          wx.showToast({ title: sent.error.message || '验证码发送失败', icon: 'none' })
          return
        }
        self.setData({
          codeSent: true,
          pendingOtp: {
            phone: phone,
            verificationId: sent.data.verificationId,
            isExistingUser: sent.data.isExistingUser
          }
        })
        wx.showToast({ title: '验证码已发送', icon: 'none' })
        let n = 60
        self.setData({ countdown: n })
        self.codeTimer = setInterval(function () {
          n -= 1
          self.setData({ countdown: n })
          if (n <= 0) clearInterval(self.codeTimer)
        }, 1000)
        return null
      })
      .catch(function () {
        self.setData({ sending: false })
      })
  },

  // 选学生证照片（拍摄或相册）
  onChoosePhoto() {
    const self = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success(res) {
        const file = res.tempFiles && res.tempFiles[0]
        if (file && file.tempFilePath) {
          self.setData({ photoTemp: file.tempFilePath })
        }
      },
      fail() {}
    })
  },

  // 核验资料齐不齐；齐则返回 { phone }，不齐则弹提示并返回 null
  checkVerifyFields() {
    // 「补会话」模式即使档案已核验过也要走短信，不能在这里提前放行
    const inVerifyFlow = this.data.needVerify || this.needSession
    if (!inVerifyFlow) return { phone: '' }
    const phone = (this.data.phone || '').trim()
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' })
      return null
    }
    const otp = this.data.pendingOtp
    if (!otp || otp.phone !== phone) {
      wx.showToast({ title: '请先获取验证码', icon: 'none' })
      return null
    }
    if (!this.data.smsCode) {
      wx.showToast({ title: '请输入短信验证码', icon: 'none' })
      return null
    }
    // 仅补会话（资料已核验过）：不再要求重传学生证，短信通过即可
    if (this.needSession && this.data.verifyApproved) return { phone: phone }
    if (!this.data.photoTemp) {
      wx.showToast({ title: '请上传学生证正面照片', icon: 'none' })
      return null
    }
    return { phone: phone }
  },

  // 短信验证通过后，把学生证照片传到云端存储（shared 区，仅登录用户与审核员可见）
  uploadIdPhoto(uid, tempPath) {
    return new Promise(function (resolve, reject) {
      wx.getFileSystemManager().readFile({
        filePath: tempPath,
        // 必须显式 binary：不传 encoding 时 readFile 按 utf8 读，返回字符串，
        // 会破坏图片二进制内容。
        encoding: 'binary',
        success(res) {
          resolve(res.data)
        },
        fail(err) {
          reject(new Error('照片读取失败：' + (err && err.errMsg)))
        }
      })
    }).then(function (buffer) {
      const path = sharedPath(uid, 'id-card/' + Date.now() + '.jpg')
      // 走二进制直传（同 community.uploadMedias 的原因）
      return uploadBinary(path, buffer, { contentType: 'image/jpeg' }).then(function () {
        return path
      })
    })
  },

  onSubmit() {
    const self = this
    if (this.data.submitting) return
    const form = this.data.form
    const name = (form.name || '').trim()
    if (!name) {
      wx.showToast({ title: '先写个昵称吧', icon: 'none' })
      return
    }
    // 实名认证校验：真实姓名 2-15 字；学号 6-12 位数字
    const realName = (form.realName || '').trim()
    if (realName.length < 2) {
      wx.showToast({ title: '请填写真实姓名（至少2个字）', icon: 'none' })
      return
    }
    const studentId = (form.studentId || '').trim()
    if (!/^\d{6,12}$/.test(studentId)) {
      wx.showToast({ title: '学号需为6-12位数字', icon: 'none' })
      return
    }
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选同意说明', icon: 'none' })
      return
    }
    // 专业方向：选了「其他（自行填写）」就用输入框里的内容
    const major = this.data.isCustom ? (this.data.customMajor || '').trim() : form.major
    if (!major) {
      wx.showToast({ title: '请填写你的学院 / 学部名称', icon: 'none' })
      return
    }
    const verify = this.checkVerifyFields()
    if (verify === null) return

    const topics = this.data.topicChips
      .filter(function (item) {
        return item.on
      })
      .map(function (item) {
        return item.name
      })
      .join(' ')
    const profile = {
      name: name,
      role: form.role,
      major: major,
      topics: topics,
      realName: realName,
      studentId: studentId
    }

    this.setData({ submitting: true })

    // 「补会话」模式：直接往下走短信核验，不再要求用户点第二次
    // （needVerify=false 但 needSession=true 时，核验区已展开，字段也已校验过）
    const sessionFlow = this.needSession && this.data.verifyApproved

    // 不需要核验、也不是补会话：正常保存。
    // 但若云端会话是空的（静默登录失败过），图片通道仍打不开 —— 转核验引导。
    if (!this.data.needVerify && !sessionFlow) {
      const self2 = this
      hasCloudSession().then(function (has) {
        if (has) {
          self2.doSave(profile)
          return
        }
        self2.setData({ needVerify: true, submitting: false })
        wx.showToast({
          title: '请完成短信核验以启用图片发送（资料已保留）',
          icon: 'none',
          duration: 3000
        })
      })
      return
    }

    // 需要核验：先短信验证本人 → 传学生证照片 → 存档案（进入待审核）
    const otp = this.data.pendingOtp
    const photoTemp = this.data.photoTemp
    const phone = verify.phone
    // 纯补会话模式：资料早已核验通过，只需短信换一个云端会话，不重传学生证、不改档案状态
    const sessionOnly = this.needSession && this.data.verifyApproved
    cloud.auth
      .verifyOtp({
        phone: otp.phone,
        verificationId: otp.verificationId,
        isExistingUser: otp.isExistingUser,
        token: this.data.smsCode
      })
      .then(function (completed) {
        if (completed.error) {
          self.setData({ submitting: false })
          const msg = completed.error.message || '验证码不对，再看看短信'
          console.error('[login] verifyOtp 失败:', msg, JSON.stringify(completed.error))
          // 用弹窗而非吐司：核验失败的原文要能截图反馈
          wx.showModal({
            title: '短信核验失败',
            content: String(msg).slice(0, 200),
            showCancel: false,
            confirmText: '知道了'
          })
          return null
        }
        if (sessionOnly) {
          // 会话已由 verifyOtp 落盘，直接收工回发帖页
          self.setData({ submitting: false })
          wx.showToast({ title: '核验完成，可以发图了', icon: 'success' })
          setTimeout(function () {
            wx.navigateBack({
              fail() {
                wx.reLaunch({ url: '/pages/index/index' })
              }
            })
          }, 800)
          return null
        }
        const uid =
          completed.data && completed.data.user && completed.data.user.id
            ? completed.data.user.id
            : 'anon_' + Date.now()
        return self.uploadIdPhoto(uid, photoTemp).then(function (photoPath) {
          profile.phone = phone
          profile.verifyStatus = 'pending'
          profile.idPhoto = photoPath
          self.doSave(profile)
          return null
        })
      })
      .catch(function (err) {
        self.setData({ submitting: false })
        const msg = (err && err.message) || '核验失败，请重试'
        console.error('[login] 核验流程异常:', msg)
        wx.showModal({
          title: '核验失败',
          content: String(msg).slice(0, 200),
          showCancel: false,
          confirmText: '知道了'
        })
      })
  },

  doSave(profile) {
    const self = this
    store
      .saveMe(profile)
      .then(function (me) {
        self.setData({ submitting: false })
        if (!me) {
          wx.showToast({ title: '保存失败，请重试', icon: 'none' })
          return null
        }
        getApp().globalData.me = me
        wx.showToast({
          title: me.verifyStatus === 'pending' ? '已提交，等待核验审核' : '已保存',
          icon: 'none'
        })
        setTimeout(function () {
          // 底部导航已移除，首页不再是 tab 页，改用 reLaunch 重置页面栈进入
          wx.reLaunch({ url: '/pages/index/index' })
        }, 700)
        return null
      })
      .catch(function () {
        self.setData({ submitting: false })
      })
  }
})
