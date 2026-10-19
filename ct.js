/* App Store ct passthrough (Remnant UTM convention, ledger/utm-convention.md, 2026-10-04).
   ct = utm_campaign + '-' + utm_content (content: alphanumerics and '-' only), max 40 chars.
   No utm_campaign on the URL (or earlier in this session) -> the page's data-fallback-ct.
   pt= is intentionally not set: never invent the provider token. */
(function () {
  var s = document.currentScript;
  var fallback = (s && s.getAttribute('data-fallback-ct')) || '';
  var clean = function (v) { return (v || '').replace(/[^A-Za-z0-9-]/g, ''); };
  var ct = '';
  try {
    var p = new URLSearchParams(window.location.search);
    var camp = clean(p.get('utm_campaign'));
    var content = clean(p.get('utm_content'));
    if (camp) {
      ct = (content ? camp + '-' + content : camp).slice(0, 40);
      try { sessionStorage.setItem('remnant_ct', ct); } catch (e) {}
    } else {
      try { ct = sessionStorage.getItem('remnant_ct') || ''; } catch (e) {}
    }
  } catch (e) {}
  if (!ct) ct = fallback;
  if (!ct) return;
  var links = document.querySelectorAll('a[href*="apps.apple.com"]');
  for (var i = 0; i < links.length; i++) {
    try {
      var u = new URL(links[i].href);
      u.searchParams.set('ct', ct);
      links[i].href = u.toString();
    } catch (e) {}
  }
})();
