/**
 * Apply the saved theme before first paint to avoid a flash of the wrong
 * colours.
 *
 * A separate file rather than an inline <script>, so the page stays compatible
 * with a strict `script-src 'self'` content-security policy.
 */
(function () {
  try {
    var t = localStorage.getItem('inv.theme');
    if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches))
      document.documentElement.classList.add('dark');
  } catch (e) { /* private mode or storage disabled — fall back to light */ }
})();
