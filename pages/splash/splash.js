Page({
  data: {
    targetName: '答疑大厅'
  },

  onLoad: function () {
    var me = wx.getStorageSync('vm_me');
    var url = me ? '/pages/index/index' : '/pages/login/login';
    this._url = url;
    if (!me) this.setData({ targetName: '登录登记' });
    var that = this;
    this._timer = setTimeout(function () {
      that._go(url);
    }, 2600);
  },

  onUnload: function () {
    if (this._timer) clearTimeout(this._timer);
  },

  onSkip: function () {
    if (this._timer) clearTimeout(this._timer);
    this._go(this._url || '/pages/login/login');
  },

  _go: function (url) {
    var fallback = function () {
      wx.reLaunch({ url: '/pages/login/login' });
    };
    wx.reLaunch({
      url: url,
      fail: fallback
    });
  }
});
