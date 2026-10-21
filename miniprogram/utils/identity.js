/**
 * 实名认证检查工具
 * 当前产品阶段暂时隐藏实名链路，所有实名检查直接放行。
 */

function ensureVerified(callback, failCallback) {
  if (callback) callback()
}

function isIdentityVerified() {
  return true
}

module.exports = { ensureVerified, isIdentityVerified }
