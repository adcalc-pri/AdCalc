// Basic Consent Mode v2 banner. The Google tag is NOT present until the
// visitor opts in — this script injects googletagmanager.com/gtag/js only on
// accept, so before consent nothing (not even a cookieless ping) reaches
// Google. That removes the "advanced Consent Mode" grey area for EEA/GDPR.
//
// Consent is recorded with a timestamp and a policy version so a later policy
// change can re-prompt, and so the choice is provable, not just applied.
//
// NOTE: no calculator inputs are ever sent — there are no custom gtag events
// anywhere in the app, only anonymous pageviews, and only after consent.
(function () {
  var GA_ID = 'G-ETCBJWFTDX';
  var POLICY_VERSION = '1';            // bump when the privacy policy changes
  var KEY = 'adcalc_consent';          // 'granted' | 'denied'
  var AT_KEY = 'adcalc_consent_at';    // ISO timestamp of the decision
  var VER_KEY = 'adcalc_consent_v';    // policy version the decision was made under

  var saved = null, savedVer = null;
  try {
    saved = localStorage.getItem(KEY);
    savedVer = localStorage.getItem(VER_KEY);
  } catch (e) { /* storage blocked → treat as undecided, no tracking */ }

  var dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1'
    || navigator.globalPrivacyControl === true;

  // A decision under an older policy version is stale → re-prompt.
  var decided = (saved === 'granted' || saved === 'denied')
    && savedVer === POLICY_VERSION;

  var gtagLoaded = false;
  function loadGtag() {
    if (gtagLoaded) return;
    gtagLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  // Returning visitor who already granted (current policy) and isn't sending a
  // DNT/GPC signal → honour it and load the tag now.
  if (decided && saved === 'granted' && !dnt) {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: 'granted' });
    }
    loadGtag();
    return;
  }
  // Already declined under the current policy, or a DNT/GPC signal with no
  // explicit prior choice → no tag, no banner.
  if ((decided && saved === 'denied') || (dnt && !decided)) return;

  function record(grant) {
    try {
      localStorage.setItem(KEY, grant ? 'granted' : 'denied');
      localStorage.setItem(AT_KEY, new Date().toISOString());
      localStorage.setItem(VER_KEY, POLICY_VERSION);
    } catch (e) {}
  }

  function decide(grant) {
    record(grant);
    if (grant) {
      if (typeof window.gtag === 'function') {
        window.gtag('consent', 'update', { analytics_storage: 'granted' });
      }
      loadGtag();
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
      + 'no ad tracking) to improve the tool. Optional, and Google’s tag '
      + 'is not loaded unless you allow it. '
      + '<a href="privacy.html" target="_blank" rel="noopener">Privacy &amp; what we collect</a>.</p>'
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
