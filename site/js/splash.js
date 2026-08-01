(function () {
  var s = document.getElementById('splash');
  if (!s) return;
  setTimeout(function () {
    s.classList.add('splash--fade');
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 800);
  }, 5000);
})();
