// Applies the remembered theme before the first paint, so a dark-theme app doesn't flash white
// while the bundle loads. A file of its own rather than an inline script in `index.html`: the app
// runs under a CSP with `script-src 'self'`, which an inline script has no way of satisfying.
(function () {
  try {
    var stored = localStorage.getItem("mixdb-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
