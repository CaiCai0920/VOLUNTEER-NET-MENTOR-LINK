const store = require('../../utils/store')
const { cloud } = require('../../utils/cloud')

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
    photoTemp: ''
  },

  onLoad() {
    // 海报页用自定义导航：从「我的 → 修改资料」进来时给一个返回入口
    const pages = getCurrentPages()
    this.setData({ canBack: pages.length > 1 })
    const self = this
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
        self.setData({
          me: me,
          roleText: ROLE_TEXT[me.role] || '新生',
          agreed: true,
          needVerify: needVerify,
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
    if (!this.data.needVerify) return { phone: '' }
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
        success(res) {
          resolve(res.data)
        },
        fail(err) {
          reject(new Error('照片读取失败：' + (err && err.errMsg)))
        }
      })
    }).then(function (buffer) {
      const path = cloud.storage.sharedPath(uid, 'id-card/' + Date.now() + '.jpg')
      return cloud.storage
        .upload(path, buffer, { contentType: 'image/jpeg' })
        .then(function (up) {
          if (up && up.error) throw new Error(up.error.message || '照片上传失败')
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

    // 不需要重新核验：直接保存
    if (!this.data.needVerify) {
      this.doSave(profile)
      return
    }

    // 需要核验：先短信验证本人 → 传学生证照片 → 存档案（进入待审核）
    const otp = this.data.pendingOtp
    const photoTemp = this.data.photoTemp
    const phone = verify.phone
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
          wx.showToast({ title: completed.error.message || '验证码不对，再看看短信', icon: 'none' })
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
        wx.showToast({ title: (err && err.message) || '核验失败，请重试', icon: 'none' })
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
          wx.switchTab({ url: '/pages/index/index' })
        }, 700)
        return null
      })
      .catch(function () {
        self.setData({ submitting: false })
      })
  }
})
