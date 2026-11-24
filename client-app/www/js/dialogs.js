/**
 * نوافذ تأكيد وتنبيه حديثة بدل نوافذ المتصفح (alert / confirm)
 * مشتركة بين النظام الرئيسي وتطبيق العملاء. المصدر: js/dialogs.js
 * (نسخة client-app/www/js/dialogs.js تُحدَّث تلقائياً عند البناء).
 *
 *   if (!(await UIDialog.confirm('هل تريد حذف هذا البند؟'))) return;
 *   await UIDialog.alert('تم الحفظ');
 *
 * النص يُعرض كنص عادي (textContent) فلا يُفسَّر أي HTML داخل الرسالة.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.UIDialog) return;

  const DANGER_WORDS = /حذف|نهائي|لا يمكن التراجع|إبطال|تجميد|استبدال|إغلاق|استعادة|فك قفل|فك الربط|إنهاء/;
  const ERROR_WORDS = /خطأ|تعذر|فشل|غير صحيح|مرفوض|لا تملك/;
  const SUCCESS_WORDS = /^(?:✅|تم\s)|بنجاح/;

  const CSS = `
  .uidlg-backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;
    background:rgba(4,10,22,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .16s ease}
  .uidlg-backdrop.uidlg-in{opacity:1}
  .uidlg{direction:rtl;text-align:right;width:min(440px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    background:var(--bg-card,#14243b);color:var(--text-primary,var(--text-main,#f8fafc));
    border:1px solid var(--border-color,var(--border,#294263));border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.45);
    font-family:inherit;transform:translateY(10px) scale(.98);transition:transform .18s ease}
  .uidlg-in .uidlg{transform:none}
  .uidlg__head{display:flex;align-items:center;gap:12px;padding:20px 20px 6px}
  .uidlg__icon{flex:0 0 44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:1.25rem;font-weight:800;
    background:rgba(214,173,53,.14);color:var(--gold-primary,var(--gold,#d6ad35));border:1px solid rgba(214,173,53,.35)}
  .uidlg--danger .uidlg__icon{background:rgba(239,68,68,.13);color:#f87171;border-color:rgba(239,68,68,.4)}
  .uidlg--error .uidlg__icon{background:rgba(239,68,68,.13);color:#f87171;border-color:rgba(239,68,68,.4)}
  .uidlg--success .uidlg__icon{background:rgba(16,185,129,.13);color:#34d399;border-color:rgba(16,185,129,.4)}
  .uidlg__title{margin:0;font-size:1.05rem;font-weight:800;line-height:1.5}
  .uidlg__body{padding:6px 20px 4px 20px;overflow:auto;font-size:.95rem;line-height:1.9;color:var(--text-secondary,var(--text-main,#cbd5e1))}
  .uidlg__body p{margin:0 0 8px}
  .uidlg__body p.uidlg__note{margin-top:4px;padding:9px 12px;border-radius:10px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);color:#fca5a5;font-size:.88rem}
  .uidlg__actions{display:flex;gap:10px;justify-content:flex-start;padding:16px 20px 20px;flex-wrap:wrap}
  .uidlg__btn{min-width:110px;min-height:44px;padding:10px 18px;border-radius:12px;border:1px solid transparent;font:inherit;font-weight:800;font-size:.95rem;cursor:pointer;transition:filter .15s,transform .05s}
  .uidlg__btn:active{transform:translateY(1px)}
  .uidlg__btn:focus-visible{outline:3px solid rgba(214,173,53,.55);outline-offset:2px}
  .uidlg__btn--ok{background:linear-gradient(135deg,var(--gold-light,#f6d878),var(--gold-primary,var(--gold,#d6ad35)));color:#14213d}
  .uidlg--danger .uidlg__btn--ok{background:#dc2626;color:#fff}
  .uidlg__btn--ok:hover{filter:brightness(1.07)}
  .uidlg__btn--cancel{background:transparent;color:var(--text-primary,var(--text-main,#f8fafc));border-color:var(--border-color,var(--border,#294263))}
  .uidlg__btn--cancel:hover{background:rgba(148,163,184,.1)}
  @media (max-width:480px){.uidlg-backdrop{align-items:flex-end;padding:0}
    .uidlg{width:100%;border-radius:20px 20px 0 0;padding-bottom:env(safe-area-inset-bottom)}
    .uidlg__actions{flex-direction:column-reverse}.uidlg__btn{width:100%}}
  @media (prefers-reduced-motion:reduce){.uidlg-backdrop,.uidlg{transition:none}}`;

  function injectStyle() {
    if (document.getElementById('uidlg-style')) return;
    const style = document.createElement('style');
    style.id = 'uidlg-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // سطور الرسالة تصبح فقرات؛ سطر يبدأ بـ "تنبيه" أو "⚠️" يُبرز كملاحظة
  function fillBody(body, message) {
    const parts = String(message == null ? '' : message).split(/\n{2,}|\n/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const p = document.createElement('p');
      if (/^(?:تنبيه|⚠️|تحذير)/.test(part)) p.className = 'uidlg__note';
      p.textContent = part;
      body.appendChild(p);
    }
  }

  let queue = Promise.resolve();

  function open(kind, message, opts) {
    const run = () => new Promise(resolve => {
      injectStyle();
      const text = String(message == null ? '' : message);
      const tone = opts.tone || (kind === 'confirm'
        ? (DANGER_WORDS.test(text) ? 'danger' : 'default')
        : (ERROR_WORDS.test(text) ? 'error' : SUCCESS_WORDS.test(text) ? 'success' : 'default'));
      const title = opts.title || (kind === 'confirm'
        ? (tone === 'danger' ? 'تأكيد إجراء مهم' : 'تأكيد')
        : (tone === 'error' ? 'تعذر إتمام العملية' : tone === 'success' ? 'تمت العملية' : 'تنبيه'));
      const icon = tone === 'danger' || tone === 'error' ? '!' : tone === 'success' ? '✓' : (kind === 'confirm' ? '?' : 'i');

      const previousFocus = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'uidlg-backdrop';
      const box = document.createElement('div');
      box.className = 'uidlg uidlg--' + tone;
      box.setAttribute('role', kind === 'confirm' ? 'alertdialog' : 'dialog');
      box.setAttribute('aria-modal', 'true');
      const id = 'uidlg-' + Math.random().toString(36).slice(2);
      box.setAttribute('aria-labelledby', id + '-t');
      box.setAttribute('aria-describedby', id + '-b');

      const head = document.createElement('div'); head.className = 'uidlg__head';
      const iconEl = document.createElement('div'); iconEl.className = 'uidlg__icon'; iconEl.setAttribute('aria-hidden', 'true'); iconEl.textContent = icon;
      const titleEl = document.createElement('h2'); titleEl.className = 'uidlg__title'; titleEl.id = id + '-t'; titleEl.textContent = title;
      head.append(iconEl, titleEl);
      const body = document.createElement('div'); body.className = 'uidlg__body'; body.id = id + '-b';
      fillBody(body, text);
      const actions = document.createElement('div'); actions.className = 'uidlg__actions';
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'uidlg__btn uidlg__btn--ok';
      ok.textContent = opts.okText || (kind === 'confirm' ? (tone === 'danger' ? 'نعم، متابعة' : 'موافق') : 'حسناً');
      actions.appendChild(ok);
      let cancel = null;
      if (kind === 'confirm') {
        cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'uidlg__btn uidlg__btn--cancel';
        cancel.textContent = opts.cancelText || 'إلغاء';
        actions.appendChild(cancel);
      }
      box.append(head, body, actions);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('uidlg-in'));

      let done = false;
      function close(result) {
        if (done) return; done = true;
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        try { if (previousFocus && previousFocus.focus) previousFocus.focus(); } catch (_) {}
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(kind === 'confirm' ? false : undefined); }
        else if (e.key === 'Tab') {
          const items = [ok, cancel].filter(Boolean);
          const i = items.indexOf(document.activeElement);
          e.preventDefault();
          items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
        }
      }
      ok.addEventListener('click', () => close(kind === 'confirm' ? true : undefined));
      if (cancel) cancel.addEventListener('click', () => close(false));
      backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(kind === 'confirm' ? false : undefined); });
      document.addEventListener('keydown', onKey, true);
      // في الإجراءات الخطرة يبدأ التركيز على "إلغاء" حتى لا يؤكد Enter بالخطأ
      (tone === 'danger' && cancel ? cancel : ok).focus();
    });
    const result = queue.then(run, run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  window.UIDialog = {
    confirm: (message, opts = {}) => open('confirm', message, opts),
    alert: (message, opts = {}) => open('alert', message, opts)
  };
  // تنبيهات alert القديمة تظهر بالتصميم الجديد (دون إيقاف الصفحة)
  window.__nativeAlert = window.alert;
  window.alert = message => { window.UIDialog.alert(message); };
})();
