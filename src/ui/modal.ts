/**
 * @nuln/worker-kit/ui/modal
 *
 * 统一全栈模态弹窗系统 (Modal / Dialog / Toast)
 * 包含：
 * - alertDlg(title, message, okText): 提示弹窗
 * - confirmDlg(title, message, okText, cancelText): 确认弹窗 (返回 Promise<boolean>)
 * - promptDlg(title, placeholder, defaultValue): 输入弹窗 (返回 Promise<string|null>)
 * - toast(message, type, duration): 悬浮轻提示
 */

export const MODAL_CSS = `
/* ─── 统一全栈模态弹窗 (Modal) 与 Toast 样式规范 ─── */
.modal-overlay, .modal {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 10000;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
.modal-overlay.open, .modal.open {
  display: flex;
}
.modal-card, .sheet {
  background: var(--bg-surface, #ffffff);
  border: 1px solid var(--border-base, #e2e8f0);
  border-radius: 14px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  padding: 24px;
  width: 100%;
  max-width: 380px;
  position: relative;
  box-sizing: border-box;
  animation: modal-scale-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes modal-scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.modal-card h3, .sheet h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #0f172a);
}
.modal-card .close-x, .sheet .close-x {
  position: absolute;
  top: 16px;
  right: 16px;
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-secondary, #64748b);
  padding: 4px;
  line-height: 1;
}
.modal-card .close-x:hover, .sheet .close-x:hover {
  color: var(--text-primary, #0f172a);
}
.modal-card p, .modal-card .modal-body, .sheet .modal-body {
  margin: 0 0 20px;
  font-size: 13.5px;
  color: var(--text-primary, #0f172a);
  line-height: 1.6;
  word-break: break-word;
}
.modal-card input.modal-input, .sheet input.modal-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-base, #cbd5e1);
  background: var(--bg-canvas, #f8fafc);
  color: var(--text-primary, #0f172a);
  font-size: 13.5px;
  margin-bottom: 20px;
  box-sizing: border-box;
}
.modal-card input.modal-input:focus, .sheet input.modal-input:focus {
  outline: none;
  border-color: var(--primary, #0f172a);
  box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.15);
}
.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.modal-btn, .sheet .btn, .modal-actions .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  box-sizing: border-box;
  text-decoration: none;
  width: auto;
}
.modal-btn.primary, .sheet .btn.primary, .modal-actions .btn.primary {
  background: var(--primary, #0f172a);
  color: var(--primary-contrast, #ffffff);
}
.modal-btn.primary:hover, .sheet .btn.primary:hover, .modal-actions .btn.primary:hover {
  opacity: 0.9;
}
.modal-btn.secondary, .sheet .btn.secondary, .modal-actions .btn.secondary {
  background: var(--bg-subtle, #f1f5f9);
  color: var(--text-primary, #0f172a);
  border-color: var(--border-base, #cbd5e1);
}
.modal-btn.secondary:hover, .sheet .btn.secondary:hover, .modal-actions .btn.secondary:hover {
  background: var(--border-subtle, #e2e8f0);
}
.modal-btn.danger, .sheet .btn.danger, .modal-actions .btn.danger {
  background: #ef4444;
  color: #ffffff;
}

/* Toast Container */
#toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 10001;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast-msg {
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #ffffff;
  background: #1e293b;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: auto;
  animation: toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  align-items: center;
  gap: 8px;
}
.toast-msg.success, .toast-msg.s { background: #10b981; }
.toast-msg.error, .toast-msg.e { background: #ef4444; }
.toast-msg.info, .toast-msg.i, .toast-msg.w { background: #3b82f6; }
@keyframes toast-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

export const MODAL_JS = `
(function() {
  function escHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getOrCreateOverlay() {
    var ov = document.getElementById('global-modal-overlay') || document.getElementById('app-modal') || document.getElementById('admin-modal-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'global-modal-overlay';
      ov.className = 'modal-overlay';
      document.body.appendChild(ov);
    }
    return ov;
  }

  function getOrCreateToastContainer() {
    var tc = document.getElementById('toast-container');
    if (!tc) {
      tc = document.createElement('div');
      tc.id = 'toast-container';
      document.body.appendChild(tc);
    }
    return tc;
  }

  window.toast = function(msg, type, duration) {
    var tc = getOrCreateToastContainer();
    var t = document.createElement('div');
    t.className = 'toast-msg ' + (type || 'i');
    t.textContent = msg;
    tc.appendChild(t);
    setTimeout(function() {
      t.style.opacity = '0';
      t.style.transform = 'translateY(10px)';
      t.style.transition = 'all 0.2s ease';
      setTimeout(function() { t.remove(); }, 200);
    }, duration || 3000);
  };

  window.openModal = function(title, html, buttons) {
    var ov = getOrCreateOverlay();
    ov.innerHTML = '<div class="modal-card sheet">' +
      '<button type="button" class="close-x" id="modal-close-x-btn">✕</button>' +
      '<h3 id="app-modal-t">' + (title || '提示') + '</h3>' +
      '<div class="modal-body" id="app-modal-b">' + (html || '') + '</div>' +
      '<div class="modal-actions" id="app-modal-a"></div>' +
    '</div>';
    ov.classList.add('open');

    var tEl = document.getElementById('app-modal-t');
    if (tEl) tEl.textContent = title || '提示';
    var bEl = document.getElementById('app-modal-b');
    if (bEl) bEl.innerHTML = html || '';

    var a = document.getElementById('app-modal-a');
    if (a) {
      a.innerHTML = '';
      (buttons || []).forEach(function(btn) {
        var el = document.createElement('button');
        el.type = 'button';
        el.textContent = btn.text;
        el.className = 'modal-btn btn ' + (btn.danger ? 'danger' : (btn.primary ? 'primary' : 'secondary'));
        el.onclick = function() {
          window.closeModal();
          if (btn.onClick) btn.onClick();
        };
        a.appendChild(el);
      });
    }

    var closeX = document.getElementById('modal-close-x-btn');
    if (closeX) closeX.onclick = window.closeModal;
    ov.onclick = function(e) {
      if (e.target === ov) window.closeModal();
    };
  };

  window.closeModal = function() {
    var ov = getOrCreateOverlay();
    if (ov) ov.classList.remove('open');
  };

  window.alertDlg = function(title, msg, okText) {
    var onOk = null;
    if (arguments.length === 1) {
      msg = title;
      title = '提示';
    } else if (typeof msg === 'function') {
      onOk = msg;
      msg = title;
      title = '提示';
    } else if (typeof okText === 'function') {
      onOk = okText;
      okText = '确定';
    }
    return new Promise(function(resolve) {
      var bodyHtml = '<div style="line-height:1.6">' + escHtml(msg) + '</div>';
      window.openModal(title, bodyHtml, [{
        text: (typeof okText === 'string' ? okText : '确定'),
        primary: true,
        onClick: function() {
          if (onOk) onOk();
          resolve(true);
        }
      }]);
    });
  };

  window.confirmDlg = function(title, msg, okText, cancelText) {
    var onOk = null;
    var isDanger = false;
    if (typeof msg === 'function') {
      onOk = msg;
      isDanger = !!okText;
      msg = title;
      title = '确认';
      okText = '确定';
      cancelText = '取消';
    } else if (arguments.length === 1) {
      msg = title;
      title = '确认';
    }
    return new Promise(function(resolve) {
      var bodyHtml = '<div style="line-height:1.6">' + escHtml(msg) + '</div>';
      window.openModal(title, bodyHtml, [
        {
          text: cancelText || '取消',
          secondary: true,
          onClick: function() { resolve(false); }
        },
        {
          text: okText || '确定',
          primary: !isDanger,
          danger: !!isDanger,
          onClick: function() {
            if (onOk) onOk();
            resolve(true);
          }
        }
      ]);
    });
  };

  window.promptDlg = function(title, ph, defaultVal) {
    return new Promise(function(resolve) {
      var ov = getOrCreateOverlay();
      ov.innerHTML = '<div class="modal-card sheet">' +
        '<h3>' + (title || '请输入') + '</h3>' +
        '<input type="text" class="modal-input" id="modal-prompt-input" placeholder="' + (ph || '') + '" value="' + (defaultVal || '') + '">' +
        '<div class="modal-actions">' +
          '<button type="button" class="modal-btn secondary" id="modal-cancel-btn">取消</button>' +
          '<button type="button" class="modal-btn primary" id="modal-ok-btn">确定</button>' +
        '</div>' +
      '</div>';
      ov.classList.add('open');
      var input = document.getElementById('modal-prompt-input');
      input.focus();
      input.select();
      input.onkeydown = function(e) {
        if (e.key === 'Enter') document.getElementById('modal-ok-btn').click();
        if (e.key === 'Escape') document.getElementById('modal-cancel-btn').click();
      };
      document.getElementById('modal-cancel-btn').onclick = function() {
        ov.classList.remove('open');
        resolve(null);
      };
      document.getElementById('modal-ok-btn').onclick = function() {
        var val = input.value;
        ov.classList.remove('open');
        resolve(val);
      };
    });
  };

  // 兼容全栈别名
  window.openDlg = window.openModal;
  window.closeDlg = window.closeModal;
  window.modalAlert = window.alertDlg;
  window.modalConfirm = window.confirmDlg;
  window.modalPrompt = window.promptDlg;
})();
`;

