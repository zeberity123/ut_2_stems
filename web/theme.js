// Applies the saved theme before the first paint so the window does not flash.
// Preferences live in the desktop shell; this mirror in localStorage is only for the first frame.
(function () {
  try {
    var theme = localStorage.getItem('ut-stems-theme');
    if (['light', 'dark', 'miku', 'miku-light'].includes(theme)) document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
