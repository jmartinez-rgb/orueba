/* Plan masivo (sitio 5.6): exige la sesión corporativa de la plataforma antes de cargar. */
(function () {
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) location.replace('/login?returnTo=' + encodeURIComponent('/plan/'));
    return r.ok ? r.json() : null;
  }).then(function (d) {
    if (!d || !d.user) return;
    var b = document.querySelector('.brand');
    if (!b) return;
    var a = document.createElement('a');
    a.href = '/'; a.textContent = '← Paid Media OS 6.0'; a.style.cssText = 'margin-left:12px;font-size:12px;color:inherit;opacity:.7;text-decoration:none';
    b.appendChild(a);
    var u = document.createElement('span');
    u.textContent = d.user.email; u.style.cssText = 'margin-left:10px;font-size:11px;opacity:.55';
    b.appendChild(u);
  }).catch(function () {});
})();
