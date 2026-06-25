// ─── Shared header/footer loader (synchronous) ───
(function() {
  function loadSync(url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    try { xhr.send(); if (xhr.status === 200 || xhr.status === 0) return xhr.responseText; } catch(e) {}
    return '';
  }
  var h = document.querySelector('.layout-header');
  var f = document.querySelector('.layout-footer');
  if (h) { var html = loadSync('../html/header.html'); if (html) h.outerHTML = html; }
  if (f) { var html = loadSync('../html/footer.html'); if (html) f.outerHTML = html; }
})();