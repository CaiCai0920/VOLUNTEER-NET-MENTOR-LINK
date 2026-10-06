const util = require('./util')
const { cloud } = require('./cloud')

/**
 * 社区数据层（云端版）
 * ------------------------------------------------------------------
 * 帖子存在云数据库 vm_posts 表（与 vm_users 同款公开共享板语义）：
 *   - media 字段存 JSON 字符串 [{ type: 'image'|'video', path: '云存储路径' }]
 *   - 图片 / 视频文件本体在云存储 shared 区（学生证照片同一套机制），
 *     展示时用 createSignedUrls 换临时签名链接
 *   - 表为空时写入几条演示帖，保证瀑布流不是空的（「清空演示数据」后重新生成）
 */

// 话题分区：发帖单选，第一版不做分区筛选（精简版）
const TOPICS = ['答疑', '生活', '校园', '美食', '穿搭', '运动', '游戏', '学习', '闲置']

// 表为空时写入的演示帖（无媒体，纯文字）
const SEED_POSTS = [
  {
    id: 'p1',
    user_id: 'm1',
    user_name: '林知夏',
    user_role: 'mentor',
    content: '开学第一次小组作业就抽到上台汇报，紧张到忘词呜呜。学妹学弟们别怕，PPT 讲不顺就当聊天，台下人都很友善的！',
    topic: '校园'
  },
  {
    id: 'p2',
    user_id: 'm5',
    user_name: '许清和',
    user_role: 'mentor',
    content: '发现食堂三楼新开的窗口，麻辣香锅可以自助选菜，人均 15 拿到扶墙出，速冲！',
    topic: '美食'
  },
  {
    id: 'p3',
    user_id: 'm2',
    user_name: '周砚',
    user_role: 'mentor',
    content: '图书馆四楼靠窗的位置下午光线超好，适合画图和赶图，来晚了真的抢不到（别问我怎么知道的）。',
    topic: '生活'
  },
  {
    id: 'p4',
    user_id: 'a1',
    user_name: '陈默',
    user_role: 'asker',
    content: '选课系统的开放时间有人清楚吗？想抢摄影基础课但是不知道几点放名额，求学长学姐指点抢课技巧！',
    topic: '答疑'
  }
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
    createdAt: Number(r.created_at) || 0,
    claimedBy: r.claimed_by || '',
    claimedAt: Number(r.claimed_at) || 0
  }
}

// 表为空时写入演示帖（首次启动 / 清空演示数据后）
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

// 旧库补种：演示答疑帖（已有则跳过）
function seedQAIfMissing() {
  return db()
    .from('vm_posts')
    .select('id')
    .eq('id', 'p4')
    .limit(1)
    .then(function (res) {
      const rows = unwrap(res) || []
      if (rows.length) return null
      const seed = Object.assign(
        {},
        SEED_POSTS.filter(function (p) { return p.id === 'p4' })[0],
        { media: '[]', created_at: Date.now() }
      )
      return db().from('vm_posts').insert(seed).then(function () { return null })
    })
    .catch(function () {
      return null
    })
}

// 拉最新帖子（瀑布流数据源）
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

// 发帖：写入一条帖子行（媒体已提前传好云存储，这里只存路径清单）
function createPost(me, options) {
  const row = {
    id: util.uid('p'),
    user_id: me ? me.id : '',
    user_name: me ? me.name : '同路人',
    user_role: me ? me.role : 'asker',
    content: options.content || '',
    topic: options.topic || '生活',
    media: JSON.stringify(options.media || []),
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

// 单帖读取（详情页数据源）
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

// 认领答疑帖：帖子 -> 答疑会话（asker=帖主 / mentor=认领人 / claimed），
// 写入 vm_threads 后学长工作台「我接的答疑」即可看到；帖子标记已认领防双抢
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

// ---------------------------------------------------------------- 媒体上传

// 从临时文件路径猜扩展名（chooseMedia 给的路径一般带后缀）
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

// 读临时文件为 ArrayBuffer
function readBuffer(tempFilePath) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({
      filePath: tempFilePath,
      success(res) {
        resolve(res.data)
      },
      fail(err) {
        reject(new Error('文件读取失败：' + (err && err.errMsg)))
      }
    })
  })
}

// 批量上传媒体到云存储 shared 区，返回 [{ type, path }]（逐个串行，进度好提示）
function uploadMedias(ownerId, files) {
  const list = files || []
  const out = []
  let chain = Promise.resolve(null)
  list.forEach(function (f, i) {
    chain = chain.then(function () {
      const ext = extOf(f.tempFilePath, f.fileType)
      const path = cloud.storage.sharedPath(
        ownerId || 'anon',
        'posts/' + Date.now() + '-' + i + '.' + ext
      )
      return readBuffer(f.tempFilePath).then(function (buffer) {
        return cloud.storage.upload(path, buffer, { contentType: contentTypeOf(ext) })
      }).then(function (up) {
        if (up && up.error) throw new Error(up.error.message || '上传失败')
        out.push({ type: f.fileType === 'video' ? 'video' : 'image', path: path })
        return null
      })
    })
  })
  return chain.then(function () {
    return out
  })
}

// ---------------------------------------------------------------- 签名链接

// 一批云存储路径 -> 临时签名链接（读不到就给空串，页面降级成纯文字卡）
function signedUrlsOf(paths) {
  const clean = (paths || []).filter(function (p) {
    return !!p
  })
  if (!clean.length) return Promise.resolve({})
  return cloud.storage
    .createSignedUrls(clean, 3600)
    .then(function (r) {
      const map = {}
      if (r && r.error) return map
      const list = (r && r.data) || []
      clean.forEach(function (p, i) {
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
      return {}
    })
}

module.exports = {
  TOPICS: TOPICS,
  seedIfEmpty: seedIfEmpty,
  seedQAIfMissing: seedQAIfMissing,
  listPosts: listPosts,
  createPost: createPost,
  getPost: getPost,
  claimPost: claimPost,
  uploadMedias: uploadMedias,
  signedUrlsOf: signedUrlsOf
}
