// Password reset. One page, two steps: ask for the email address, then (arriving from the
// emailed link) choose the new password.
(function () {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const fromPro = params.get('pro') === '1';

  // The token is a key to the account for the next thirty minutes. Take it out of the
  // address bar straight away so it is not left in browser history, bookmarks or a
  // screenshot someone shares with support.
  if (token) window.history.replaceState(null, '', '/reset-password');

  const signin = el('link-signin');
  if (signin && fromPro) signin.href = '/supplier';

  if (!token) {
    el('step-request').classList.remove('hidden');
    const remembered = params.get('email');
    if (remembered) el('reset-email').value = remembered;

    el('request-form').onsubmit = async (e) => {
      e.preventDefault();
      el('request-error').textContent = '';
      const btn = el('btn-request');
      try {
        const r = await withBusy(btn, 'Sending…', () => api('/api/auth/forgot', {
          method: 'POST', body: { email: el('reset-email').value.trim() },
        }));
        el('request-done').textContent = r.message;
        el('request-form').classList.add('hidden');
      } catch (err) {
        el('request-error').textContent = err.message;
      }
    };
    return;
  }

  el('step-set').classList.remove('hidden');
  el('set-form').onsubmit = async (e) => {
    e.preventDefault();
    el('set-error').textContent = '';
    const a = el('new-password').value;
    const b = el('new-password-2').value;
    if (a.length < 8) { el('set-error').textContent = 'Use at least 8 characters.'; return; }
    if (a !== b) { el('set-error').textContent = 'The two passwords do not match.'; return; }
    try {
      const r = await withBusy(el('btn-set'), 'Saving…', () => api('/api/auth/reset', {
        method: 'POST', body: { token, password: a },
      }));
      toast('Password changed. You are signed in.', 'ok');
      setTimeout(() => {
        goPage(r.user && r.user.role === 'supplier' ? '/supplier' : '/');
      }, 900);
    } catch (err) {
      el('set-error').textContent = err.message;
    }
  };
})();
