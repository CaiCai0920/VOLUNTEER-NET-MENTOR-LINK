const util = require('./util')
const { cloud } = require('./cloud')

/**
 * 数据层（云端版）
 * ------------------------------------------------------------------
 * 数据全部存在 WorkBuddy 云端数据库，多台手机读写同一份数据：
 *   - 新生在 A 手机提问，学长在 B 手机的大厅里立刻能看到并认领；
 *   - 聊天消息、已读回执、身份档案全部跨设备同步。
 *
 * 身份模型：
 *   - 云端 vm_users 存所有用户档案（新生 / 学长）；
 *   - 每台手机用本地存储 vm_me 记「当前用的是哪个档案 id」；
 *   - 同一个人在新生 / 学长两个身份下仍是两个独立档案（凭学号+实名录找回），
 *     避免旧身份消息被判成"自己发的"导致气泡全挤右边。
 *
 * 注意：本文件所有数据方法都是异步的（返回 Promise），页面必须 await。
 */

const KEY_ME = 'vm_me'

// 提问时可选的对口方向：按全校学院 / 学部（招生大类）划分，不做细分小专业
const CUSTOM_MAJOR = '其他（自行填写）'

const MAJORS = [
  '计算机与软件学院（计算机类）',
  '人工智能学院',
  '电子与信息工程学院（电子信息类）',
  '机电与控制工程学院（机械 / 自动化类）',
  '物理与光电工程学院',
  '数学科学学院',
  '化学与环境工程学院',
  '材料学院',
  '建筑与城市规划学院（建筑类）',
  '土木与交通工程学院',
  '生命与海洋科学学院',
  '医学部',
  '心理学院',
  '经济学院',
  '管理学院',
  '微众银行金融科技学院',
  '深圳南特金融科技学院（中外合作）',
  '法学院',
  '政府管理学院',
  '人文学院',
  '外国语学院',
  '传播学院',
  '教育学部',
  '艺术学部（设计 / 美术 / 音乐 / 舞蹈 / 表演）',
  '高等研究院',
  CUSTOM_MAJOR
]

// 学长学姐可标注的擅长话题
const TOPICS = [
  '选课',
  '转专业',
  '保研',
  '社团',
  '作品集',
  '竞赛',
  '四六级',
  '校园生活'
]

// 首次启动写入的示例学长库（「我的 -> 清空演示数据」后重新生成）
// online：大厅「在线答疑」按此筛选；lastSeen：在线卡片的状态说明文案
const SEED_MENTORS = [
  { name: '林知夏', major: '计算机与软件学院（计算机类）', grade: '大二', topics: '选课 竞赛 保研', online: true, lastSeen: '刚刚活跃' },
  { name: '周砚', major: '建筑与城市规划学院（建筑类）', grade: '大三', topics: '转专业 保研 作品集', online: true, lastSeen: '2 分钟前活跃' },
  { name: '苏念', major: '经济学院', grade: '大二', topics: '选课 社团', online: false, lastSeen: '1 小时前活跃' },
  { name: '陈叙', major: '传播学院', grade: '大三', topics: '作品集 竞赛 保研', online: true, lastSeen: '5 分钟前活跃' },
  { name: '许清和', major: '外国语学院', grade: '大二', topics: '四六级 校园生活', online: true, lastSeen: '刚刚活跃' },
  { name: '何予', major: '艺术学部（设计 / 美术 / 音乐 / 舞蹈 / 表演）', grade: '大三', topics: '转专业 作品集 校园生活', online: false, lastSeen: '昨天活跃' }
]

// ---------------------------------------------------------------- 基础设施

let errorHandler = null

// 页面 / app 可注册全局错误提示：云端请求失败时统一弹 toast，不静默吞掉
function setErrorHandler(fn) {
  errorHandler = typeof fn === 'function' ? fn : null
}

function fail(e, fallback) {
  const msg = (e && e.message) || String(e || 'unknown')
  console.error('[store] cloud error:', msg)
  if (errorHandler) errorHandler(msg)
  return fallback
}

function db() {
  return cloud.database
}

// 云端行 -> 页面用的驼峰结构
function mapUser(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name || '',
    role: r.role || 'asker',
    major: r.major || '',
    grade: r.grade || '',
    topics: r.topics || '',
    realName: r.real_name || '',
    studentId: r.student_id || '',
    verified: r.verified !== false,
    online: r.online !== false,
    lastSeen: r.last_seen || '',
    // 在线状态看心跳时间戳，不看静态布尔值：只有真正打开着页面的人算在线
    lastActive: Number(r.last_active) || 0,
    // 身份核验：手机号 + 学生证照片，人工审核
    phone: r.phone || '',
    verifyStatus: r.verify_status || 'none',
    idPhoto: r.id_photo || '',
    reviewedAt: Number(r.reviewed_at) || 0,
    createdAt: Number(r.created_at) || 0
  }
}

// 在线判定窗口：心跳间隔 15 秒，窗口取 40 秒（掉线约 40 秒内自动消失）
const ONLINE_WINDOW_MS = 40 * 1000

function isOnlineNow(user, now) {
  if (!user) return false
  return now - (user.lastActive || 0) < ONLINE_WINDOW_MS
}

function mapThread(r) {
  if (!r) return null
  return {
    id: r.id,
    askerId: r.asker_id || '',
    askerName: r.asker_name || '',
    major: r.major || '',
    question: r.question || '',
    mentorId: r.mentor_id || '',
    mentorName: r.mentor_name || '',
    status: r.status || 'open',
    createdAt: Number(r.created_at) || 0,
    updatedAt: Number(r.updated_at) || 0
  }
}

function mapMessage(r) {
  if (!r) return null
  return {
    id: r.id,
    threadId: r.thread_id || '',
    senderId: r.sender_id || '',
    senderName: r.sender_name || '',
    senderRole: r.sender_role || 'asker',
    body: r.body || '',
    createdAt: Number(r.created_at) || 0
  }
}

// 把 { data, error } 变成「有错就抛」
function unwrap(res) {
  if (res && res.error) throw res.error
  return res ? res.data : null
}

// ---------------------------------------------------------------- 本地指针

function readLocalMeId() {
  try {
    const v = wx.getStorageSync(KEY_ME)
    return v || ''
  } catch (e) {
    return ''
  }
}

function writeLocalMeId(id) {
  try {
    wx.setStorageSync(KEY_ME, id || '')
  } catch (e) {
    // 本地指针写失败不影响云端数据
  }
}

// ---------------------------------------------------------------- 云端行操作

function fetchUser(id) {
  return db()
    .from('vm_users')
    .select('*')
    .eq('id', id)
    .maybeSingle()
    .then(function (res) {
      return mapUser(unwrap(res))
    })
}

function personKeyOf(u) {
  return (u.studentId || u.student_id || '') + '|' + (u.realName || u.real_name || u.name || '')
}

// ---------------------------------------------------------------- 初始化 / 种子数据

// 用户表为空时写入示例学长库（首次启动 / 清空演示数据后）
function seedIfEmpty() {
  return db()
    .from('vm_users')
    .select('id')
    .limit(1)
    .then(function (res) {
      const rows = unwrap(res) || []
      if (rows.length) return null
      const seeds = SEED_MENTORS.map(function (m, i) {
        return {
          id: 'm' + (i + 1),
          name: m.name,
          role: 'mentor',
          major: m.major,
          grade: m.grade,
          topics: m.topics,
          online: m.online,
          last_seen: m.lastSeen,
          verified: false
        }
      })
      return db()
        .from('vm_users')
        .insert(seeds)
        .then(function (res2) {
          unwrap(res2)
          return null
        })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// ---------------------------------------------------------------- 用户

function listUsers() {
  return db()
    .from('vm_users')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(200)
    .then(function (res) {
      return (unwrap(res) || []).map(mapUser)
    })
}

function listMentors() {
  return db()
    .from('vm_users')
    .select('*')
    .eq('role', 'mentor')
    .order('created_at', { ascending: true })
    .limit(200)
    .then(function (res) {
      return (unwrap(res) || []).map(mapUser)
    })
}

// 当前在线的学长学姐（大厅「在线答疑」用）
//   - 只算「近期有心跳」的人：对方关掉小程序超过窗口时间就自动从列表消失；
//   - 排除自己（含同一人的另一个身份档案），避免给自己提问。
function listOnlineMentors(me) {
  const meId = me && me.id
  const meKey = me ? personKeyOf(me) : ''
  const now = Date.now()
  return listMentors().then(function (users) {
    return users.filter(function (u) {
      if (!isOnlineNow(u, now)) return false
      if (meId && u.id === meId) return false
      if (meKey && personKeyOf(u) === meKey) return false
      return true
    })
  })
}

// 在线心跳：页面打开期间定时上报，服务端 last_active 更新即视为在线
function touchActive(userId) {
  if (!userId) return Promise.resolve(null)
  return db()
    .from('vm_users')
    .update({ last_active: Date.now() })
    .eq('id', userId)
    .then(function (res) {
      unwrap(res)
      return null
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// ---------------- 身份核验（手机号 + 学生证照片，人工审核） ----------------

// 待审核名单（审核台用）
function listPendingReviews() {
  return db()
    .from('vm_users')
    .select('*')
    .eq('verify_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)
    .then(function (res) {
      return (unwrap(res) || []).map(mapUser)
    })
    .catch(function (e) {
      return fail(e, [])
    })
}

// 审核结论：approved 通过 / rejected 驳回（驳回后用户重新提交即可再次进入待审核）
function setReviewStatus(userId, status) {
  const value = status === 'approved' ? 'approved' : 'rejected'
  return db()
    .from('vm_users')
    .update({ verify_status: value, reviewed_at: Date.now() })
    .eq('id', userId)
    .then(function (res) {
      unwrap(res)
      return null
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 审核员 = 云端最早注册的真实用户（排除示例学长，其 id 以 m 开头）。
// 第一个登记身份的人自动成为审核台的管理者。
function isReviewer(me) {
  if (!me) return Promise.resolve(false)
  return db()
    .from('vm_users')
    .select('id, created_at')
    .order('created_at', { ascending: true })
    .limit(50)
    .then(function (res) {
      const rows = (unwrap(res) || []).filter(function (r) {
        return String(r.id || '').charAt(0) === 'u'
      })
      return rows.length > 0 && rows[0].id === me.id
    })
    .catch(function (e) {
      return fail(e, false)
    })
}

// 当前设备登录的档案：本地指针 + 云端档案行
function getMe() {
  const meId = readLocalMeId()
  if (!meId) return Promise.resolve(null)
  return fetchUser(meId).catch(function (e) {
    return fail(e, null)
  })
}

// 建立或更新当前用户档案；返回最新档案（异步）
//
// 分侧关键：同一个人在「新生 / 学长」两个身份下必须是两个独立档案（两个 ID）。
//   - 身份没变 → 原地更新；
//   - 身份变了 → 凭实名信息（学号+姓名+身份）在云端找回该身份下已有的档案，
//     找不到就新建一个。来回切换时各自提问/答疑记录都能保留。
function userFieldsOf(profile) {
  const fields = {
    name: profile.name || '',
    role: profile.role === 'mentor' ? 'mentor' : 'asker',
    major: profile.major || '',
    grade: profile.role === 'mentor' ? '在读' : '大一',
    topics: profile.topics || '',
    real_name: profile.realName || '',
    student_id: profile.studentId || '',
    verified: true,
    // 保存档案同时上报一次心跳：刚登记完就算在线，不用等下一个心跳周期
    last_active: Date.now()
  }
  // 核验字段只在明确提供时才写入，避免切身份等场景误清掉已提交的审核资料
  if (profile.phone !== undefined) fields.phone = profile.phone || ''
  if (profile.verifyStatus !== undefined) fields.verify_status = profile.verifyStatus || 'none'
  if (profile.idPhoto !== undefined) fields.id_photo = profile.idPhoto || ''
  return fields
}

function saveMe(profile) {
  const fields = userFieldsOf(profile)
  const meId = readLocalMeId()
  const ensure = meId ? fetchUser(meId).catch(function () { return null }) : Promise.resolve(null)
  return ensure
    .then(function (me) {
      if (me && me.role === fields.role) {
        // 身份没变：原地更新档案
        return db()
          .from('vm_users')
          .update(fields)
          .eq('id', me.id)
          .then(function () {
            return Object.assign({}, me, fields)
          })
      }
      // 身份变了（或首次登记）：凭学号+实名录找回目标身份下的档案
      const byId = profile.studentId
        ? db()
            .from('vm_users')
            .select('*')
            .eq('role', fields.role)
            .eq('student_id', profile.studentId)
            .limit(50)
        : Promise.resolve({ data: [], error: null })
      return byId.then(function (res) {
        const rows = unwrap(res) || []
        let target = null
        rows.forEach(function (r) {
          const u = mapUser(r)
          if (!target && u.id !== (me && me.id) && personKeyOf(u) === personKeyOf(profile)) {
            target = u
          }
        })
        if (target) {
          return db()
            .from('vm_users')
            .update(fields)
            .eq('id', target.id)
            .then(function () {
              writeLocalMeId(target.id)
              return Object.assign({}, target, fields)
            })
        }
        const row = Object.assign({}, fields, {
          id: util.uid('u'),
          online: fields.role === 'mentor',
          last_seen: '刚刚活跃'
        })
        return db()
          .from('vm_users')
          .insert(row)
          .then(function (res2) {
            unwrap(res2)
            writeLocalMeId(row.id)
            return mapUser(row)
          })
      })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

function clearMe() {
  writeLocalMeId('')
}

// 演示用：直接切换成学长库里某位学长
function switchToMentor(mentorId) {
  return fetchUser(mentorId)
    .then(function (found) {
      if (found) writeLocalMeId(found.id)
      return found
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 演示用：在不换人的前提下，把「当前这个人」在新生 / 学长两个身份间互切。
// 与 saveMe 同样的分侧原则：两个身份必须是两个独立档案（两个 ID），
// 优先凭实名信息（学号+姓名）找回目标身份下已有的档案，没有则新建一份。
function switchRole(targetRole) {
  const role = targetRole === 'mentor' ? 'mentor' : 'asker'
  return getMe()
    .then(function (me) {
      if (!me) return null
      if (me.role === role) return me
      const fields = {
        name: me.name,
        role: role,
        major: me.major,
        grade: role === 'mentor' ? '在读' : me.grade || '大一',
        topics: role === 'mentor' ? me.topics || me.major || '专业答疑' : '',
        real_name: me.realName || '',
        student_id: me.studentId || '',
        verified: me.verified !== false
      }
      const byId = me.studentId
        ? db()
            .from('vm_users')
            .select('*')
            .eq('role', role)
            .eq('student_id', me.studentId)
            .limit(50)
        : Promise.resolve({ data: [], error: null })
      return byId.then(function (res) {
        const rows = unwrap(res) || []
        let target = null
        rows.forEach(function (r) {
          const u = mapUser(r)
          if (!target && u.id !== me.id && personKeyOf(u) === personKeyOf(me)) {
            target = u
          }
        })
        if (target) {
          writeLocalMeId(target.id)
          return target
        }
        const row = Object.assign({}, fields, {
          id: util.uid('u'),
          online: role === 'mentor',
          last_seen: '刚刚活跃'
        })
        return db()
          .from('vm_users')
          .insert(row)
          .then(function (res2) {
            unwrap(res2)
            writeLocalMeId(row.id)
            return mapUser(row)
          })
      })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 演示用：切换回一个新生账号（优先找回"当前这个人"的新生档案，没有就新建）
function switchToAsker(name) {
  return getMe()
    .then(function (me) {
      return db()
        .from('vm_users')
        .select('*')
        .eq('role', 'asker')
        .order('created_at', { ascending: true })
        .limit(200)
        .then(function (res) {
          const askers = (unwrap(res) || []).map(mapUser)
          let asker = null
          if (me) {
            const key = personKeyOf(me)
            askers.forEach(function (u) {
              if (!asker && u.id !== me.id && personKeyOf(u) === key) asker = u
            })
          }
          if (!asker) asker = askers[0]
          if (!asker) {
            const row = {
              id: util.uid('u'),
              name: name || '蔡雨凡',
              role: 'asker',
              major: '设计学类（尚未分方向）',
              grade: '大一',
              topics: ''
            }
            return db()
              .from('vm_users')
              .insert(row)
              .then(function (res2) {
                unwrap(res2)
                writeLocalMeId(row.id)
                return mapUser(row)
              })
          }
          writeLocalMeId(asker.id)
          return asker
        })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// ---------------------------------------------------------------- 提问会话

function listThreads() {
  return db()
    .from('vm_threads')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(100)
    .then(function (res) {
      return (unwrap(res) || []).map(mapThread)
    })
}

function getThread(id) {
  return db()
    .from('vm_threads')
    .select('*')
    .eq('id', id)
    .maybeSingle()
    .then(function (res) {
      return mapThread(unwrap(res))
    })
}

function updateThread(id, patch) {
  const row = {}
  if (patch.mentorId !== undefined) row.mentor_id = patch.mentorId
  if (patch.mentorName !== undefined) row.mentor_name = patch.mentorName
  if (patch.status !== undefined) row.status = patch.status
  if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt
  return db()
    .from('vm_threads')
    .update(row)
    .eq('id', id)
    .then(function (res) {
      unwrap(res)
      return getThread(id)
    })
}

/**
 * 创建一条提问会话
 * mentorId 为空表示「公开待认领」，谁都能接
 */
function createThread(options) {
  return getMe()
    .then(function (me) {
      const now = Date.now()
      const row = {
        id: util.uid('t'),
        asker_id: me ? me.id : '',
        asker_name: me ? me.name : '匿名新生',
        major: options.major,
        question: options.question,
        mentor_id: options.mentorId || '',
        mentor_name: options.mentorName || '',
        status: options.mentorId ? 'claimed' : 'open',
        created_at: now,
        updated_at: now
      }
      return db()
        .from('vm_threads')
        .insert(row)
        .then(function (res) {
          unwrap(res)
          return mapThread(row)
        })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 学长认领：只允许把「待认领」状态的会话认领走（条件更新防双抢）
function claimThread(threadId, mentor) {
  return db()
    .from('vm_threads')
    .update({
      mentor_id: mentor.id,
      mentor_name: mentor.name,
      status: 'claimed',
      updated_at: Date.now()
    })
    .eq('id', threadId)
    .eq('status', 'open')
    .then(function () {
      return getThread(threadId)
    })
}

function closeThread(threadId) {
  return updateThread(threadId, { status: 'closed', updatedAt: Date.now() })
}

function threadsAsAsker(meId) {
  return db()
    .from('vm_threads')
    .select('*')
    .eq('asker_id', meId)
    .order('updated_at', { ascending: false })
    .limit(100)
    .then(function (res) {
      return (unwrap(res) || []).map(mapThread)
    })
}

function threadsAsMentor(meId) {
  return db()
    .from('vm_threads')
    .select('*')
    .eq('mentor_id', meId)
    .order('updated_at', { ascending: false })
    .limit(100)
    .then(function (res) {
      return (unwrap(res) || []).map(mapThread)
    })
}

function threadsOpen() {
  return db()
    .from('vm_threads')
    .select('*')
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(100)
    .then(function (res) {
      return (unwrap(res) || []).map(mapThread)
    })
}

// ---------------------------------------------------------------- 消息

// 会话内消息：按时间排序（同毫秒按 id 兜底），并归一化序号 seq（1 起，内存计算）
function listMessages(threadId) {
  return db()
    .from('vm_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(500)
    .then(function (res) {
      const list = (unwrap(res) || []).map(mapMessage)
      list.sort(function (a, b) {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
        return a.id > b.id ? 1 : -1
      })
      list.forEach(function (m, i) {
        m.seq = i + 1
      })
      return list
    })
}

function lastMessageOf(threadId) {
  return listMessages(threadId).then(function (list) {
    return list.length ? list[list.length - 1] : null
  })
}

function addMessage(threadId, body) {
  return getMe()
    .then(function (me) {
      const message = {
        id: util.uid('msg'),
        thread_id: threadId,
        sender_id: me ? me.id : '',
        sender_name: me ? me.name : '匿名',
        sender_role: me ? me.role : 'asker',
        body: body,
        created_at: Date.now()
      }
      return db()
        .from('vm_messages')
        .insert(message)
        .then(function (res) {
          unwrap(res)
          // 有人回复后，把会话从「待认领」推进到「进行中」
          return getThread(threadId).then(function (thread) {
            if (!thread) return mapMessage(message)
            const patch = { updatedAt: message.created_at }
            if (thread.status === 'open' && me && me.role === 'mentor') {
              patch.mentorId = me.id
              patch.mentorName = me.name
              patch.status = 'claimed'
            }
            return updateThread(threadId, patch).then(function () {
              return mapMessage(message)
            })
          })
        })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

function countMessages(threadId) {
  return listMessages(threadId).then(function (list) {
    return list.length
  })
}

// ---------------------------------------------------------------- 已读 / 未读

// 某人在某会话里的已读指针：{ seq, at }（云端 vm_reads 表，(thread_id,user_id) 唯一）
function readStateOf(threadId, userId) {
  if (!threadId || !userId) return Promise.resolve({ seq: 0, at: 0 })
  return db()
    .from('vm_reads')
    .select('*')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .maybeSingle()
    .then(function (res) {
      const row = unwrap(res)
      return { seq: row ? Number(row.seq) || 0 : 0, at: row ? Number(row.at) || 0 : 0 }
    })
    .catch(function (e) {
      return fail(e, { seq: 0, at: 0 })
    })
}

// 一次拉多条已读指针（列表页用，避免逐会话查询）
function readStatesOf(threadIds, userId) {
  const map = {}
  if (!userId || !threadIds.length) return Promise.resolve(map)
  return db()
    .from('vm_reads')
    .select('*')
    .eq('user_id', userId)
    .in('thread_id', threadIds)
    .limit(500)
    .then(function (res) {
      ;(unwrap(res) || []).forEach(function (r) {
        map[r.thread_id] = { seq: Number(r.seq) || 0, at: Number(r.at) || 0 }
      })
      return map
    })
    .catch(function (e) {
      return fail(e, map)
    })
}

// 我打开了会话：把「我读到第几条」写进云端（只增不减）
function markRead(threadId, userId) {
  if (!threadId || !userId) return Promise.resolve(null)
  return listMessages(threadId)
    .then(function (list) {
      const total = list.length
      if (!total) return null
      return readStateOf(threadId, userId).then(function (prev) {
        if (total <= prev.seq) return null
        return db()
          .from('vm_reads')
          .upsert(
            { thread_id: threadId, user_id: userId, seq: total, at: Date.now() },
            { onConflict: 'thread_id,user_id' }
          )
          .then(function (res) {
            unwrap(res)
            return null
          })
      })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 某会话里，对方发来但「我」还没读过的消息条数
function unreadCount(threadId, meId) {
  return Promise.all([listMessages(threadId), readStateOf(threadId, meId)]).then(function (out) {
    const list = out[0]
    const ptr = out[1]
    return list.filter(function (m) {
      return m.senderId !== meId && m.seq > ptr.seq
    }).length
  })
}

// 兼容旧调用：对方最后一次阅读的时间戳
function lastReadAt(threadId, otherUserId) {
  return readStateOf(threadId, otherUserId).then(function (p) {
    return p.at
  })
}

// ---------------------------------------------------------------- 大厅聚合

// 一次拉齐大厅需要的数据：我的提问 / 待认领 / 我认领的 + 每条会话的
// 最后一条消息、未读数、我的已读指针（避免列表页逐会话发请求）
function loadBoard(me) {
  const meId = me.id
  return listThreads()
    .then(function (threads) {
      const ids = threads.map(function (t) {
        return t.id
      })
      // 每条会话里「对方」的档案 id：我是提问方 → 对方是认领的学长；反之亦然
      const otherIds = []
      const otherOf = {}
      threads.forEach(function (t) {
        const other = t.askerId === meId ? t.mentorId : t.askerId
        otherOf[t.id] = other
        if (other && otherIds.indexOf(other) < 0) otherIds.push(other)
      })
      const messagesPromise = ids.length
        ? db()
            .from('vm_messages')
            .select('*')
            .in('thread_id', ids)
            .order('created_at', { ascending: true })
            .limit(800)
            .then(function (res) {
              return (unwrap(res) || []).map(mapMessage)
            })
        : Promise.resolve([])
      const peerReadsPromise =
        ids.length && otherIds.length
          ? db()
              .from('vm_reads')
              .select('*')
              .in('thread_id', ids)
              .in('user_id', otherIds)
              .limit(500)
              .then(function (res) {
                const map = {}
                ;(unwrap(res) || []).forEach(function (r) {
                  map[r.thread_id] = { seq: Number(r.seq) || 0, at: Number(r.at) || 0 }
                })
                return map
              })
          : Promise.resolve({})
      return Promise.all([threads, messagesPromise, readStatesOf(ids, meId), peerReadsPromise])
    })
    .then(function (out) {
      const threads = out[0]
      const allMessages = out[1]
      const myReads = out[2]
      const peerReads = out[3]
      const byThread = {}
      allMessages.forEach(function (m) {
        if (!byThread[m.threadId]) byThread[m.threadId] = []
        byThread[m.threadId].push(m)
      })
      const decorated = threads.map(function (t) {
        const list = (byThread[t.id] || []).slice().sort(function (a, b) {
          if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
          return a.id > b.id ? 1 : -1
        })
        list.forEach(function (m, i) {
          m.seq = i + 1
        })
        const ptr = myReads[t.id] || { seq: 0, at: 0 }
        const unread = list.filter(function (m) {
          return m.senderId !== meId && m.seq > ptr.seq
        }).length
        return {
          thread: t,
          messages: list,
          myRead: ptr,
          unread: unread,
          peerRead: peerReads[t.id] || { seq: 0, at: 0 }
        }
      })
      return {
        myThreads: decorated.filter(function (d) {
          return d.thread.askerId === meId
        }),
        openThreads: decorated.filter(function (d) {
          return d.thread.status === 'open'
        }),
        mentorThreads: decorated.filter(function (d) {
          return d.thread.mentorId === meId
        }),
        decorated: decorated
      }
    })
    .catch(function (e) {
      return fail(e, { myThreads: [], openThreads: [], mentorThreads: [], decorated: [] })
    })
}

// ---------------------------------------------------------------- 统计 / 重置

function stats(meId) {
  return Promise.all([threadsAsAsker(meId), threadsAsMentor(meId)])
    .then(function (out) {
      const asMentor = out[1]
      const counts = asMentor.map(function (t) {
        return countMessages(t.id)
      })
      return Promise.all(counts).then(function (nums) {
        let answers = 0
        nums.forEach(function (n) {
          answers += n
        })
        return { askCount: out[0].length, answerThreads: asMentor.length, messageCount: answers }
      })
    })
    .catch(function (e) {
      return fail(e, { askCount: 0, answerThreads: 0, messageCount: 0 })
    })
}

// ---------------------------------------------------------------- 社区帖子 【已废弃】
//
// ⚠️ 页面请一律改用 require('../utils/community')，不要再用下面这些函数。
//    社区帖子的唯一数据层是 utils/community.js —— 字段更全，还支持
//    图片/视频上传（uploadMedias）与云存储签名链接（signedUrlsOf）。
//    本区块与之功能重复，且已核实**没有任何页面调用**，保留只为兼容历史引用，
//    后续可整体删除。
//
//    两者的差别（容易踩坑）：
//      · store.listPosts(话题)   —— 按话题筛选
//        community.listPosts(条数) —— 按条数限制，不筛话题
//      · community.js 的 media 是 [{type,path}]，本区块按纯路径数组处理
// vm_posts 是组长那边已经在线的表（2026-10-06 导出的数据里有 4 条真实记录）。
// 下面所有字段严格按照线上真实数据来写，不靠猜：
//   id / user_id / user_name / user_role / content / media / topic
//   created_at / claimed_at / claimed_by
//
// 两个坑要记住：
// 1) media 在库里存的是 JSON 字符串（比如 "[]"），取出来要解析；坏数据按空数组兜住
// 2) 帖子用的话题（校园 / 美食 / 生活 / 答疑…）和上面的 TOPICS（选课 / 保研 /…）
//    不是同一套，所以这里不校验话题值 —— 传什么就筛什么
const POST_ALL = '全部'

function parseMedia(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function mapPost(r) {
  if (!r) return null
  return {
    id: r.id,
    userId: r.user_id || '',
    userName: r.user_name || '',
    userRole: r.user_role || 'asker',
    content: r.content || '',
    media: parseMedia(r.media),
    topic: r.topic || '校园',
    createdAt: Number(r.created_at) || 0,
    // 认领：帖子可以被学长接走去回答，没人接时这两项为空
    claimedBy: r.claimed_by || '',
    claimedAt: Number(r.claimed_at) || 0
  }
}

// 帖子列表：不传 topic 或传「全部」= 不筛选
function listPosts(topic) {
  let q = db()
    .from('vm_posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (topic && topic !== POST_ALL) q = q.eq('topic', topic)
  return q
    .then(function (res) {
      return (unwrap(res) || []).map(mapPost)
    })
    .catch(function (e) {
      return fail(e, [])
    })
}

function getPost(id) {
  return db()
    .from('vm_posts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
    .then(function (res) {
      return mapPost(unwrap(res))
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 发帖子。media 传数组（图片地址列表），会自动转成库里的字符串格式
function createPost(options) {
  return getMe()
    .then(function (me) {
      const row = {
        id: util.uid('p'),
        user_id: me ? me.id : '',
        user_name: me ? me.name : '匿名用户',
        user_role: me ? me.role : 'asker',
        content: options.content || '',
        media: JSON.stringify(options.media || []),
        topic: options.topic || '校园',
        created_at: Date.now(),
        claimed_by: '',
        claimed_at: 0
      }
      return db()
        .from('vm_posts')
        .insert(row)
        .then(function (res) {
          unwrap(res)
          return mapPost(row)
        })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 认领帖子：只在还没人认领时才写得进去，防止两个人同时抢到同一条
function claimPost(postId, mentor) {
  return db()
    .from('vm_posts')
    .update({ claimed_by: mentor.id, claimed_at: Date.now() })
    .eq('id', postId)
    .eq('claimed_by', '')
    .then(function (res) {
      unwrap(res)
      return getPost(postId)
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 删自己的帖子（按发帖人 id 兜一道，避免误删别人的）
function removePost(postId, userId) {
  return db()
    .from('vm_posts')
    .delete()
    .eq('id', postId)
    .eq('user_id', userId)
    .then(function (res) {
      unwrap(res)
      return true
    })
    .catch(function (e) {
      return fail(e, false)
    })
}

function postsOf(userId) {
  return db()
    .from('vm_posts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
    .then(function (res) {
      return (unwrap(res) || []).map(mapPost)
    })
    .catch(function (e) {
      return fail(e, [])
    })
}

// 页面上「社区」页的分类标签用：返回 [{ topic, count }]，带一个「全部」
function listPostTopics() {
  return listPosts()
    .then(function (rows) {
      const map = {}
      rows.forEach(function (p) {
        const t = p.topic || '校园'
        map[t] = (map[t] || 0) + 1
      })
      const out = Object.keys(map).map(function (t) {
        return { topic: t, count: map[t] }
      })
      out.sort(function (a, b) {
        return b.count - a.count
      })
      out.unshift({ topic: POST_ALL, count: rows.length })
      return out
    })
}

// ---------------------------------------------------------------- 常见问题表
// vm_faqs 是后端新增的一张表，建表脚本见工程同级的「建表脚本.sql」。
// 内容由运营 / AI 助手录入，前端「常见问题」页只读展示。
//
// 注意：在云端真正建好这张表之前，调用这些方法会报「表不存在」。
// 这不是代码写错了 —— 按脚本执行一次建表就好，代码不用改。

const FAQ_ALL = '全部'
const DEFAULT_FAQ_CATEGORY = '通用'

function mapFaq(r) {
  if (!r) return null
  return {
    id: r.id,
    question: r.question || '',
    answer: r.answer || '',
    category: r.category || DEFAULT_FAQ_CATEGORY,
    sort: Number(r.sort) || 0,
    enabled: r.enabled !== false,
    source: r.source || 'manual',
    hitCount: Number(r.hit_count) || 0,
    createdAt: Number(r.created_at) || 0,
    updatedAt: Number(r.updated_at) || 0
  }
}

// 拉取启用的常见问题。不传分类或传「全部」= 取全部。
// 排序：sort 小的在前，序号一样则先录入的在前。
function listFaqs(category) {
  let query = db().from('vm_faqs').select('*')
  if (category && category !== FAQ_ALL) {
    query = query.eq('category', category)
  }
  return query
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(200)
    .then(unwrap)
    .then(function (rows) {
      return (rows || []).map(mapFaq).filter(function (f) {
        return f.enabled
      })
    })
    .catch(function (e) {
      return fail(e, [])
    })
}

// 分类列表（去重），前端做分组导航用
function listFaqCategories() {
  return db()
    .from('vm_faqs')
    .select('category')
    .limit(200)
    .then(unwrap)
    .then(function (rows) {
      const out = []
      ;(rows || []).forEach(function (r) {
        const c = r.category || DEFAULT_FAQ_CATEGORY
        if (out.indexOf(c) < 0) out.push(c)
      })
      return out
    })
    .catch(function (e) {
      return fail(e, [])
    })
}

// 新增或修改一条。传 id 是改，不传是新增。成功返回 true，失败返回 null。
// 运营同学录入时用这个。
function upsertFaq(faq) {
  const row = {
    question: faq.question || '',
    answer: faq.answer || '',
    category: faq.category || DEFAULT_FAQ_CATEGORY,
    sort: Number(faq.sort) || 0,
    enabled: faq.enabled !== false,
    source: faq.source || 'manual',
    updated_at: Date.now()
  }
  if (faq.id) {
    return db()
      .from('vm_faqs')
      .update(row)
      .eq('id', faq.id)
      .then(unwrap)
      .then(function () {
        return true
      })
      .catch(function (e) {
        return fail(e, null)
      })
  }
  row.created_at = row.updated_at
  return db()
    .from('vm_faqs')
    .insert(row)
    .then(unwrap)
    .then(function () {
      return true
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 下架（不是真删）：把 enabled 改成 false。推荐用这个而不是 removeFaq。
function disableFaq(id) {
  return db()
    .from('vm_faqs')
    .update({ enabled: false, updated_at: Date.now() })
    .eq('id', id)
    .then(unwrap)
    .then(function () {
      return true
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 真的从库里删掉一条。谨慎使用。
function removeFaq(id) {
  return db()
    .from('vm_faqs')
    .delete()
    .eq('id', id)
    .then(unwrap)
    .then(function () {
      return true
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 统计一条被点开了多少次。用来判断哪些内容真的有用。
// 计数错了不影响用户阅读，所以失败静默处理，不弹提示。
function hitFaq(id) {
  return db()
    .from('vm_faqs')
    .select('hit_count')
    .eq('id', id)
    .limit(1)
    .then(unwrap)
    .then(function (rows) {
      const current = rows && rows[0] ? Number(rows[0].hit_count) || 0 : 0
      return db()
        .from('vm_faqs')
        .update({ hit_count: current + 1, updated_at: Date.now() })
        .eq('id', id)
        .then(unwrap)
    })
    .catch(function () {
      return null
    })
}

// ---------------------------------------------------------------- 身份核验申请单
// ----------------------------------------------------------------
// 表：vm_verifications（新增，建表脚本见工程同级的「建表脚本.sql」）
//
// 为什么要单独建一张表？
//   原来认证信息是直接写在用户档案 vm_users 上的，只保存「当前状态」：
//   —— 被驳回过几次、每次为什么驳回、是谁审核的，全都查不到；
//   —— 用户重新提交会把上一次的材料直接盖掉，审核员无从比对。
//   新表把每一次提交都留成一张「申请单」，可追溯、能写驳回理由、能查审核人。
//
// 【兼容设计 · 重要】
//   这张表目前还没在云端建出来（要等有权限的人执行脚本）。
//   所以下面每个函数都会先探测一次：表不存在就自动退回读 vm_users 的老逻辑，
//   页面不会报错、不会白屏。表一旦建好，下次启动自动切到新表。
//   => 前端现在就可以开始调用，不用等建表，也不用改代码。
// ----------------------------------------------------------------

// 核验状态取值，页面和后端统一用这四个，别自己造词
const VERIFY_STATUS = {
  NONE: 'none',       // 还没提交过
  PENDING: 'pending', // 已提交，等人工审核
  APPROVED: 'approved', // 审核通过
  REJECTED: 'rejected'  // 被驳回，可以改完重新提交
}

// 探测结果缓存：0 还没探 / 1 表可用 / 2 表不存在
let verifyTableState = 0
let verifyTableProbe = null

// 只探测一次，结果缓存起来，之后所有函数共用
function verifyTableReady() {
  if (verifyTableState === 1) return Promise.resolve(true)
  if (verifyTableState === 2) return Promise.resolve(false)
  if (verifyTableProbe) return verifyTableProbe
  verifyTableProbe = db()
    .from('vm_verifications')
    .select('id')
    .limit(1)
    .then(function () {
      verifyTableState = 1
      return true
    })
    .catch(function () {
      // 表还没建 —— 这是预期内的情况，不弹错误提示，静默降级
      verifyTableState = 2
      return false
    })
    .then(function (ok) {
      verifyTableProbe = null
      return ok
    })
  return verifyTableProbe
}

// 云端行 -> 页面用的驼峰结构
function mapVerification(r) {
  if (!r) return null
  return {
    id: r.id,
    userId: r.user_id || '',
    userName: r.user_name || '',
    role: r.role || 'asker',
    realName: r.real_name || '',
    studentId: r.student_id || '',
    phone: r.phone || '',
    idPhoto: r.id_photo || '',
    status: r.status || VERIFY_STATUS.NONE,
    reason: r.reason || '',              // 驳回理由（审核员填的）
    reviewerId: r.reviewer_id || '',
    reviewerName: r.reviewer_name || '',
    reviewedAt: Number(r.reviewed_at) || 0,
    createdAt: Number(r.created_at) || 0
  }
}

// 提交一份核验申请。profile 至少要有 userId / realName / studentId / idPhoto。
// 同时会把 vm_users.verify_status 置成 pending（老页面靠这个字段显示"审核中"）。
// 成功返回申请单，失败返回 null。
function submitVerification(profile) {
  const now = Date.now()
  return verifyTableReady().then(function (ready) {
    if (!ready) {
      // 降级：老办法，直接把材料写到用户档案上
      return db()
        .from('vm_users')
        .update({
          real_name: profile.realName || '',
          student_id: profile.studentId || '',
          phone: profile.phone || '',
          id_photo: profile.idPhoto || '',
          verify_status: VERIFY_STATUS.PENDING,
          reviewed_at: 0
        })
        .eq('id', profile.userId)
        .then(function () {
          return {
            id: '',
            userId: profile.userId || '',
            status: VERIFY_STATUS.PENDING,
            createdAt: now,
            legacy: true // 标记：走的是老逻辑，没有申请单 id
          }
        })
    }
    return db()
      .from('vm_verifications')
      .insert({
        user_id: profile.userId || '',
        user_name: profile.userName || '',
        role: profile.role === 'mentor' ? 'mentor' : 'asker',
        real_name: profile.realName || '',
        student_id: profile.studentId || '',
        phone: profile.phone || '',
        id_photo: profile.idPhoto || '',
        status: VERIFY_STATUS.PENDING,
        created_at: now
      })
      .then(unwrap)
      .then(function (rows) {
        const created = rows && rows[0] ? mapVerification(rows[0]) : null
        // 同步用户档案上的状态快照，让现有页面立刻显示"审核中"
        return db()
          .from('vm_users')
          .update({
            real_name: profile.realName || '',
            student_id: profile.studentId || '',
            phone: profile.phone || '',
            id_photo: profile.idPhoto || '',
            verify_status: VERIFY_STATUS.PENDING,
            reviewed_at: 0
          })
          .eq('id', profile.userId)
          .then(function () {
            return created || { id: '', userId: profile.userId || '', status: VERIFY_STATUS.PENDING, createdAt: now }
          })
      })
  })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 我的申请历史（新的在前）。表没建时返回空数组，不报错。
function myVerifications(userId) {
  if (!userId) return Promise.resolve([])
  return verifyTableReady()
    .then(function (ready) {
      if (!ready) return []
      return db()
        .from('vm_verifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(unwrap)
        .then(function (rows) {
          return (rows || []).map(mapVerification)
        })
    })
    .catch(function (e) {
      return fail(e, [])
    })
}

// 我最新的一份申请（用于展示"审核中 / 已通过 / 被驳回 + 驳回理由"）
function latestVerificationOf(userId) {
  return myVerifications(userId).then(function (list) {
    return list.length ? list[0] : null
  })
}

// 审核台：待审核名单。
// 新表可用时返回申请单列表；表没建时退回老逻辑（读 vm_users）。
function listPendingVerifications() {
  return verifyTableReady()
    .then(function (ready) {
      if (!ready) return listPendingReviews()
      return db()
        .from('vm_verifications')
        .select('*')
        .eq('status', VERIFY_STATUS.PENDING)
        .order('created_at', { ascending: true })
        .limit(100)
        .then(unwrap)
        .then(function (rows) {
          return (rows || []).map(mapVerification)
        })
    })
    .catch(function (e) {
      return fail(e, [])
    })
}

// 审核结论：approved 通过 / rejected 驳回。
// reason 是驳回理由（通过时可不填），reviewer 是审核人档案。
// 会同时把结论同步到 vm_users.verify_status，现有页面无需改动。
function reviewVerification(verifyId, status, reason, reviewer) {
  const value = status === VERIFY_STATUS.APPROVED ? VERIFY_STATUS.APPROVED : VERIFY_STATUS.REJECTED
  const now = Date.now()
  const reviewerId = (reviewer && reviewer.id) || ''
  const reviewerName = (reviewer && reviewer.name) || ''

  return verifyTableReady()
    .then(function (ready) {
      if (!ready) {
        // 降级：老办法只改用户档案（此时 verifyId 实际上就是 userId）
        return db()
          .from('vm_users')
          .update({ verify_status: value, reviewed_at: now })
          .eq('id', verifyId)
          .then(function () {
            return true
          })
      }
      // 先取申请单，拿到申请人 id
      return db()
        .from('vm_verifications')
        .select('*')
        .eq('id', verifyId)
        .limit(1)
        .then(unwrap)
        .then(function (rows) {
          const one = rows && rows[0] ? mapVerification(rows[0]) : null
          if (!one) throw new Error('申请单不存在：' + verifyId)
          // 防并发：只有仍处于待审核的单子才能被审，避免两个人重复审同一条
          if (one.status !== VERIFY_STATUS.PENDING) throw new Error('这份申请已经审核过了')
          return db()
            .from('vm_verifications')
            .update({
              status: value,
              reason: reason || '',
              reviewer_id: reviewerId,
              reviewer_name: reviewerName,
              reviewed_at: now
            })
            .eq('id', verifyId)
            .eq('status', VERIFY_STATUS.PENDING) // 条件更新，并发时只有一个会成功
            .then(unwrap)
            .then(function () {
              // 结论回写到用户档案
              return db()
                .from('vm_users')
                .update({ verify_status: value, reviewed_at: now })
                .eq('id', one.userId)
                .then(function () {
                  return true
                })
            })
        })
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

// 清空演示数据：删除云端全部会话 / 消息 / 已读记录和非示例用户，
// 学长库恢复成默认示例（mine 页有二次确认弹窗后才调用）
function resetDemo() {
  return Promise.all([
    db().from('vm_messages').delete().neq('id', '__none__'),
    db().from('vm_threads').delete().neq('id', '__none__'),
    db().from('vm_reads').delete().neq('user_id', '__none__')
  ])
    .then(function () {
      return listUsers()
    })
    .then(function (users) {
      const keepIds = SEED_MENTORS.map(function (m, i) {
        return 'm' + (i + 1)
      })
      const removeIds = users
        .filter(function (u) {
          return keepIds.indexOf(u.id) < 0
        })
        .map(function (u) {
          return u.id
        })
      if (!removeIds.length) return null
      return db()
        .from('vm_users')
        .delete()
        .in('id', removeIds)
        .then(function () {
          return null
        })
    })
    .then(function () {
      writeLocalMeId('')
      return seedIfEmpty()
    })
    .catch(function (e) {
      return fail(e, null)
    })
}

module.exports = {
  MAJORS: MAJORS,
  CUSTOM_MAJOR: CUSTOM_MAJOR,
  TOPICS: TOPICS,
  setErrorHandler: setErrorHandler,
  seedIfEmpty: seedIfEmpty,
  listUsers: listUsers,
  listMentors: listMentors,
  listOnlineMentors: listOnlineMentors,
  touchActive: touchActive,
  listPendingReviews: listPendingReviews,
  setReviewStatus: setReviewStatus,
  isReviewer: isReviewer,
  VERIFY_STATUS: VERIFY_STATUS,
  submitVerification: submitVerification,
  myVerifications: myVerifications,
  latestVerificationOf: latestVerificationOf,
  listPendingVerifications: listPendingVerifications,
  reviewVerification: reviewVerification,
  getMe: getMe,
  saveMe: saveMe,
  clearMe: clearMe,
  switchToMentor: switchToMentor,
  switchToAsker: switchToAsker,
  switchRole: switchRole,
  listThreads: listThreads,
  getThread: getThread,
  updateThread: updateThread,
  createThread: createThread,
  claimThread: claimThread,
  closeThread: closeThread,
  threadsAsAsker: threadsAsAsker,
  threadsAsMentor: threadsAsMentor,
  threadsOpen: threadsOpen,
  listMessages: listMessages,
  lastMessageOf: lastMessageOf,
  addMessage: addMessage,
  countMessages: countMessages,
  markRead: markRead,
  unreadCount: unreadCount,
  readStateOf: readStateOf,
  lastReadAt: lastReadAt,
  loadBoard: loadBoard,
  stats: stats,
  FAQ_ALL: FAQ_ALL,
  listFaqs: listFaqs,
  listFaqCategories: listFaqCategories,
  upsertFaq: upsertFaq,
  disableFaq: disableFaq,
  removeFaq: removeFaq,
  hitFaq: hitFaq,
  // POST_ALL / listPosts / getPost / createPost / claimPost / removePost / postsOf /
  // listPostTopics —— 【已废弃】请改用 utils/community.js（见文件内说明）
  POST_ALL: POST_ALL,
  listPosts: listPosts,
  getPost: getPost,
  createPost: createPost,
  claimPost: claimPost,
  removePost: removePost,
  postsOf: postsOf,
  listPostTopics: listPostTopics,
  resetDemo: resetDemo
}
