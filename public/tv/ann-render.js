/**
 * The announcement renderer, shared by the TV and by both consoles.
 *
 * The consoles show a live miniature of each card so the person writing it can
 * see what the room will see. That miniature is only worth having if it is the
 * same code -- a second implementation would agree on the day it was written
 * and quietly diverge from the board thereafter.
 */
(function (root) {
  var ACCENTS = ['gold', 'blue', 'green', 'purple', 'teal', 'orange', 'pink', 'red'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /**
   * 'auto' picks the layout from the picture's own shape, which the console
   * records at upload time.
   */
  function pickImageLayout(a, isSolo) {
    var mode = a.imageLayout || 'auto';
    if (!a.image) return 'none';
    if (mode === 'solo') return 'side';
    if (mode !== 'auto') return mode;
    var w = a.imageW || 0, h = a.imageH || 0;
    var text = (a.title || '').length + (a.body || '').length;

    if (!text && mode === 'auto') return 'bg';

    if (w && h) {
      var ratio = h / w;
      // Portrait and square photos look fantastic side-by-side filling full height
      if (ratio >= 0.78) return 'side';
      // Wide landscape photos look best with header/caption above and photo expanding below
      return 'top';
    }
    return 'side';
  }

  function accentOf(a, i) {
    var accent = a.accent && ACCENTS.indexOf(a.accent) !== -1 ? a.accent : ACCENTS[(i || 0) % ACCENTS.length];
    if ((a.emphasis === 'urgent') && !a.accent) accent = 'red';
    return accent;
  }

  function html(a, i, opts) {
    var isSolo = !!(opts && opts.solo) || !!a.soloPage || a.imageLayout === 'solo' || a.span === 'page';
    var accent = accentOf(a, i);
    var emph = a.emphasis === 'highlight' || a.emphasis === 'urgent' ? a.emphasis : 'normal';

    var chips = '';
    if (emph === 'urgent') chips += '<span class="ann-chip solid">' + esc(a.label || 'Urgent') + '</span>';
    else if (a.label) chips += '<span class="ann-chip">' + esc(a.label) + '</span>';
    if (a.when) chips += '<span class="ann-chip when">' + esc(a.when) + '</span>';
    if (chips) chips = '<div class="ann-chips">' + chips + '</div>';

    var title = a.title ? '<div class="ann-title">' + esc(a.title) + '</div>' : '';
    var body = a.body ? '<div class="ann-body">' + esc(a.body) + '</div>' : '';
    var lay = pickImageLayout(a, isSolo);
    var fitMode = a.imageFit || 'contain';
    var sizeMode = a.imageSize || 'fill';
    var imgCls = 'fit-' + esc(fitMode) + ' foc-' + esc(a.imageFocus || 'center') + ' size-' + esc(sizeMode);
    var soloCls = isSolo ? ' solo-page' : '';
    var open = '<div class="ann' + soloCls + ' emph-' + emph + ' lay-' + lay + '" style="--acc:var(--acc-' + accent + ')">';

    if (isSolo) {
      if (lay === 'bg') {
        return open + '<img class="ann-bg-img ' + imgCls + '" src="' + esc(a.image) + '" alt="">'
          + '<div class="ann-bg-text">' + chips + title + body + '</div></div>';
      }
      if (lay === 'side') {
        return open + (a.image ? '<div class="ann-solo-side-frame"><img class="ann-solo-img ' + imgCls + '" src="' + esc(a.image) + '" alt=""></div>' : '')
          + '<div class="ann-solo-side-text">' + chips + title + body + '</div></div>';
      }
      if (lay === 'top') {
        return open + '<div class="ann-solo-top-head">' + chips + title + body + '</div>'
          + (a.image ? '<div class="ann-solo-top-frame"><img class="ann-solo-img ' + imgCls + '" src="' + esc(a.image) + '" alt=""></div>' : '')
          + '</div>';
      }
    }

    if (lay === 'bg') {
      return open + '<img class="ann-bg-img ' + imgCls + '" src="' + esc(a.image) + '" alt="">'
        + '<div class="ann-bg-text">' + chips + title + body + '</div></div>';
    }
    if (lay === 'side') {
      return open + (a.image ? '<div class="ann-frame"><img class="' + imgCls + '" src="' + esc(a.image) + '" alt=""></div>' : '')
        + '<div class="ann-side-text">' + chips + title + body + '</div></div>';
    }
    var img = a.image
      ? '<div class="ann-top-frame"><img class="ann-img ' + imgCls + '" src="' + esc(a.image) + '" alt=""></div>'
      : '';
    return open + img + chips + title + body + '</div>';
  }

  /** Every field an announcement carries, so nothing is ever undefined. */
  function blank(extra) {
    return Object.assign({
      title: '', body: '', image: '', imageSize: 'fill', imageFit: 'contain',
      imageLayout: 'auto', imageFocus: 'center', imageW: 0, imageH: 0,
      accent: '', emphasis: 'normal', label: '', when: '',
      soloPage: false, span: 'auto', starts: '', ends: '', pinned: false
    }, extra || {});
  }

  /**
   * Parse date-only or date-time strings into timestamp milliseconds.
   * - If date-only '2026-08-26' is passed as isEnd=true, it counts as 23:59:59.999 of that day.
   * - If date-only is passed as isEnd=false, it counts as 00:00:00.000 of that day.
   */
  function parseTimestamp(str, isEnd) {
    if (!str) return null;
    str = String(str).trim();
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      var d = new Date(str + (isEnd ? 'T23:59:59' : 'T00:00:00'));
      return isNaN(d.getTime()) ? null : d.getTime();
    }
    var d2 = new Date(str);
    return isNaN(d2.getTime()) ? null : d2.getTime();
  }

  /** Scheduling state, minute-precise so events conclude exactly on time. */
  function stateOf(a, nowMs) {
    if (!a.title && !a.body && !a.image) return 'blank';
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var s = parseTimestamp(a.starts, false);
    if (s != null && now < s) return 'scheduled';
    var e = parseTimestamp(a.ends, true);
    if (e != null && now > e) return 'expired';
    return 'live';
  }

  /**
   * Human-friendly countdown or status string.
   */
  function countdownLabel(a, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var st = stateOf(a, now);
    if (st === 'blank') return 'Draft / Empty';

    if (st === 'scheduled') {
      var s = parseTimestamp(a.starts, false);
      if (!s) return 'Scheduled';
      var diffM = Math.round((s - now) / 60000);
      if (diffM <= 60) return 'Starts in ' + Math.max(1, diffM) + 'm';
      var diffH = Math.round(diffM / 60);
      if (diffH < 24) return 'Starts in ' + diffH + 'h';
      var diffD = Math.round(diffH / 24);
      return 'Starts in ' + diffD + 'd';
    }

    if (st === 'expired') {
      var e = parseTimestamp(a.ends, true);
      if (!e) return 'Expired';
      var pastM = Math.round((now - e) / 60000);
      if (pastM <= 60) return 'Expired ' + Math.max(1, pastM) + 'm ago';
      var pastH = Math.round(pastM / 60);
      if (pastH < 24) return 'Expired ' + pastH + 'h ago';
      var pastD = Math.round(pastH / 24);
      return 'Expired ' + pastD + 'd ago';
    }

    // Live state
    var end = parseTimestamp(a.ends, true);
    if (!end) return 'Live · No expiry';
    var remM = Math.round((end - now) / 60000);
    if (remM <= 0) return 'Expiring now';
    if (remM <= 60) return 'Expires in ' + remM + 'm';
    var remH = Math.round(remM / 60);
    if (remH < 24) return 'Expires in ' + remH + 'h';
    var remD = Math.round(remH / 24);
    return 'Expires in ' + remD + 'd';
  }

  /**
   * Estimates adaptive reading time in seconds for a single announcement.
   */
  function estimateReadingSeconds(a) {
    var text = ((a.title || '') + ' ' + (a.body || '') + ' ' + (a.label || '')).trim();
    var words = text ? text.split(/\s+/).length : 0;
    // ~200 WPM = 3.3 words/sec. Base 4.5 seconds + 0.3s per word + 3.5s for pictures.
    var sec = 4.5 + (words * 0.3);
    if (a.image) sec += 3.5;
    if (a.emphasis === 'urgent') sec += 2;
    return Math.round(sec);
  }

  /**
   * Calculates optimal display time for a page containing 1 or more announcements.
   */
  function estimatePageSeconds(announcements, minSec, maxSec) {
    minSec = minSec || 8;
    maxSec = maxSec || 35;
    if (!announcements || !announcements.length) return minSec;
    var total = 0;
    for (var i = 0; i < announcements.length; i++) {
      total += estimateReadingSeconds(announcements[i]);
    }
    // With multiple items on one page, slight discount for simultaneous scanning
    if (announcements.length > 1) {
      total = total * 0.8;
    }
    return Math.min(maxSec, Math.max(minSec, Math.round(total)));
  }

  root.AnnRender = {
    ACCENTS: ACCENTS, esc: esc, html: html, blank: blank,
    pickImageLayout: pickImageLayout, accentOf: accentOf, stateOf: stateOf,
    parseTimestamp: parseTimestamp, countdownLabel: countdownLabel,
    estimateReadingSeconds: estimateReadingSeconds, estimatePageSeconds: estimatePageSeconds
  };
})(typeof window !== 'undefined' ? window : global);
