const store = require('../../utils/store')
const util = require('../../utils/util')

const CUSTOM_INDEX = store.MAJORS.indexOf(store.CUSTOM_MAJOR)

Page({
  data: {
    majors: store.MAJORS,
    majorIndex: 0,
    major: store.MAJORS[0],
    isCustom: false,
    customMajor: '',
    question: '',
    mentors: [],
    selectedId: '',
    submitting: false
  },

  onLoad(query) {
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        // 学长自己在列表里就不显示，避免自己给自己提问；在线的排前面
        return store.listMentors().then(function (allMentors) {
          const mentors = allMentors
            .filter(function (m) {
              return m.id !== me.id
            })
            .sort(function (a, b) {
              return (a.online === false ? 1 : 0) - (b.online === false ? 1 : 0)
            })
            .map(function (m) {
              return {
                id: m.id,
                name: m.name,
                grade: m.grade || '在读',
                major: m.major,
                topics: m.topics || '',
                online: m.online !== false,
                initial: util.initial(m.name)
              }
            })

          // 默认方向 = 我的学院；若我的学院是自定义填写的，则回到「自行填写」并带上原文
          const myMajor = me.major || ''
          const known = store.MAJORS.indexOf(myMajor)
          const custom = known < 0 && !!myMajor
          // 从「在线答疑」卡片点进来的学长：自动选中 TA（避免再点一次）
          const preset = (query && query.id) || ''
          const valid = preset && mentors.some(function (m) {
            return m.id === preset
          })

          self.setData({
            mentors: mentors,
            selectedId: valid ? preset : '',
            majorIndex: custom ? CUSTOM_INDEX : Math.max(0, known),
            major: custom ? store.CUSTOM_MAJOR : store.MAJORS[Math.max(0, known)],
            isCustom: custom,
            customMajor: custom ? myMajor : ''
          })
          return null
        })
      })
      .catch(function () {})
  },

  onMajorChange(e) {
    const index = Number(e.detail.value)
    const isCustom = index === CUSTOM_INDEX
    this.setData({
      majorIndex: index,
      major: store.MAJORS[index],
      isCustom: isCustom,
      customMajor: isCustom ? this.data.customMajor : ''
    })
  },

  onCustomMajorInput(e) {
    this.setData({ customMajor: e.detail.value })
  },

  // 实际用于建档的方向：选了「自行填写」就用输入框里的内容
  effectiveMajor() {
    const v = (this.data.customMajor || '').trim()
    return this.data.isCustom ? v : this.data.major
  },

  onQuestionInput(e) {
    this.setData({ question: e.detail.value })
  },

  onSelect(e) {
    this.setData({ selectedId: e.currentTarget.dataset.id || '' })
  },

  onSubmit() {
    const self = this
    if (this.data.submitting) return
    const question = (this.data.question || '').trim()
    if (question.length < 5) {
      wx.showToast({ title: '问题再写详细一点', icon: 'none' })
      return
    }
    const major = this.effectiveMajor()
    if (this.data.isCustom && major.length < 2) {
      wx.showToast({ title: '请填写你的学院 / 学部名称', icon: 'none' })
      return
    }
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        let mentorId = ''
        let mentorName = ''
        const selectedId = self.data.selectedId
        if (selectedId) {
          const picked = self.data.mentors.filter(function (m) {
            return m.id === selectedId
          })[0]
          if (picked) {
            mentorId = picked.id
            mentorName = picked.name
          }
        }
        self.setData({ submitting: true })
        return store
          .createThread({
            major: major,
            question: question,
            mentorId: mentorId,
            mentorName: mentorName
          })
          .then(function (thread) {
            if (!thread) {
              self.setData({ submitting: false })
              wx.showToast({ title: '发布失败，请重试', icon: 'none' })
              return null
            }
            // 把问题原文作为聊天里的第一条消息，方便学长一进来就看到上下文
            return store.addMessage(thread.id, question).then(function () {
              wx.showToast({ title: '已发布', icon: 'success' })
              setTimeout(function () {
                wx.redirectTo({ url: '/pages/chat/chat?id=' + thread.id })
              }, 400)
              return null
            })
          })
      })
      .catch(function () {
        self.setData({ submitting: false })
      })
  }
})
