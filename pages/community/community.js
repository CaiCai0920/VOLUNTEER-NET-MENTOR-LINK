const store = require('../../utils/store')
const util = require('../../utils/util')
const community = require('../../utils/community')

Page({
  // 底部导航：页面滚动时隐藏，停止 1.2s 后浮现（停留底部看消息时不被弹条打扰）
  onPageScroll() {
    if (this._tabTimer) clearTimeout(this._tabTimer)
    if (!this.data.tabsHide) this.setData({ tabsHide: true })
    this._tabTimer = setTimeout(() => {
      this.setData({ tabsHide: false })
    }, 1200)
  },

  data: {
    view: 'reco',
    ready: false,
    readyFollow: false,
    loading: true,
    // 推荐视图
    zones: [],
    allPosts: [],
    topicZones: [],
    activeZone: '',
    activeZoneData: null,
    colA: [],
    colB: [],
    // 关注视图
    following: [],
    followPosts: [],
    // 信息广场视图（进化树折叠行）
    graph: { root: {}, branches: [], batch: '', total: 0 },
    treeBranches: []
  },

  onShow() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh() {
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        self.me = me
        const view = self.data.view
        if (view === 'follow') return self.loadFollow(me)
        if (view === 'map') return self.loadMap()
        return self.loadReco()
      })
      .catch(function () {
        self.setData({ loading: false })
      })
  },

  // ---------------------------------------------------------- 帖子装饰

  // 帖子 -> 页面结构（封面/头像/时间/热度），并批量换签名链接（一次请求）
  decorate(posts) {
    const decorated = (posts || []).map(function (p) {
      const cover = p.media.length ? p.media[0] : null
      return {
        id: p.id,
        userId: p.userId,
        userName: p.userName,
        initial: util.initial(p.userName),
        userRole: p.userRole || 'asker',
        roleClass: (p.userRole || 'asker') === 'mentor' ? 'role-mentor' : '',
        content: p.content,
        topic: p.topic,
        heat: p.heat || 0,
        timeText: util.fromNow(p.createdAt),
        coverType: cover ? cover.type : '',
        coverPath: cover ? cover.path : '',
        coverUrl: '',
        previewUrls: [],
        isQA: p.topic === '答疑',
        claimed: !!p.claimedBy
      }
    })
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
        p.previewUrls = p.coverType === 'image' && p.coverUrl ? [p.coverUrl] : []
      })
      return decorated
    })
  },

  // ---------------------------------------------------------- 视图一：关注

  loadFollow(me) {
    const self = this
    return community.ensureSeedFollows(me.id).then(function (list) {
      const ids = list.map(function (x) {
        return x.followeeId
      })
      const following = list.map(function (x) {
        return Object.assign({}, x, { initial: util.initial(x.name) })
      })
      return community.listPostsByUsers(ids, 40).then(function (posts) {
        return self.decorate(posts).then(function (dec) {
          self.setData({
            following: following,
            followPosts: dec,
            readyFollow: true,
            ready: true,
            loading: false
          })
          return null
        })
      })
    })
  },

  // ---------------------------------------------------------- 视图二：推荐

  // 信息流嵌入式广告位（演示卡）：图文流第 3 张卡插一条招租广告，图用首页封面
  withAd(list) {
    const out = (list || []).slice()
    out.splice(2, 0, { isAd: true, id: 'ad-slot-reco' })
    return out
  },

  loadReco() {
    const self = this
    const zones = community.RECO_ZONES
    const perZone = zones.map(function (z) {
      return z.key === 'selected' ? community.listHotPosts(8) : community.listPostsByTopics(z.topics, 6)
    })
    return Promise.all(perZone.concat([community.listPosts(60)])).then(function (res) {
      const lists = res.slice(0, res.length - 1)
      const all = res[res.length - 1]
      const flat = []
      lists.forEach(function (l) {
        l.forEach(function (p) {
          flat.push(p)
        })
      })
      all.forEach(function (p) {
        flat.push(p)
      })
      return self.decorate(flat).then(function (dec) {
        const allDec = dec.slice(flat.length - all.length)
        let idx = 0
        const zoneDec = zones.map(function (z, i) {
          const len = lists[i].length
          const slice = dec.slice(idx, idx + len)
          idx += len
          return {
            key: z.key,
            no: (i + 1 < 10 ? '0' : '') + (i + 1),
            name: z.name,
            en: z.en,
            list: slice
          }
        })
        // 目录条：01 精选（全站混排）+ 02-07 话题；点谁，下方图文帖流就切到谁
        const firstZone = zoneDec[0] || null
        self.setData({
          zones: zoneDec,
          topicZones: zoneDec,
          allPosts: allDec,
          activeZone: firstZone ? firstZone.key : '',
          activeZoneData: firstZone,
          colA: self.withAd(allDec).filter(function (p, i) {
            return i % 2 === 0
          }),
          colB: self.withAd(allDec).filter(function (p, i) {
            return i % 2 === 1
          }),
          ready: true,
          loading: false
        })
      })
    })
  },

  // ---------------------------------------------------------- 视图三：信息广场

  // 目录条点选：精选=全站帖子混排；话题=只看该话题（同一套图文帖瀑布流）
  onZone(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.activeZone) return
    const hit = (this.data.topicZones || []).filter(function (z) {
      return z.key === key
    })[0]
    if (!hit) return
    const feed = this.withAd(hit.key === 'selected' ? (this.data.allPosts || []) : hit.list)
    this.setData({
      activeZone: key,
      activeZoneData: hit,
      colA: feed.filter(function (p, i) {
        return i % 2 === 0
      }),
      colB: feed.filter(function (p, i) {
        return i % 2 === 1
      })
    })
  },

  // 广告卡点击：招租提示
  onAd() {
    wx.showToast({ title: '广告位招租中 · 底图即广告', icon: 'none' })
  },

  loadMap() {
    const self = this
    return community.listInfoNodes().then(function (nodes) {
      const graph = community.buildInfoGraph(nodes)
      // 进化树折叠行：话题按热度排序为分支，默认前两个展开示范、其余收起
      const treeBranches = (graph.branches || []).map(function (b, i) {
        const leaves = (b.leaves || []).map(function (lf, j) {
          return {
            nodeId: lf.nodeId,
            label: lf.label,
            weight: lf.weight || 0,
            topic: lf.topic || '',
            postId: lf.postId || '',
            hot: (lf.weight || 0) >= 180 && j < 2
          }
        })
        return {
          nodeId: b.node.nodeId,
          label: b.node.label,
          weight: b.node.weight || 0,
          topic: b.node.topic || '',
          count: leaves.length,
          no: (i + 1 < 10 ? '0' : '') + (i + 1),
          open: i < 2,
          leaves: leaves
        }
      })
      self.setData({
        graph: {
          root: graph.root,
          branches: graph.branches,
          batch: graph.batch,
          total: graph.total
        },
        treeBranches: treeBranches,
        ready: true,
        loading: false
      })
      return null
    })
  },

  // ---------------------------------------------------------- 交互

  // 四个符号键：切换子栏目（发布键单独走 goPost）
  onView(e) {
    const view = e.currentTarget.dataset.view
    if (!view || view === this.data.view) return
    this.setData({ view: view, loading: true })
    this.refresh()
  },

  // 折叠/展开话题分支
  onToggleBranch(e) {
    const i = e.currentTarget.dataset.index
    const key = 'treeBranches[' + i + '].open'
    const cur = this.data.treeBranches[i] && this.data.treeBranches[i].open
    this.setData({ [key]: !cur })
  },

  // 整合条目：结论节点跳原帖，无帖时提示话题
  onKid(e) {
    const ds = e.currentTarget.dataset
    if (ds.post) {
      wx.navigateTo({ url: '/pages/post-detail/post-detail?id=' + ds.post })
      return
    }
    if (ds.topic) {
      wx.showToast({ title: '「' + ds.topic + '」暂无关联原帖', icon: 'none' })
    }
  },

  onTopTab(e) {
    const map = {
      home: '/pages/index/index',
      ask: '/pages/index/index?tab=ask',
      community: '/pages/community/community',
      messages: '/pages/messages/messages'
    }
    const url = map[e.currentTarget.dataset.tab]
    if (url) wx.redirectTo({ url: url })
  },

  goPost() {
    wx.navigateTo({ url: '/pages/post/post' })
  },

  onPreview(e) {
    const urls = e.currentTarget.dataset.urls || []
    const current = e.currentTarget.dataset.url || urls[0]
    if (current) wx.previewImage({ urls: urls, current: current })
  },

  // 点他人头像：直接进该帖的答疑聊天框；未认领的先认领再进（消息页会自动留下对话入口）
  onAvatar(e) {
    const id = e.currentTarget.dataset.id
    const claimed = e.currentTarget.dataset.claimed
    if (!id) return
    const self = this
    store
      .getMe()
      .then(function (me) {
        if (!me) {
          wx.redirectTo({ url: '/pages/login/login' })
          return null
        }
        // 学长认领他人求助帖 → 建会话；自己发的帖或已认领的帖 → 直接找已有会话进入
        const needClaim = !claimed && me.role === 'mentor'
        if (!needClaim) {
          wx.showToast({ title: '正在打开聊天…', icon: 'none' })
        }
        return community.getPost(id).then(function (post) {
          if (!post) {
            wx.showToast({ title: '帖子不存在', icon: 'none' })
            return null
          }
          if (post.claimedBy && post.userId === me.id) {
            wx.showToast({ title: '这是你自己的帖子', icon: 'none' })
            return null
          }
          const openChat = function (threadId) {
            wx.navigateTo({ url: '/pages/chat/chat?id=' + threadId })
            return null
          }
          // 已有会话：直接进
          return store.findThreadByPost(id, me.id).then(function (threadId) {
            if (threadId) return openChat(threadId)
            if (!needClaim) {
              // 我发起的帖子还没人认领：只能等学长接单
              wx.showToast({ title: '还没有学长认领，先等一会儿', icon: 'none' })
              return null
            }
            // 学长头一次点进来：认领并开聊，会话随即出现在消息页
            return community.claimPost(post, me).then(function (newThreadId) {
              self.refresh()
              return openChat(newThreadId)
            })
          })
        })
      })
      .catch(function () {
        wx.showToast({ title: '打开聊天失败，请重试', icon: 'none' })
      })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/post-detail/post-detail?id=' + id })
  },

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
