// Applies the saved theme before the first paint so the window does not flash.
// Preferences live in the desktop shell; this mirror in localStorage is only for the first frame.
(function () {
  try {
    var theme = localStorage.getItem('ut-stems-theme');
    if (theme === 'miku') theme = 'theme1';            // the names before 0.6.3
    if (theme === 'miku-light') theme = 'theme2';
    if (['light', 'dark', 'theme1', 'theme2'].includes(theme)) document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
