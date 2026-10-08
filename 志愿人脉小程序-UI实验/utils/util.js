/**
 * 通用小工具：时间格式化、唯一 id、文本截断
 */

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

// 时间戳 -> 聊天气泡上方的分组时间（今天显示 时:分，昨天显示 昨天 时:分，更早显示 月/日 时:分）
function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return hm
  const y = new Date(now.getTime() - 86400000)
  if (
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate()
  ) {
    return '昨天 ' + hm
  }
  return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + hm
}

// 列表里的相对时间：刚刚 / N分钟前 / N小时前 / N天前
function fromNow(ts) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前'
  const d = new Date(ts)
  return d.getMonth() + 1 + '月' + d.getDate() + '日'
}

function uid(prefix) {
  return (
    (prefix || 'id') +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 6)
  )
}

// 取名字首字，做无头像时的圆形占位
function initial(name) {
  const s = (name || '').trim()
  return s ? s.slice(0, 1) : '同'
}

function truncate(text, len) {
  const s = (text || '').replace(/\s+/g, ' ').trim()
  return s.length > len ? s.slice(0, len) + '…' : s
}

module.exports = { formatTime, fromNow, uid, initial, truncate }
