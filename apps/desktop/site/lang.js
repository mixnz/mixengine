// Ngôn ngữ chọn lần trước được nhớ lại, nhưng mặc định là tiếng Anh: người đọc đầu tiên của
// trang này thường là reviewer của store.
(function () {
  var root = document.documentElement;
  var buttons = document.querySelectorAll("[data-set-lang]");

  function apply(lang) {
    root.setAttribute("data-lang", lang);
    root.setAttribute("lang", lang);
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.setLang === lang));
    });
  }

  var saved = null;
  try { saved = localStorage.getItem("mixdb-privacy-lang"); } catch (e) { /* chế độ riêng tư */ }
  if (saved === "en" || saved === "vi") apply(saved);

  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      var lang = b.dataset.setLang;
      apply(lang);
      try { localStorage.setItem("mixdb-privacy-lang", lang); } catch (e) { /* chế độ riêng tư */ }
    });
  });
})();
