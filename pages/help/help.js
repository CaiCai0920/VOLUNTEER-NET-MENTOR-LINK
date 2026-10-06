const store = require('../../utils/store')

/**
 * 常见问题页（原「在线咨询」）
 * ------------------------------------------------------------------
 * 定位调整：这里不再做机器应答式对话，只做「使用规则 + 常见疑问」的
 * 速查。输入关键词即时筛选，命中即展开答案；具体专业问题回到大厅找
 * 对口学长学姐（真人），避免让人误以为平台在用 AI 代替学长答疑。
 */

const FAQ_SOURCE = [
  {
    no: '01',
    q: '怎么发布一条提问？',
    keys: '提问 发布 我要提问 怎么问 发问',
    a: '进入「答疑大厅」点「我要提问」，先选问题方向（按学院 / 学部），再写清楚问题描述，然后选一位对口学长学姐或公开求助，提交后直接进入聊天。'
  },
  {
    no: '02',
    q: '发出问题后多久会有回复？',
    keys: '回复 多久 时间 没回 响应',
    a: '公开提问由对口学长认领后回复，一般当天内会有响应；指定某位学长时，以对方在线时间为准。可以在大厅「在线答疑」里优先找头像旁标着「在线」的学长学姐。'
  },
  {
    no: '03',
    q: '已读 / 未读是怎么判定的？',
    keys: '已读 未读 回执 显示',
    a: '你发出的每一条消息下方都会单独标出「已读」或「未读」：对方打开这个会话后，你之前发的消息会逐条变成「已读」；对方读完之后才发出的新消息仍显示「未读」。聊天页顶部还会显示「对方已读至 时间」，方便确认。'
  },
  {
    no: '04',
    q: '为什么我的消息一直显示未读？',
    keys: '未读 为什么 不显示 一直',
    a: '「未读」表示对方还没有打开过这条会话。若这条提问是公开求助、还没有学长认领，则暂时没有对方可读，会一直显示「未读」；等学长认领并进入会话后即会转为「已读」。'
  },
  {
    no: '05',
    q: '专业方向为什么按学院选，能自己写吗？',
    keys: '专业 方向 学院 学部 自定义 自己写 大类',
    a: '方向按全校学院 / 学部（招生大类）划分，不做细分小专业，这样更容易匹配到对口的学长学姐。如果清单里没有你的学院（如新设学院、联合培养项目），在方向里选「其他（自行填写）」，手动填写即可。'
  },
  {
    no: '06',
    q: '「在线答疑」里的学长学姐是怎么来的？',
    keys: '在线 学长 学姐 在线答疑 谁',
    a: '「在线答疑」里展示的是当前在线的学长学姐本人，卡片上有他们的年级、学院和擅长话题，点「请教 TA」会带着这位学长直接进入提问页。是否在线由学长学姐的活跃状态决定。'
  },
  {
    no: '07',
    q: '学长学姐怎么认领我的提问？',
    keys: '认领 接单 学长做什么 工作台',
    a: '学长学姐在「答疑工作台」查看待认领的问题，点「我来答」即认领并进入会话回复；认领时会自动发一句开场白，让你知道有人接了。'
  },
  {
    no: '08',
    q: '实名信息会被别人看到吗？',
    keys: '实名 认证 学号 隐私 信息 安全 姓名',
    a: '真实姓名与学号仅用于校内身份核验，不会展示给其他用户，也不会出现在聊天内容与列表里；其他同学能看到的只有你填写的昵称、学院方向和问题内容。'
  },
  {
    no: '09',
    q: '怎么切换新生 / 学长身份？',
    keys: '身份 切换 演示 双端',
    a: '这是演示版：在「答疑大厅」顶部的身份切换条上，点「新生」或「学长学姐」即可整页换色切换视角；两个身份各自保留自己的提问与答疑记录。'
  },
  {
    no: '10',
    q: '遇到不当内容或想换人怎么办？',
    keys: '投诉 举报 换人 态度 不当 敏感',
    a: '可以在会话中停止交流并通过「我的」页反馈；也请不要在提问里写手机号、身份证号等敏感信息。平台内容为学长学姐个人经验分享，不代表学校官方意见。'
  }
]

// 双端主题（与其余页面保持一致：新生蓝 / 学长红）
const THEME = {
  asker: '#28314E',
  mentor: '#AA283A'
}

Page({
  data: {
    themeClass: 'theme-asker',
    query: '',
    keywords: ['怎么提问', '多久回复', '已读未读', '专业方向', '在线学长', '实名认证', '怎么认领', '切换身份'],
    faqs: [],
    total: FAQ_SOURCE.length
  },

  onLoad() {
    const self = this
    store.getMe().then(function (me) {
      if (!me) {
        wx.redirectTo({ url: '/pages/login/login' })
        return
      }
      const isMentor = me.role === 'mentor'
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: isMentor ? THEME.mentor : THEME.asker,
      fail: function () {}
    })
      self.setData({ themeClass: isMentor ? 'theme-mentor' : 'theme-asker' })
      self.filter('')
    })
  },

  onQueryInput(e) {
    const q = e.detail.value || ''
    this.setData({ query: q })
    this.filter(q)
  },

  onKwTap(e) {
    const k = e.currentTarget.dataset.k || ''
    this.setData({ query: k })
    this.filter(k)
  },

  onClear() {
    this.setData({ query: '' })
    this.filter('')
  },

  // 展开 / 收起单条
  onFaqTap(e) {
    const no = e.currentTarget.dataset.no
    const faqs = this.data.faqs.map(function (f) {
      return f.no === no ? { no: f.no, q: f.q, a: f.a, open: !f.open } : f
    })
    this.setData({ faqs: faqs })
  },

  // 关键词筛选：命中问题、答案或关键词即保留；搜索时自动展开答案
  filter(q) {
    const kw = (q || '').trim()
    const openMap = {}
    this.data.faqs.forEach(function (f) {
      if (f.open) openMap[f.no] = true
    })
    const list = FAQ_SOURCE.filter(function (f) {
      if (!kw) return true
      return (f.q + f.a + f.keys).indexOf(kw) > -1
    }).map(function (f) {
      return {
        no: f.no,
        q: f.q,
        a: f.a,
        open: !!kw || !!openMap[f.no]
      }
    })
    this.setData({ faqs: list })
  }
})
