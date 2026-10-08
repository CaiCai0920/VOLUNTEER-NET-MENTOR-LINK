const util = require('./util')
const { cloud, hasCloudSession, getSessionUid } = require('./cloud')

/**
 * 社区数据层（云端版 v13）
 * ------------------------------------------------------------------
 * 云端表：
 *   vm_posts    帖子（media 存 JSON 路径清单；heat = 热度分，精选区排序依据）
 *   vm_follows  关注关系（follower_id -> followee_id），「关注」子栏目的数据源
 *   vm_infomap  信息广场知识节点（树形：root -> 话题分支 -> 关键词叶子）
 *
 * 社区三个子栏目：
 *   关注      —— 我关注的账号的动态流
 *   推荐      —— 精选（各话题热度高的帖子）+ 学科竞赛 / 保研申研 / 深大校园等分区
 *   信息广场  —— 树形知识网络，节点来自日常热帖的周期性信息整合
 */

// 社区讨论话题：发帖单选（含答疑 = 认领帖）
const TOPICS = [
  '答疑',
  '学科竞赛',
  '保研申研',
  '深大校园',
  '学习',
  '生活',
  '美食',
  '穿搭',
  '运动',
  '游戏',
  '闲置'
]

// 推荐页分区：第一个是精选（按热度聚合），其余是按话题切分的内容区
const RECO_ZONES = [
  { key: 'selected', name: '精选', en: 'SELECTED', topics: [] },
  { key: 'contest', name: '学科竞赛', en: 'COMPETITION', topics: ['学科竞赛'] },
  { key: 'grad', name: '保研申研', en: 'GRAD SCHOOL', topics: ['保研申研'] },
  { key: 'campus', name: '深大校园', en: 'SZU CAMPUS', topics: ['深大校园', '校园'] },
  { key: 'qa', name: '答疑互助', en: 'Q & A', topics: ['答疑'] },
  { key: 'study', name: '学习资源', en: 'STUDY', topics: ['学习'] },
  { key: 'life', name: '生活日常', en: 'DAILY', topics: ['生活', '美食', '穿搭', '运动', '游戏', '闲置'] }
]

// 表为空时写入的演示帖（无媒体，纯文字），heat 为演示热度分
const SEED_POSTS = [
  {
    id: 'p1',
    user_id: 'm1',
    user_name: '林知夏',
    user_role: 'mentor',
    content: '开学第一次小组作业就抽到上台汇报，紧张到忘词呜呜。学妹学弟们别怕，PPT 讲不顺就当聊天，台下人都很友善的！',
    topic: '校园',
    heat: 118
  },
  {
    id: 'p2',
    user_id: 'm5',
    user_name: '许清和',
    user_role: 'mentor',
    content: '发现食堂三楼新开的窗口，麻辣香锅可以自助选菜，人均 15 拿到扶墙出，速冲！',
    topic: '美食',
    heat: 96
  },
  {
    id: 'p3',
    user_id: 'm2',
    user_name: '周砚',
    user_role: 'mentor',
    content: '图书馆四楼靠窗的位置下午光线超好，适合画图和赶图，来晚了真的抢不到（别问我怎么知道的）。',
    topic: '生活',
    heat: 203
  },
  {
    id: 'p4',
    user_id: 'a1',
    user_name: '陈默',
    user_role: 'asker',
    content: '选课系统的开放时间有人清楚吗？想抢摄影基础课但是不知道几点放名额，求学长学姐指点抢课技巧！',
    topic: '答疑',
    heat: 268
  },
  {
    id: 'p5',
    user_id: 'm1',
    user_name: '林知夏',
    user_role: 'mentor',
    content: '数模校赛组队攻略：一个会建模、一个会写论文、一个会编程就够打省赛了。别等队友找齐再报名，先占位再补人，我去年就是拖到截止前一天才凑齐。',
    topic: '学科竞赛',
    heat: 241
  },
  {
    id: 'p6',
    user_id: 'm4',
    user_name: '陈叙',
    user_role: 'mentor',
    content: '保研时间线整理：大三下 3-4 月准备材料，6-8 月夏令营投递，9 月预推免。绩点 3.6 以上的同学请从现在开始攒科研经历，比刷绩点更有效。',
    topic: '保研申研',
    heat: 312
  },
  {
    id: 'p7',
    user_id: 'm3',
    user_name: '苏念',
    user_role: 'mentor',
    content: '蓝桥杯这两年省赛难度上来了，建议寒假先把往年真题刷两套再定方向。个人赛比组队赛更容易出成绩，新生可以试试。',
    topic: '学科竞赛',
    heat: 187
  },
  {
    id: 'p8',
    user_id: 'm6',
    user_name: '何予',
    user_role: 'mentor',
    content: '深大办事指南：校园卡补办在文科楼一楼，学生证补办要先去学院盖章，成绩单打印在图书馆一楼自助机，两分钟出。',
    topic: '深大校园',
    heat: 165
  },
  {
    id: 'p9',
    user_id: 'm3',
    user_name: '苏念',
    user_role: 'mentor',
    content: '高数期中救命指南：课本例题比习题册重要，把每章课后题的 A 组全做一遍，及格稳稳的。实在不行来找我，我当年也是从 60 分爬上来的。',
    topic: '学习',
    heat: 224
  },
  {
    id: 'p10',
    user_id: 'm2',
    user_name: '周砚',
    user_role: 'mentor',
    content: '设计类保研和理工科不一样，作品集占七成。研一学长建议：大二就开始攒项目，别等到大三下才开始做，时间根本不够。',
    topic: '保研申研',
    heat: 198
  }
]

// 首次关注演示：用户关注表为空时，默认关注这几位示例学长（保证「关注」栏目有内容）
const SEED_FOLLOWS = ['m1', 'm2', 'm4']

// 演示评论：表为空时写入（挂在演示帖下，让详情页评论区开箱有内容）
const SEED_COMMENTS = [
  { id: 'c1', post_id: 'p5', user_id: 'a1', user_name: '陈默', user_role: 'asker', content: '学姐好！建模零基础先用什么软件入门比较稳呀？' },
  { id: 'c2', post_id: 'p5', user_id: 'm1', user_name: '林知夏', user_role: 'mentor', content: 'Python 或 SPSS 二选一就够了，先把三人分工定下来比学软件更要紧。' },
  { id: 'c3', post_id: 'p5', user_id: 'm3', user_name: '苏念', user_role: 'mentor', content: '补一条：论文手别等到最后三天才动笔，数据一出就要开始写。' },
  { id: 'c4', post_id: 'p4', user_id: 'm4', user_name: '陈叙', user_role: 'mentor', content: '选课系统一般早上十点放名额，提前十分钟登进去等着，手速决定一切。' },
  { id: 'c5', post_id: 'p2', user_id: 'm2', user_name: '周砚', user_role: 'mentor', content: '亲测好吃，周三下午去人最少，麻辣香锅多要藕片。' },
  { id: 'c6', post_id: 'p6', user_id: 'm6', user_name: '何予', user_role: 'mentor', content: '时间线很准，补一句：夏令营材料里推荐信最早大二暑假就可以开始攒了。' },
  { id: 'c7', post_id: 'p3', user_id: 'a1', user_name: '陈默', user_role: 'asker', content: '四楼靠窗真的绝，就是期末周要七点去排队。' }
]

// 信息广场首期节点（表为空时写入；后续由周期性信息整合任务追加新批次）
const SEED_INFO_NODES = [
  { node_id: 'n_root', parent_id: '', label: '信息广场', kind: 'root', topic: '', weight: 0 },

  { node_id: 'n_contest', parent_id: 'n_root', label: '学科竞赛', kind: 'topic', topic: '学科竞赛', weight: 428 },
  { node_id: 'n_contest_1', parent_id: 'n_contest', label: '数模校赛 · 9 月组队', kind: 'leaf', topic: '学科竞赛', post_id: 'p5', weight: 241 },
  { node_id: 'n_contest_2', parent_id: 'n_contest', label: '蓝桥杯 · 寒假刷真题', kind: 'leaf', topic: '学科竞赛', post_id: 'p7', weight: 187 },
  { node_id: 'n_contest_3', parent_id: 'n_contest', label: '大创申报 · 每年 10 月', kind: 'leaf', topic: '学科竞赛', weight: 96 },

  { node_id: 'n_grad', parent_id: 'n_root', label: '保研申研', kind: 'topic', topic: '保研申研', weight: 510 },
  { node_id: 'n_grad_1', parent_id: 'n_grad', label: '夏令营投递 · 6-8 月', kind: 'leaf', topic: '保研申研', post_id: 'p6', weight: 312 },
  { node_id: 'n_grad_2', parent_id: 'n_grad', label: '预推免 · 9 月关键期', kind: 'leaf', topic: '保研申研', weight: 186 },
  { node_id: 'n_grad_3', parent_id: 'n_grad', label: '作品集占七成（设计类）', kind: 'leaf', topic: '保研申研', post_id: 'p10', weight: 198 },

  { node_id: 'n_campus', parent_id: 'n_root', label: '深大校园', kind: 'topic', topic: '深大校园', weight: 283 },
  { node_id: 'n_campus_1', parent_id: 'n_campus', label: '办事指南 · 补卡补证', kind: 'leaf', topic: '深大校园', post_id: 'p8', weight: 165 },
  { node_id: 'n_campus_2', parent_id: 'n_campus', label: '选课开放时段', kind: 'leaf', topic: '深大校园', weight: 118 },

  { node_id: 'n_qa', parent_id: 'n_root', label: '答疑互助', kind: 'topic', topic: '答疑', weight: 268 },
  { node_id: 'n_qa_1', parent_id: 'n_qa', label: '抢课技巧 · 高频提问', kind: 'leaf', topic: '答疑', post_id: 'p4', weight: 268 },
  { node_id: 'n_qa_2', parent_id: 'n_qa', label: '认领机制 · 几分钟到几小时', kind: 'leaf', topic: '答疑', weight: 154 },

  { node_id: 'n_study', parent_id: 'n_root', label: '学习资源', kind: 'topic', topic: '学习', weight: 224 },
  { node_id: 'n_study_1', parent_id: 'n_study', label: '高数期中 · 课本例题优先', kind: 'leaf', topic: '学习', post_id: 'p9', weight: 224 },

  { node_id: 'n_life', parent_id: 'n_root', label: '生活日常', kind: 'topic', topic: '生活', weight: 299 },
  { node_id: 'n_life_1', parent_id: 'n_life', label: '图书馆抢位 · 靠窗光好', kind: 'leaf', topic: '生活', post_id: 'p3', weight: 203 },
  { node_id: 'n_life_2', parent_id: 'n_life', label: '食堂新窗口 · 麻辣香锅', kind: 'leaf', topic: '美食', post_id: 'p2', weight: 96 }
]

function db() {
  return cloud.database
}

// 把 { data, error } 变成「有错就抛」
function unwrap(res) {
  if (res && res.error) throw res.error
  return res ? res.data : null
}

// 云端行 -> 页面用的驼峰结构
function mapPost(r) {
  let media = []
  try {
    media = JSON.parse(r.media || '[]') || []
  } catch (e) {
    media = []
  }
  return {
    id: r.id,
    userId: r.user_id || '',
    userName: r.user_name || '同路人',
    userRole: r.user_role || 'asker',
    content: r.content || '',
    topic: r.topic || '生活',
    media: media,
    heat: Number(r.heat) || 0,
    createdAt: Number(r.created_at) || 0,
    claimedBy: r.claimed_by || '',
    claimedAt: Number(r.claimed_at) || 0
  }
}

function mapInfoNode(r) {
  return {
    nodeId: r.node_id,
    parentId: r.parent_id || '',
    label: r.label || '',
    kind: r.kind || 'leaf',
    topic: r.topic || '',
    postId: r.post_id || '',
    weight: Number(r.weight) || 0,
    batch: r.batch || '',
    batchAt: Number(r.batch_at) || 0
  }
}

// ---------------------------------------------------------------- 种子数据

function seedIfEmpty() {
  return db()
    .from('vm_posts')
    .select('id')
    .limit(1)
    .then(function (res) {
      const rows = unwrap(res) || []
      if (rows.length) return null
      const seeds = SEED_POSTS.map(function (p) {
        return Object.assign({}, p, { media: '[]', created_at: Date.now() })
      })
      return db()
        .from('vm_posts')
        .insert(seeds)
        .then(function () {
          return null
        })
    })
    .catch(function (e) {
      console.error('[community] seed error:', e && e.message)
      return null
    })
}

// 逐条补种演示帖：已存在的不动，新增的演示帖自动补上（老库升级用）
function seedDemoPosts() {
  return db()
    .from('vm_posts')
    .select('id')
    .limit(200)
    .then(function (res) {
      const rows = unwrap(res) || []
      const have = {}
      rows.forEach(function (r) {
        have[r.id] = true
      })
      const missing = SEED_POSTS.filter(function (p) {
        return !have[p.id]
      })
      if (!missing.length) return null
      const base = Date.now() - missing.length * 3600 * 1000
      const seeds = missing.map(function (p, i) {
        return Object.assign({}, p, { media: '[]', created_at: base + i * 1800 * 1000 })
      })
      return db()
        .from('vm_posts')
        .insert(seeds)
        .then(function () {
          return null
        })
    })
    .catch(function () {
      return null
    })
}

// 兼容旧调用：演示答疑帖（已有则跳过）
function seedQAIfMissing() {
  return seedDemoPosts()
}

// 演示评论补种：表为空时整批写入（老库升级 / 新库初始化共用）
function seedCommentsIfEmpty() {
  return db()
    .from('vm_comments')
    .select('id')
    .limit(1)
    .then(function (res) {
      const rows = unwrap(res) || []
      if (rows.length) return null
      const base = Date.now() - 8 * 3600 * 1000
      const seeds = SEED_COMMENTS.map(function (c, i) {
        return Object.assign({}, c, { created_at: base + i * 1800 * 1000 })
      })
      return db()
        .from('vm_comments')
        .insert(seeds)
        .then(function () {
          return null
        })
    })
    .catch(function (e) {
      console.error('[community] comment seed error:', e && e.message)
      return null
    })
}

// 首期信息广场节点：表为空时写入
function seedInfoIfEmpty() {
  const batch = 'B01'
  const batchAt = Date.now()
  return db()
    .from('vm_infomap')
    .select('node_id')
    .limit(1)
    .then(function (res) {
      const rows = unwrap(res) || []
      if (rows.length) return null
      const seeds = SEED_INFO_NODES.map(function (n, i) {
        return {
          id: n.node_id + '_' + batch,
          node_id: n.node_id,
          parent_id: n.parent_id,
          label: n.label,
          kind: n.kind,
          topic: n.topic,
          post_id: n.post_id || '',
          weight: n.weight || 0,
          batch: batch,
          batch_at: batchAt,
          created_at: batchAt + i
        }
      })
      return db()
        .from('vm_infomap')
        .insert(seeds)
        .then(function () {
          return null
        })
    })
    .catch(function (e) {
      console.error('[community] infomap seed error:', e && e.message)
      return null
    })
}

// ---------------------------------------------------------------- 帖子

// 拉最新帖子（关注流兜底 / 推荐分区）
function listPosts(limit) {
  return db()
    .from('vm_posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit || 50)
    .then(function (res) {
      return (unwrap(res) || []).map(mapPost)
    })
}

// 精选：热度高的排前面（heat 为主，时间做次排序）
function listHotPosts(limit) {
  return db()
    .from('vm_posts')
    .select('*')
    .order('heat', { ascending: false })
    .limit(limit || 30)
    .then(function (res) {
      const list = (unwrap(res) || []).map(mapPost)
      list.sort(function (a, b) {
        if (b.heat !== a.heat) return b.heat - a.heat
        return b.createdAt - a.createdAt
      })
      return list
    })
}

// 按话题取一批帖子（推荐页各分区用）
function listPostsByTopics(topics, limit) {
  const list = topics || []
  if (!list.length) return Promise.resolve([])
  return db()
    .from('vm_posts')
    .select('*')
    .in('topic', list)
    .order('created_at', { ascending: false })
    .limit(limit || 60)
    .then(function (res) {
      return (unwrap(res) || []).map(mapPost)
    })
}

// 关注流：指定用户的帖子
function listPostsByUsers(userIds, limit) {
  const ids = (userIds || []).filter(function (x) {
    return !!x
  })
  if (!ids.length) return Promise.resolve([])
  return db()
    .from('vm_posts')
    .select('*')
    .in('user_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit || 60)
    .then(function (res) {
      return (unwrap(res) || []).map(mapPost)
    })
}

function createPost(me, options) {
  const row = {
    id: util.uid('p'),
    user_id: me ? me.id : '',
    user_name: me ? me.name : '同路人',
    user_role: me ? me.role : 'asker',
    content: options.content || '',
    topic: options.topic || '生活',
    media: JSON.stringify(options.media || []),
    heat: 0,
    created_at: Date.now()
  }
  return db()
    .from('vm_posts')
    .insert(row)
    .then(function (res) {
      unwrap(res)
      return mapPost(row)
    })
}

function getPost(id) {
  return db()
    .from('vm_posts')
    .select('*')
    .eq('id', id)
    .limit(1)
    .then(function (res) {
      const rows = unwrap(res) || []
      return rows.length ? mapPost(rows[0]) : null
    })
}

// 详情页浏览：热度 +1（精选区排序依据）
function bumpHeat(id) {
  if (!id) return Promise.resolve(null)
  return getPost(id)
    .then(function (post) {
      if (!post) return null
      return db()
        .from('vm_posts')
        .update({ heat: (post.heat || 0) + 1 })
        .eq('id', id)
        .then(function (res) {
          unwrap(res)
          return null
        })
    })
    .catch(function () {
      return null
    })
}

// 认领答疑帖：帖子 -> 答疑会话（asker=帖主 / mentor=认领人 / claimed）
function claimPost(post, me) {
  const now = Date.now()
  const threadRow = {
    id: util.uid('t'),
    asker_id: post.userId,
    asker_name: post.userName,
    major: '社区答疑',
    question: post.content,
    mentor_id: me ? me.id : '',
    mentor_name: me ? me.name : '',
    status: 'claimed',
    // 回指原帖：点帖子头像可直接找到这条会话（消息页归档也靠它回溯）
    post_id: post.id || '',
    created_at: now,
    updated_at: now
  }
  return db()
    .from('vm_threads')
    .insert(threadRow)
    .then(function (res) {
      unwrap(res)
      return db()
        .from('vm_posts')
        .update({ claimed_by: me ? me.id : '', claimed_at: now })
        .eq('id', post.id)
    })
    .then(function (res) {
      unwrap(res)
      return threadRow.id
    })
}

// ---------------------------------------------------------------- 评论

// 云端评论行 -> 页面用的驼峰结构
function mapComment(r) {
  return {
    id: r.id,
    postId: r.post_id || '',
    userId: r.user_id || '',
    userName: r.user_name || '同路人',
    userRole: r.user_role || 'asker',
    content: r.content || '',
    createdAt: Number(r.created_at) || 0
  }
}

// 拉某帖的评论（旧的在前，符合阅读顺序）
function listComments(postId) {
  if (!postId) return Promise.resolve([])
  return db()
    .from('vm_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(200)
    .then(function (res) {
      return (unwrap(res) || []).map(mapComment)
    })
    .catch(function () {
      return []
    })
}

// 发评论：post 只需要 { id }，me 来自 store.getMe()
function addComment(post, me, content) {
  const row = {
    id: util.uid('c'),
    post_id: post ? post.id : '',
    user_id: me ? me.id : '',
    user_name: me ? me.name : '同路人',
    user_role: me ? me.role : 'asker',
    content: content || '',
    created_at: Date.now()
  }
  return db()
    .from('vm_comments')
    .insert(row)
    .then(function (res) {
      unwrap(res)
      return mapComment(row)
    })
}

// ---------------------------------------------------------------- 关注关系

function listFollowing(meId) {
  if (!meId) return Promise.resolve([])
  return db()
    .from('vm_follows')
    .select('*')
    .eq('follower_id', meId)
    .limit(200)
    .then(function (res) {
      return (unwrap(res) || []).map(function (r) {
        return {
          id: r.id,
          followeeId: r.followee_id,
          name: r.followee_name || '',
          role: r.followee_role || 'mentor',
          createdAt: Number(r.created_at) || 0
        }
      })
    })
    .catch(function () {
      return []
    })
}

// 关注表为空时，默认关注几位示例学长（只在首屏演示用，可随时取关）
function ensureSeedFollows(meId) {
  if (!meId) return Promise.resolve([])
  return listFollowing(meId).then(function (list) {
    if (list.length) return list
    const now = Date.now()
    const rows = SEED_FOLLOWS.map(function (id, i) {
      const seed = SEED_POSTS.filter(function (p) {
        return p.user_id === id
      })[0]
      return {
        id: util.uid('f'),
        follower_id: meId,
        followee_id: id,
        followee_name: seed ? seed.user_name : '',
        followee_role: seed ? seed.user_role : 'mentor',
        created_at: now + i
      }
    })
    return db()
      .from('vm_follows')
      .insert(rows)
      .then(function (res) {
        unwrap(res)
        return rows.map(function (r) {
          return {
            id: r.id,
            followeeId: r.followee_id,
            name: r.followee_name,
            role: r.followee_role,
            createdAt: r.created_at
          }
        })
      })
      .catch(function () {
        return []
      })
  })
}

function isFollowing(meId, targetId) {
  if (!meId || !targetId) return Promise.resolve(false)
  return db()
    .from('vm_follows')
    .select('id')
    .eq('follower_id', meId)
    .eq('followee_id', targetId)
    .limit(1)
    .then(function (res) {
      return (unwrap(res) || []).length > 0
    })
    .catch(function () {
      return false
    })
}

function follow(meId, target) {
  if (!meId || !target || !target.id) return Promise.resolve(null)
  return isFollowing(meId, target.id).then(function (yes) {
    if (yes) return null
    return db()
      .from('vm_follows')
      .insert({
        id: util.uid('f'),
        follower_id: meId,
        followee_id: target.id,
        followee_name: target.name || '',
        followee_role: target.role || 'mentor',
        created_at: Date.now()
      })
      .then(function (res) {
        unwrap(res)
        return null
      })
  })
}

function unfollow(meId, targetId) {
  if (!meId || !targetId) return Promise.resolve(null)
  return db()
    .from('vm_follows')
    .delete()
    .eq('follower_id', meId)
    .eq('followee_id', targetId)
    .then(function (res) {
      unwrap(res)
      return null
    })
    .catch(function () {
      return null
    })
}

// ---------------------------------------------------------------- 信息广场

// 全部知识节点（云端表为空时回落到本地首期节点，保证界面不空）
function listInfoNodes() {
  return db()
    .from('vm_infomap')
    .select('*')
    .limit(500)
    .then(function (res) {
      const rows = (unwrap(res) || []).map(mapInfoNode)
      if (rows.length) return rows
      return SEED_INFO_NODES.map(mapInfoNode)
    })
    .catch(function () {
      return SEED_INFO_NODES.map(mapInfoNode)
    })
}

// 把平面节点拼成树：{ root, branches: [{ node, leaves: [...] }], batch, total }
function buildInfoGraph(nodes) {
  const list = nodes || []
  const root = list.filter(function (n) {
    return n.kind === 'root'
  })[0] || { nodeId: 'n_root', label: '信息广场', kind: 'root' }
  const branches = list
    .filter(function (n) {
      return n.kind === 'topic'
    })
    .sort(function (a, b) {
      return b.weight - a.weight
    })
    .map(function (n) {
      return {
        node: n,
        leaves: list
          .filter(function (x) {
            return x.parentId === n.nodeId
          })
          .sort(function (a, b) {
            return b.weight - a.weight
          })
      }
    })
  let batch = ''
  let batchAt = 0
  let total = 0
  list.forEach(function (n) {
    if (n.batchAt > batchAt) {
      batchAt = n.batchAt
      batch = n.batch
    }
    if (n.kind === 'leaf') total += 1
  })
  return { root: root, branches: branches, batch: batch, batchAt: batchAt, total: total }
}

// ---------------------------------------------------------------- 媒体上传

function extOf(tempFilePath, fileType) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(tempFilePath || '')
  if (m) return m[1].toLowerCase()
  return fileType === 'video' ? 'mp4' : 'jpg'
}

function contentTypeOf(ext) {
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4'
  return 'image/jpeg'
}

function readBuffer(tempFilePath) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({
      filePath: tempFilePath,
      // 必须显式指定 binary：readFile 不传 encoding 时按 utf8 读，
      // 返回的是字符串而非 ArrayBuffer，图片二进制内容会被破坏，
      // 上传后要么失败、要么存进去是个损坏文件。
      encoding: 'binary',
      success(res) {
        resolve(res.data)
      },
      fail(err) {
        reject(new Error('文件读取失败：' + (err && err.errMsg)))
      }
    })
  })
}

// 内联图片的压缩质量：40 在手机屏上仍清晰，单张能压到 100~200KB。
// 内联的图会跟着帖子行走数据库，列表页一次可能取回多条 media，
// 压得狠一点才不会让列表变卡。
const INLINE_IMAGE_QUALITY = 40

function readBase64(tempFilePath) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({
      filePath: tempFilePath,
      // 同样是编码陷阱：不传 encoding 会按 utf8 读，二进制当场损坏。
      encoding: 'base64',
      success(res) {
        resolve(res.data)
      },
      fail(err) {
        reject(new Error('文件读取失败：' + (err && err.errMsg)))
      }
    })
  })
}

function compressImage(src, quality) {
  return new Promise(function (resolve) {
    if (typeof wx.compressImage !== 'function') {
      resolve(src)
      return
    }
    wx.compressImage({
      src: src,
      quality: quality,
      // 限宽 720：社交场景足够清晰，又能把单张压到几十 KB。
      // 内联图会跟着帖子行走数据库，列表页一次取回多条，必须控住体积。
      // 基础库不支持该参数时会自动忽略，不影响压缩本身。
      compressedWidth: 720,
      success(res) {
        resolve((res && res.tempFilePath) || src)
      },
      // 压缩失败不是致命问题，退回原图继续
      fail() {
        resolve(src)
      }
    })
  })
}

// 单张图片 -> data URL（可被 <image src> 直接渲染）
function inlineImage(file) {
  return compressImage(file.tempFilePath, INLINE_IMAGE_QUALITY)
    .then(function (src) {
      return readBase64(src)
    })
    .then(function (b64) {
      return { type: 'image', path: 'data:image/jpeg;base64,' + b64 }
    })
}

// 无会话通道：媒体不进云存储，直接内联进帖子的 media 字段。
// 视频体积是图片的几十倍，内联会把帖子行撑到几十 MB，因此这里明确不支持。
function inlineMedias(list) {
  const out = []
  let chain = Promise.resolve(null)
  list.forEach(function (f) {
    chain = chain.then(function () {
      if (f.fileType === 'video') {
        return null
      }
      return inlineImage(f).then(function (item) {
        out.push(item)
        return null
      })
    })
  })
  return chain.then(function () {
    return out
  })
}

// 有会话通道：走官方云存储（cloud.storage.upload）。
// 它在小程序里能传二进制，靠的是 utils/cloud.js 里的 installBinaryUploadPatch
// —— SDK 自带的小程序 fetch 只接受字符串 body，ArrayBuffer 会被直接抛错。
function uploadToStorage(ownerId, list) {
  const out = []
  // 归属段必须用云端会话 uid：服务端按 shared/<ownerUid>/ 校验写权限，
  // 本地档案 id（me.id）不是会话身份，会被当作非本人 403。无会话时才退回 ownerId。
  return getSessionUid().then(function (uid) {
    const owner = uid || ownerId || 'anon'
    let chain = Promise.resolve(null)
    list.forEach(function (f, i) {
      chain = chain.then(function () {
        const ext = extOf(f.tempFilePath, f.fileType)
        // 路径交给 SDK 的 sharedPath 拼（与 scopePath 规则同源，避免两处规则漂移）
        const path = cloud.storage.sharedPath(
          owner,
          'posts/' + Date.now() + '-' + i + '.' + ext
        )
        return readBuffer(f.tempFilePath)
          .then(function (buffer) {
            return cloud.storage.upload(path, buffer, {
              contentType: contentTypeOf(ext)
            })
          })
          .then(function (res) {
            if (res && res.error) {
              throw new Error(res.error.message || '云存储上传失败')
            }
            out.push({
              type: f.fileType === 'video' ? 'video' : 'image',
              path: path
            })
            return null
          })
      })
    })
    return chain.then(function () {
      return out
    })
  })
}

/**
 * 媒体上传（全应用唯一入口）
 * ------------------------------------------------------------------
 * 两条通道，按当前有没有云端会话自动选：
 *
 *   有会话 → 云存储（cloud.storage.upload，符合 docs/接口清单.md 三·五）
 *   无会话 → 图片压缩后转 base64 内联进 vm_posts.media
 *
 * 为什么必须有内联这条：云存储的**读**和**写**都强制要求会话
 * （匿名调用一律 401 MISSING_CREDENTIALS，连 createSignedUrl 都不放行），
 * 而当前这套应用拿不到会话 —— 微信登录未开通，手机号验码换会话被服务端
 * 以 invalid_grant 拒绝。数据库则对匿名开放（RLS 策略 vm_posts_public
 * 对 anon 是 qual=true / with_check=true），是唯一立刻可用的通道。
 * 等微信登录打通、会话能拿到之后，会自动切回云存储，无需再改这里。
 */
function uploadMedias(ownerId, files) {
  const list = files || []
  return hasCloudSession()
    .catch(function () {
      return false
    })
    .then(function (hasSession) {
      if (hasSession) return uploadToStorage(ownerId, list)
      if (list.some(function (f) {
        return f.fileType === 'video'
      })) {
        wx.showToast({
          title: '当前状态下暂不支持发视频',
          icon: 'none',
          duration: 2500
        })
      }
      return inlineMedias(list)
    })
}

// ---------------------------------------------------------------- 签名链接

function signedUrlsOf(paths) {
  const clean = (paths || []).filter(function (p) {
    return !!p
  })
  if (!clean.length) return Promise.resolve({})

  // 分成两拨：内联图（data:）不需要签名，直接原样返回；
  // 只有云存储路径才要问云端要签名 URL。
  // 不分开的话，createSignedUrl 会因缺会话整体 401，连内联图也一起拿不到。
  const map = {}
  const storagePaths = []
  clean.forEach(function (p) {
    if (p.indexOf('data:') === 0) map[p] = p
    else storagePaths.push(p)
  })
  if (!storagePaths.length) return Promise.resolve(map)

  return cloud.storage
    .createSignedUrls(storagePaths, 3600)
    .then(function (r) {
      if (r && r.error) return map
      const list = (r && r.data) || []
      storagePaths.forEach(function (p, i) {
        const d = list[i]
        if (!d) return
        if (typeof d === 'string') {
          map[p] = d
        } else {
          map[p] = d.signedUrl || d.url || d.path || ''
        }
      })
      return map
    })
    .catch(function () {
      return map
    })
}

module.exports = {
  TOPICS: TOPICS,
  RECO_ZONES: RECO_ZONES,
  seedIfEmpty: seedIfEmpty,
  seedDemoPosts: seedDemoPosts,
  seedQAIfMissing: seedQAIfMissing,
  seedInfoIfEmpty: seedInfoIfEmpty,
  seedCommentsIfEmpty: seedCommentsIfEmpty,
  listComments: listComments,
  addComment: addComment,
  listPosts: listPosts,
  listHotPosts: listHotPosts,
  listPostsByTopics: listPostsByTopics,
  listPostsByUsers: listPostsByUsers,
  createPost: createPost,
  getPost: getPost,
  bumpHeat: bumpHeat,
  claimPost: claimPost,
  listFollowing: listFollowing,
  ensureSeedFollows: ensureSeedFollows,
  isFollowing: isFollowing,
  follow: follow,
  unfollow: unfollow,
  listInfoNodes: listInfoNodes,
  buildInfoGraph: buildInfoGraph,
  uploadMedias: uploadMedias,
  signedUrlsOf: signedUrlsOf
}
