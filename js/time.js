/** time.js — TimeState: pub/sub time manager with timezone support. */
const TimeState = (() => {
  let baseline = new Date();
  let offsetMinutes = 0;
  let _timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (_) {
      return 'UTC';
    }
  })();
  const subscribers = [];

  function _compute() {
    return new Date(baseline.getTime() + offsetMinutes * 60000);
  }

  function _notify(date) {
    subscribers.forEach((fn) => fn(date));
  }

  // Discrete-navigation channel, separate from `subscribers`. Only jumpTo() fires
  // it, so a listener here reacts to deliberate one-shot jumps (event cards,
  // ecliptic click, sunrise) but not to slider scrub, playback, or programmatic
  // setTime — that distinction is what lets trajectory reset skip continuous
  // scrubbing and the trajectory-marker's own click-to-jump.
  const _jumpSubs = [];

  function _notifyJump() {
    _jumpSubs.forEach((fn) => fn());
  }

  // ---- Valid range clamp + out-of-range notification ----
  // All date mutations funnel through here so the supported window
  // (2000-01-01 – 2099-12-31 UTC) cannot be escaped by any entry point.
  const _RANGE_MIN = Date.UTC(2000, 0, 1, 0, 0, 0);
  const _RANGE_MAX = Date.UTC(2099, 11, 31, 23, 59, 59);
  const _rangeSubs = [];

  // Clamp `date` to the valid range, reporting whether it was changed.
  function _clampWithFlag(date) {
    const t = date.getTime();
    if (t < _RANGE_MIN) return { date: new Date(_RANGE_MIN), clamped: true };
    if (t > _RANGE_MAX) return { date: new Date(_RANGE_MAX), clamped: true };
    return { date: date, clamped: false };
  }

  function _notifyRange() {
    _rangeSubs.forEach((fn) => fn());
  }

  // Commit a new baseline (slider offset reset to 0), clamping to the valid
  // range and emitting a range event if the target fell outside it. Shared by
  // all baseline-class setters (resetTo / now / adjust*).
  function _commitBaseline(date) {
    const r = _clampWithFlag(date);
    baseline = r.date;
    offsetMinutes = 0;
    _notify(_compute());
    if (r.clamped) _notifyRange();
  }

  // ---- Timezone offset helper ----
  // Returns the UTC offset in minutes for timezone `tz` at the given UTC date.
  function _tzOffset(utcDate, tz) {
    const parts = Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(utcDate);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
    const m = name.match(/GMT([+-]\d{2}):?(\d{2})/);
    if (!m) return 0;
    const h = parseInt(m[1], 10);
    const sign = h < 0 ? -1 : 1;
    return h * 60 + sign * parseInt(m[2], 10);
  }

  // Convert a local date/time (y, mo, d, h, mi, s) in the configured timezone
  // to a UTC Date.  Two-iteration refinement for DST edge cases.
  function _localToUTC(y, mo, d, h, mi, s, tz) {
    const naive = Date.UTC(y, mo, d, h, mi, s);
    let offset = _tzOffset(new Date(naive), tz);
    let utc = naive - offset * 60000;
    offset = _tzOffset(new Date(utc), tz);
    utc = naive - offset * 60000;
    return new Date(utc);
  }

  // ---- Timezone list ----
  // stdOffsetMin = standard-time UTC offset in minutes (for DST detection)
  const _TZ_OFFSETS = [
    { stdOffsetMin: -720, value: 'Etc/GMT+12' },
    { stdOffsetMin: -660, value: 'Pacific/Pago_Pago' },
    { stdOffsetMin: -600, value: 'Pacific/Honolulu' },
    { stdOffsetMin: -570, value: 'Pacific/Marquesas' },
    { stdOffsetMin: -540, value: 'Pacific/Gambier' },
    { stdOffsetMin: -480, value: 'America/Los_Angeles' },
    { stdOffsetMin: -420, value: 'America/Denver' },
    { stdOffsetMin: -420, value: 'America/Phoenix' },
    { stdOffsetMin: -360, value: 'America/Chicago' },
    { stdOffsetMin: -360, value: 'America/Mexico_City' },
    { stdOffsetMin: -300, value: 'America/New_York' },
    { stdOffsetMin: -300, value: 'America/Lima' },
    { stdOffsetMin: -240, value: 'America/Santiago' },
    { stdOffsetMin: -240, value: 'America/Caracas' },
    { stdOffsetMin: -180, value: 'America/Sao_Paulo' },
    { stdOffsetMin: -120, value: 'Atlantic/South_Georgia' },
    { stdOffsetMin: -60, value: 'Atlantic/Azores' },
    { stdOffsetMin: -60, value: 'Atlantic/Cape_Verde' },
    { stdOffsetMin: 0, value: 'Europe/London' },
    { stdOffsetMin: 60, value: 'Africa/Casablanca' },
    { stdOffsetMin: 60, value: 'Europe/Paris' },
    { stdOffsetMin: 120, value: 'Europe/Athens' },
    { stdOffsetMin: 120, value: 'Africa/Cairo' },
    { stdOffsetMin: 180, value: 'Europe/Moscow' },
    { stdOffsetMin: 210, value: 'Asia/Tehran' },
    { stdOffsetMin: 240, value: 'Asia/Dubai' },
    { stdOffsetMin: 270, value: 'Asia/Kabul' },
    { stdOffsetMin: 300, value: 'Asia/Karachi' },
    { stdOffsetMin: 330, value: 'Asia/Kolkata' },
    { stdOffsetMin: 345, value: 'Asia/Kathmandu' },
    { stdOffsetMin: 360, value: 'Asia/Dhaka' },
    { stdOffsetMin: 390, value: 'Asia/Yangon' },
    { stdOffsetMin: 420, value: 'Asia/Bangkok' },
    { stdOffsetMin: 480, value: 'Asia/Shanghai' },
    { stdOffsetMin: 525, value: 'Australia/Eucla' },
    { stdOffsetMin: 540, value: 'Asia/Tokyo' },
    { stdOffsetMin: 570, value: 'Australia/Adelaide' },
    { stdOffsetMin: 570, value: 'Australia/Darwin' },
    { stdOffsetMin: 600, value: 'Australia/Sydney' },
    { stdOffsetMin: 600, value: 'Australia/Brisbane' },
    { stdOffsetMin: 630, value: 'Australia/Lord_Howe' },
    { stdOffsetMin: 660, value: 'Pacific/Noumea' },
    { stdOffsetMin: 720, value: 'Pacific/Auckland' },
    { stdOffsetMin: 720, value: 'Pacific/Fiji' },
    { stdOffsetMin: 780, value: 'Pacific/Apia' },
    { stdOffsetMin: 840, value: 'Pacific/Kiritimati' },
  ];

  function _formatOffset(minutes) {
    const sign = minutes >= 0 ? '+' : '−';
    const abs = Math.abs(minutes);
    const h = String(Math.floor(abs / 60)).padStart(2, '0');
    const m = String(abs % 60).padStart(2, '0');
    return 'UTC' + sign + h + ':' + m;
  }

  function _tzLabel(tz) {
    const _t =
      typeof I18n !== 'undefined'
        ? I18n.t.bind(I18n)
        : function (k) {
            return k;
          };
    const currentOffset = _tzOffset(_compute(), tz.value);
    const offsetStr = _formatOffset(currentOffset);

    const cities = _t('tz.' + tz.value);
    const cityStr = cities.startsWith('tz.') ? tz.value.split('/').pop().replace(/_/g, ' ') : cities;

    const isDST = currentOffset > tz.stdOffsetMin;
    const dstSuffix = isDST ? ' (' + _t('tz.dst') + ')' : '';
    return offsetStr + '  ' + cityStr + dstSuffix;
  }

  function _buildTimezones() {
    return _TZ_OFFSETS
      .map((tz) => ({
        value: tz.value,
        get label() {
          return _tzLabel(tz);
        },
        _sortKey: _tzOffset(_compute(), tz.value),
      }))
      .sort((a, b) => a._sortKey - b._sortKey);
  }

  const _LANG_DEFAULT_TZ = {
    'zh-Hans': 'Asia/Shanghai',
    'zh-Hant': 'Asia/Shanghai',
    en: 'America/New_York',
    fr: 'Europe/Paris',
    es: 'Europe/Paris',
    it: 'Europe/Rome',
    ja: 'Asia/Tokyo',
  };

  // ---- Public API ----

  return {
    get current() {
      return _compute();
    },

    setTime(date) {
      // Clamp the effective time but keep the baseline/offset model intact
      // (resetting baseline would break the locked-range slider centering).
      const r = _clampWithFlag(date);
      offsetMinutes = (r.date.getTime() - baseline.getTime()) / 60000;
      _notify(_compute());
      if (r.clamped) _notifyRange();
    },

    setOffset(minutes) {
      const r = _clampWithFlag(new Date(baseline.getTime() + minutes * 60000));
      offsetMinutes = (r.date.getTime() - baseline.getTime()) / 60000;
      _notify(_compute());
      if (r.clamped) _notifyRange();
    },

    getBaseline() {
      return baseline;
    },

    subscribe(fn) {
      subscribers.push(fn);
    },

    /** Register a callback fired only on discrete jumps (jumpTo), not on scrub/playback. */
    subscribeJump(fn) {
      _jumpSubs.push(fn);
    },

    /**
     * Set the time as a discrete navigation jump: notify jump-listeners first
     * (so e.g. trajectory reset runs before any regular subscriber rebuilds at
     * the new time), then apply it. Continuous scrub / playback / restore stay
     * on setTime and are unaffected.
     */
    jumpTo(date) {
      _notifyJump();
      this.setTime(date);
    },

    /** Register a callback fired whenever a date is clamped to the valid range. */
    onRangeClamp(fn) {
      _rangeSubs.push(fn);
    },

    /** Reset baseline to `date` and clear the slider offset. */
    resetTo(date) {
      _commitBaseline(new Date(date));
    },

    /** Jump to now (real clock time). */
    now() {
      _commitBaseline(new Date());
    },

    // ---- Timezone ----

    get timezone() {
      return _timezone;
    },

    setTimezone(tz) {
      if (tz !== _timezone) {
        _timezone = tz;
        _notify(_compute());
      }
    },

    get timezones() {
      return _buildTimezones();
    },

    initTimezone(locale) {
      if (_timezone === 'UTC' && locale && _LANG_DEFAULT_TZ[locale]) {
        _timezone = _LANG_DEFAULT_TZ[locale];
      }
    },

    // ---- Preset jumps (adjust baseline, reset slider) ----

    adjustYears(years) {
      const date = _compute();
      const parts = Intl.DateTimeFormat('en', {
        timeZone: _timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const get = (t) => parseInt(parts.find((p) => p.type === t).value);

      let y = get('year') + years;
      const mo = get('month') - 1;
      const d = get('day');
      const h = get('hour');
      const mi = get('minute');
      const s = get('second');

      // Clamp day if month overflow
      const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      const dd = Math.min(d, daysInMonth);

      _commitBaseline(_localToUTC(y, mo, dd, h, mi, s, _timezone));
    },

    adjustMonths(months) {
      const date = _compute();
      const parts = Intl.DateTimeFormat('en', {
        timeZone: _timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const get = (t) => parseInt(parts.find((p) => p.type === t).value);

      const y = get('year');
      let mo = get('month') - 1 + months;
      const d = get('day');
      const h = get('hour');
      const mi = get('minute');
      const s = get('second');

      // Normalise month overflow
      let yy = y + Math.floor(mo / 12);
      mo = mo % 12;
      if (mo < 0) {
        mo += 12;
        yy -= 1;
      }

      const daysInMonth = new Date(Date.UTC(yy, mo + 1, 0)).getUTCDate();
      const dd = Math.min(d, daysInMonth);

      _commitBaseline(_localToUTC(yy, mo, dd, h, mi, s, _timezone));
    },

    adjustDays(days) {
      _commitBaseline(new Date(_compute().getTime() + days * 86400000));
    },

    adjustHours(hours) {
      _commitBaseline(new Date(_compute().getTime() + hours * 3600000));
    },

    adjustMinutes(mins) {
      _commitBaseline(new Date(_compute().getTime() + mins * 60000));
    },

    adjustSeconds(secs) {
      _commitBaseline(new Date(_compute().getTime() + secs * 1000));
    },

    adjustWeeks(weeks) {
      this.adjustDays(weeks * 7);
    },

    // ---- Playback (60 fps loop, configurable speed multiplier) ----
    // Each frame advances simulated time by `baseSecondsPerFrame * speed`.
    // 1× ≈ 1 simulated minute per real second; 16× compresses ~16 minutes/sec.
    _playInterval: null,
    _playSpeed: 1,

    isPlaying() {
      return this._playInterval !== null;
    },

    setPlaySpeed(s) {
      this._playSpeed = s;
    },

    startPlayback(speed) {
      if (typeof speed === 'number') this._playSpeed = speed;
      if (this._playInterval) return;
      // `_playSpeed` is the simulated-to-real ratio (spec 4.3):
      //   1x = realtime, 60x = 1 minute/sec, 360x = 6 minutes/sec.
      // Real frame interval is 50 ms (20 fps), so simulated ms per frame =
      // _playSpeed * 50.
      const frameMs = 50;
      const self = this;
      this._playInterval = setInterval(function () {
        const next = new Date(_compute().getTime() + self._playSpeed * frameMs);
        const r = _clampWithFlag(next);
        self.setTime(r.date);
        // Hitting a boundary auto-stops playback and notifies once, rather than
        // pinning at the edge and re-firing the range event every frame.
        if (r.clamped) {
          self.stopPlayback();
          _notifyRange();
        }
      }, frameMs);
    },

    stopPlayback() {
      if (this._playInterval) {
        clearInterval(this._playInterval);
        this._playInterval = null;
      }
    },

    // ---- Formatting ----

    /** Format a Date as ISO-like string in the configured timezone. */
    formatISO(date) {
      const fmt = Intl.DateTimeFormat('en', {
        timeZone: _timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(date);
      const g = (t) => parts.find((p) => p.type === t).value;
      return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
    },

    /**
     * Parse an ISO-like string (YYYY-MM-DD HH:MM:SS) interpreted in the
     * configured timezone, returning a UTC Date (or null if invalid).
     */
    parseISO(str) {
      const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
      if (!m) return null;
      const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
      return _localToUTC(y, mo - 1, d, h, mi, s, _timezone);
    },

    /** Format a Date as HH:MM:SS in the configured timezone. */
    formatTime(date, showSeconds) {
      if (!date || isNaN(date.getTime())) return '—';
      const opts = {
        timeZone: _timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      };
      if (showSeconds !== false) opts.second = '2-digit';
      const parts = Intl.DateTimeFormat('en', opts).formatToParts(date);
      const h = parts.find((p) => p.type === 'hour').value;
      const mi = parts.find((p) => p.type === 'minute').value;
      if (showSeconds === false) return `${h}:${mi}`;
      const s = parts.find((p) => p.type === 'second').value;
      return `${h}:${mi}:${s}`;
    },

    /** Format a Date as HH:MM rounded to the nearest `stepMin` minutes, in the configured timezone. */
    formatTimeRounded(date, stepMin = 10) {
      if (!date || isNaN(date.getTime())) return '—';
      const parts = Intl.DateTimeFormat('en', {
        timeZone: _timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const g = (t) => +parts.find((p) => p.type === t).value;
      let mins = g('hour') * 60 + g('minute') + g('second') / 60;
      mins = Math.round(mins / stepMin) * stepMin;
      mins = ((mins % 1440) + 1440) % 1440; // wrap into [0,1440)
      const h = String(Math.floor(mins / 60)).padStart(2, '0');
      const m = String(mins % 60).padStart(2, '0');
      return `${h}:${m}`;
    },

    /** Clamp a Date to the valid range (2000-01-01 – 2099-12-31 UTC). */
    clampDate(date) {
      return _clampWithFlag(date).date;
    },

    // ---- Range lock (for eclipse playback windows) ----
    // When a lock is active the slider's effective range narrows to the
    // window. Subscribers can read `lockedRange` to size their own controls.
    _lockedRange: null,
    get lockedRange() {
      return this._lockedRange;
    },
    lockRange(from, to) {
      if (!(from instanceof Date) || !(to instanceof Date)) return;
      if (to <= from) return;
      this._lockedRange = { from: new Date(from), to: new Date(to) };
      // Re-anchor baseline to the midpoint so ±slider stays centered on G
      baseline = new Date((from.getTime() + to.getTime()) / 2);
      offsetMinutes = 0;
      _notify(_compute());
    },
    unlockRange() {
      if (this._lockedRange) {
        this._lockedRange = null;
        _notify(_compute());
      }
    },

    /** Valid range boundaries (for the time-input min/max attributes). */
    get VALID_MIN() {
      return '2000-01-01 00:00:00';
    },
    get VALID_MAX() {
      return '2099-12-31 23:59:59';
    },

    // Exclusive year boundary (derived from _RANGE_MAX, not a second hardcoded
    // literal) for copy like "no more events before {year}" that must track
    // the site's supported range without a separate edit on every extension.
    get RANGE_END_YEAR_EXCLUSIVE() {
      return new Date(_RANGE_MAX).getUTCFullYear() + 1;
    },
  };
})();
