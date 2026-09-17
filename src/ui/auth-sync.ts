/**
 * @nuln/worker-kit/ui/auth-sync
 *
 * 跨微服务与多标签页认证状态秒级广播与同步机制
 * 基于 BroadcastChannel 与 localStorage 双通道实现登录/登出/会话过期协同
 */

export const AUTH_SYNC_CHANNEL = "nuln_auth_sync";

export type AuthSyncEventType = "LOGIN" | "LOGOUT" | "SESSION_EXPIRED" | "USER_SWITCH";

export interface AuthSyncEvent {
  type: AuthSyncEventType;
  service?: string;
  userId?: string;
  timestamp: number;
}

/**
 * 客户端跨标签页同步嵌入脚本
 */
export const AUTH_SYNC_SCRIPT = `
<script>
(function() {
  var CHANNEL_NAME = "${AUTH_SYNC_CHANNEL}";
  var channel = null;
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = function(ev) {
        handleAuthSync(ev.data);
      };
    }
  } catch(e) {}

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', function(ev) {
      if (ev.key === '__nuln_auth_sync__' && ev.newValue) {
        try {
          var data = JSON.parse(ev.newValue);
          handleAuthSync(data);
        } catch(e) {}
      }
    });
  }

  function handleAuthSync(data) {
    if (!data || !data.type) return;
    if (data.type === 'LOGOUT' || data.type === 'SESSION_EXPIRED') {
      // 若当前不在登录或 setup 页面，则平滑刷新
      var p = window.location.pathname;
      if (!p.includes('/login') && !p.includes('/setup') && !p.includes('/recovery') && !p.includes('/invite')) {
        window.location.reload();
      }
    } else if (data.type === 'LOGIN' || data.type === 'USER_SWITCH') {
      var p = window.location.pathname;
      if (p.includes('/login') || p.includes('/setup')) {
        window.location.href = window.location.origin + (window.__BASE_PATH__ || '/');
      }
    }
  }

  window.broadcastAuthEvent = function(type, payload) {
    var ev = {
      type: type,
      service: payload && payload.service,
      userId: payload && payload.userId,
      timestamp: Date.now()
    };
    if (channel) {
      try { channel.postMessage(ev); } catch(e) {}
    }
    try {
      localStorage.setItem('__nuln_auth_sync__', JSON.stringify(ev));
      setTimeout(function() {
        try { localStorage.removeItem('__nuln_auth_sync__'); } catch(e) {}
      }, 500);
    } catch(e) {}
  };
})();
</script>
`;
