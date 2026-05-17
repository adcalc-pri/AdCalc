// Consent banner for the (consent-gated) Google tag. Analytics is denied by
// default via Consent Mode v2 (set inline in <head> before gtag loads); this
// only renders the opt-in UI and flips analytics_storage on accept.
//
// NOTE: nothing about the user's calculator inputs is ever sent — there are
// no custom gtag events anywhere in the app, only anonymous pageviews, and
// only after explicit consent. This keeps the "nothing leaves your browser"
// promise intact for the actual data; the tracker itself is opt-in.
(function () {
  var KEY = 'adcalc_consent';
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }

  var dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1'
    || navigator.globalPrivacyControl === true;

  // Already decided, or the browser signalled "do not track" → no banner.
  if (saved === 'granted' || saved === 'denied' || (dnt && !saved)) return;

  function decide(grant) {
    try { localStorage.setItem(KEY, grant ? 'granted' : 'denied'); } catch (e) {}
    if (grant && typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: 'granted' });
    }
    var b = document.getElementById('consentBar');
    if (b) b.remove();
  }

  function render() {
    if (document.getElementById('consentBar')) return;
    var bar = document.createElement('div');
    bar.id = 'consentBar';
    bar.className = 'consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Analytics consent');
    bar.innerHTML =
      '<p>AdCalc itself sends nothing — all calculation stays in your '
      + 'browser. We’d like anonymous page analytics (no personal data, '
      + 'no ad tracking) to improve the tool. Optional.</p>'
      + '<div class="consent-btns">'
      + '<button type="button" class="btn btn-tertiary btn-sm" id="consentNo">Decline</button>'
      + '<button type="button" class="btn btn-primary btn-sm" id="consentYes">Allow analytics</button>'
      + '</div>';
    document.body.appendChild(bar);
    document.getElementById('consentYes').addEventListener('click', function () { decide(true); });
    document.getElementById('consentNo').addEventListener('click', function () { decide(false); });
  }

  if (document.body) render();
  else addEventListener('DOMContentLoaded', render);
})();
