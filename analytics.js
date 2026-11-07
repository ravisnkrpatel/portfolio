/* Site analytics — GoatCounter (free, no cookies, private dashboard).
   1) Sign up at https://www.goatcounter.com and pick a site code (e.g. "ravisnkr").
   2) Paste that code between the quotes below and commit. Until then nothing loads.
   Your own visits: open the site once with ?owner=1 on each device to exclude them. */
(function () {
  var CODE = '';

  // Custom events (résumé opened, contact revealed...). Safe no-op until CODE is set.
  window.psrTrack = function (name, title) {
    try {
      if (window.goatcounter && window.goatcounter.count) {
        window.goatcounter.count({ path: name, title: title || name, event: true });
      }
    } catch (e) {}
  };

  try { if (location.search.indexOf('owner=1') > -1) localStorage.setItem('skipgc', 't'); } catch (e) {}

  if (!CODE) return;
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://' + CODE + '.goatcounter.com/count');
  document.head.appendChild(s);
})();
