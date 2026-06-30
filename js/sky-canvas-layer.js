/**
 * sky-canvas-layer.js — Canvas-based star rendering for the Leaflet map.
 *
 * Replaces the per-star SVG circleMarker + divIcon-glow approach with one
 * canvas element, dropping DOM node count from ~43k to 1 at z=10 (and avoiding
 * thousands of blend layers + 50k setLatLng/setStyle calls per tick).
 *
 * Public API:
 *   const layer = new SkyCanvasLayer({
 *     iterEntries: (cb) => { ... },     // yield each attached entry
 *     getContext:  () => ({ gmst, cutoff, scale }),  // pulled each redraw
 *     onClick:     (entry, ev) => ...,
 *   });
 *   layer.addTo(map);
 *   layer.redraw();               // throttled to rAF
 *   layer.hitTest(point, tol);    // returns nearest attached entry
 *
 * Entry shape consumed:
 *   { star: {ra, dec, mag}, _lnB, _tint, _glowTint, _glareR,
 *     visualR, _adaptAf }
 *
 * Note: opacity is recomputed live per redraw via Lum.coreOpacity (no cached
 * `baseOpacity`), so coreFloor / chromaScale changes apply without a reload.
 *
 * Depends on Lum (luminosity.js) for glowRadius, coreColor, coreOpacity.
 */
const SkyCanvasLayer =
  typeof L !== 'undefined'
    ? L.Layer.extend({
        options: {
          iterEntries: null,
          getContext: null,
          onClick: null,
          onContextMenu: null, // (entry, ev) — right-click on a canvas star
          blendMode: 'lighter', // additive; falls back to 'screen' if too bright
          paneName: 'sky-stars',
          // Oversize canvas relative to viewport so mid-drag pans don't
          // expose blank strips (Leaflet keeps the canvas in place via CSS transform
          // during the drag; only moveend triggers a redraw at the new position).
          // 0.5 ≈ canvas is 2× viewport in each dim → 4× pixels, but tolerates ~50%
          // viewport-width drag before the user sees an empty edge.
          padding: 0.5,
        },

        initialize: function (options) {
          L.setOptions(this, options);
          this._spriteCache = new Map(); // 'glow:<hex>' | 'glare:<hex>' → HTMLCanvasElement
          this._lastDraw = []; // [{entry, x, y, r}] for hit testing
          this._rafHandle = null;
          this._canvas = null;
          this._ctx = null;
          this._w = 0;
          this._h = 0;
          this._padX = 0;
          this._padY = 0;
          this._dpr = 1;
          this._drawZoom = null; // map zoom at last full redraw (transform base for flyTo tracking)
          this._drawTLLatLng = null; // latlng under the canvas top-left when last drawn
          // Hover state
          this._hoverEntry = null;
          this._hoverRaf = null;
        },

        onAdd: function (map) {
          this._map = map;
          const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated sky-stars-canvas');
          canvas.style.pointerEvents = 'none';
          canvas.style.position = 'absolute';
          canvas.style.top = '0';
          canvas.style.left = '0';
          this._canvas = canvas;

          const pane = map.getPane(this.options.paneName) || map.getPane('overlayPane');
          pane.appendChild(canvas);

          map.on(
            {
              viewreset: this._reset,
              zoom: this._onZoom,
              zoomend: this._onZoomEnd,
              moveend: this._reset,
              resize: this._reset,
              zoomanim: this._animateZoom,
              click: this._onMapClick,
              contextmenu: this._onMapContextMenu,
              mousemove: this._onMapMouseMove,
              mouseout: this._onMapMouseOut,
            },
            this
          );

          // Forward star click via the map-level click handler.
          this._reset();
        },

        onRemove: function (map) {
          if (this._canvas && this._canvas.parentNode) {
            this._canvas.parentNode.removeChild(this._canvas);
          }
          if (this._hoverRaf != null) {
            cancelAnimationFrame(this._hoverRaf);
            this._hoverRaf = null;
          }
          this._map.getContainer().style.cursor = '';
          map.off(
            {
              viewreset: this._reset,
              zoom: this._onZoom,
              zoomend: this._onZoomEnd,
              moveend: this._reset,
              resize: this._reset,
              zoomanim: this._animateZoom,
              click: this._onMapClick,
              contextmenu: this._onMapContextMenu,
              mousemove: this._onMapMouseMove,
              mouseout: this._onMapMouseOut,
            },
            this
          );
          this._canvas = null;
          this._ctx = null;
          if (this._rafHandle) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
          }
        },

        /**
         * Leaflet zoom animation hook — translate the canvas during the zoom
         * tween so it tracks the basemap; we redraw after the animation lands.
         */
        _animateZoom: function (ev) {
          const m = this._map;
          if (!m) return;
          const scale = m.getZoomScale(ev.zoom, m.getZoom());
          // Anchor on the canvas's actual top-left (container (-padX,-padY)), not the
          // viewport NW — getBounds().getNorthWest() (container [0,0]) mismatches and
          // causes a padding-sized slide during the zoom tween that snaps back.
          const canvasTLLatLng = m.containerPointToLatLng([-this._padX, -this._padY]);
          const offset = m._latLngToNewLayerPoint(canvasTLLatLng, ev.zoom, ev.center);
          L.DomUtil.setTransform(this._canvas, offset, scale);
        },

        _onZoom: function () {
          // flyTo (the place-name jump) drives its arc by firing `zoom` every
          // frame while it mutates the fractional zoom — it never fires
          // `zoomanim`, so _animateZoom stays dormant. Without tracking here the
          // canvas freezes mid-flight while tiles/grids/labels fly, then snaps at
          // moveend. Re-apply the same translate+scale _animateZoom uses, but
          // anchored to the view we last drew at (stored in _reset) since the map
          // state is already committed by the time this `zoom` event fires.
          const m = this._map;
          if (!m || !this._canvas || this._drawTLLatLng == null) return;
          const z = m.getZoom();
          // CSS-scaling the frozen bitmap by 2^Δz is right for positions but
          // wrong for the gently zoom-scaled star sprites (1.15^Δz) — past ~half
          // a zoom level the dots balloon into blurry blobs. So when the flight
          // has drifted ≥0.5 level from the raster we drew, re-rasterize at the
          // live zoom (re-project + re-size crisp, like a tile pyramid switching
          // levels); within a level the transform stays imperceptible.
          if (Math.abs(z - this._drawZoom) >= 0.5) {
            this._reset();
            return;
          }
          const scale = m.getZoomScale(z, this._drawZoom);
          const offset = m._latLngToNewLayerPoint(this._drawTLLatLng, z, m.getCenter());
          L.DomUtil.setTransform(this._canvas, offset, scale);
        },

        _onZoomEnd: function () {
          this._reset();
        },

        /**
         * Resize / reposition canvas to match the current viewport, then redraw.
         * Called on add, moveend (drag finish), zoomend, viewreset, resize.
         */
        _reset: function () {
          if (!this._map || !this._canvas) return;
          const size = this._map.getSize();
          const padding = this.options.padding || 0;
          const padX = Math.round(size.x * padding);
          const padY = Math.round(size.y * padding);
          // Position canvas at (-padX, -padY) container pt so its TL is
          // padX/padY left/above the viewport. Combined with the oversized
          // width/height below, the canvas extends padX/padY beyond every edge.
          const tl = this._map.containerPointToLayerPoint([-padX, -padY]);
          L.DomUtil.setPosition(this._canvas, tl);
          // Do NOT clear style.transform here — L.DomUtil.setPosition above is
          // *itself* a style.transform write (translate3d). The previous
          // `style.transform = ''` line cancelled that, leaving the canvas at
          // pane-local (0,0) and producing a constant offset that grew visible
          // once R6 added padding. transformOrigin still set for safety.
          this._canvas.style.transformOrigin = '0 0';

          const dpr = window.devicePixelRatio || 1;
          const w = size.x + padX * 2;
          const h = size.y + padY * 2;
          if (this._canvas.width !== w * dpr || this._canvas.height !== h * dpr) {
            this._canvas.width = w * dpr;
            this._canvas.height = h * dpr;
            this._canvas.style.width = w + 'px';
            this._canvas.style.height = h + 'px';
          }
          this._w = w;
          this._h = h;
          this._padX = padX;
          this._padY = padY;
          this._dpr = dpr;
          this._ctx = this._canvas.getContext('2d');
          // Anchor for _onZoom's flyTo tracking: the zoom and the latlng under the
          // canvas top-left (container [-padX,-padY]) as of THIS draw. _onZoom later
          // scales/translates relative to these to keep the canvas glued to the basemap.
          this._drawZoom = this._map.getZoom();
          this._drawTLLatLng = this._map.containerPointToLatLng([-padX, -padY]);
          // Let the owner sync zoom-dependent draw context (sprite scale) to the
          // zoom we're about to paint at — needed for mid-flyTo re-rasterizations,
          // where zoomend (which normally refreshes the scale) hasn't fired yet.
          if (this.options.onBeforeRedraw) this.options.onBeforeRedraw(this._drawZoom);
          // _reset is the discrete view-settle path (moveend/zoomend/viewreset/resize).
          // setPosition above moved the canvas element THIS frame; repaint synchronously
          // so the relocated element and its fresh pixels composite together. Deferring
          // to rAF (redraw()) leaves one frame showing the moved canvas with stale,
          // pre-pan star pixels — an intermittent flash on mouse release.
          if (this._rafHandle != null) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
          }
          this._doRedraw();
        },

        /**
         * Schedule a redraw on the next animation frame. Coalesces N calls per
         * frame into one redraw.
         */
        redraw: function () {
          if (this._rafHandle != null) return;
          this._rafHandle = requestAnimationFrame(() => {
            this._rafHandle = null;
            this._doRedraw();
          });
        },

        _doRedraw: function () {
          const ctx = this._ctx;
          const map = this._map;
          if (!ctx || !map) return;

          const dpr = this._dpr;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, this._w, this._h);
          ctx.globalCompositeOperation = this.options.blendMode || 'lighter';

          const C = this.options.getContext ? this.options.getContext() : null;
          if (!C) return;
          const { gmst, cutoff, scale, clickMagCutoff } = C;
          if (!Number.isFinite(gmst) || !Number.isFinite(cutoff) || !Number.isFinite(scale)) return;
          // clickMagCutoff: stars dimmer than this are still drawn but excluded from
          // the hit-test table so they cannot be clicked / hovered at low zoom.
          // Falls back to the draw cutoff (all drawn stars clickable) if not provided.
          const _clickMagCutoff = clickMagCutoff != null && Number.isFinite(clickMagCutoff) ? clickMagCutoff : cutoff;

          const w = this._w;
          const h = this._h;
          const padX = this._padX;
          const padY = this._padY;

          const lastDraw = (this._lastDraw = []);

          const iterFn = this.options.iterEntries;
          if (!iterFn) return;

          // 5 wraps cover the full maxBounds range (−200°..+520°); pre-filter by
          // viewport longitude so typical viewports keep only 1-2, cutting projection +
          // arc-draw work by ~3×.
          const wraps = this._visibleWraps();

          // Cached once per redraw — pixelOrigin only changes on zoom/move, both of
          // which trigger _reset() → a fresh redraw, so this stays valid per frame.
          const origin = map.getPixelOrigin();

          iterFn((entry) => {
            const s = entry.star;
            if (s.mag > cutoff) return;
            const adaptF = entry._adaptAf != null ? entry._adaptAf : 1;
            if (adaptF < 0.02) return;

            const ln = entry._lnB;

            // Sub-pixel intensity ramp — coreRadiusEx returns { r, alphaK }.
            // For mag>3.48 stars (ideal radius < 1px), r is locked at R_CORE_MIN
            // and alphaK<1 fades by the lost area ratio, giving a continuous
            // dim-end gradient instead of the discrete 1-px floor.
            const cr = Lum.coreRadiusEx(ln, scale);
            const coreR = cr.r;

            const grEff = Lum.glowRadius(ln, scale);
            const glowR = grEff > 0 ? (entry.visualR + grEff) * scale : 0;
            const glareR = (entry._glareR || 0) * scale;

            const coreColor = Lum.coreColor(entry._tint, s.mag, scale);
            // Opacity computed live each redraw — coreFloor edits take
            // effect immediately without page reload.
            const baseOp = Lum.coreOpacity(ln) * adaptF * cr.alphaK;

            // Substellar (lat, lon) — where this star is at zenith.
            let lon0 = ((((s.ra - gmst) % 360) + 540) % 360) - 180;
            const lat0 = s.dec;

            const margin = Math.max(glowR, glareR, coreR) + 8;

            for (let k = 0; k < wraps.length; k++) {
              const dLon = wraps[k];
              // latLngToContainerPoint() rounds the projected pixel, so during time
              // playback each star crosses an integer boundary at a different sub-pixel
              // phase and shimmers. Project unrounded for fractional canvas coords.
              const lp = map.project([lat0, lon0 + dLon]).subtract(origin); // unrounded layer point
              const p = map.layerPointToContainerPoint(lp); // unrounded container point
              // Add padding offset so canvas pixel = container pixel + (padX, padY).
              const cx = p.x + padX;
              const cy = p.y + padY;
              if (cx < -margin || cx > w + margin || cy < -margin || cy > h + margin) continue;

              if (glareR > 0) {
                const sp = this._getSprite(entry._glowTint || entry._tint, 'glare');
                ctx.globalAlpha = adaptF * 0.6;
                ctx.drawImage(sp, cx - glareR, cy - glareR, glareR * 2, glareR * 2);
              }
              if (glowR > 0) {
                const sp = this._getSprite(entry._glowTint || entry._tint, 'glow');
                ctx.globalAlpha = adaptF;
                ctx.drawImage(sp, cx - glowR, cy - glowR, glowR * 2, glowR * 2);
              }
              ctx.globalAlpha = baseOp;
              ctx.fillStyle = coreColor;
              ctx.beginPath();
              ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
              ctx.fill();

              // Store screen container coords for hit test (matches the click
              // event's containerPoint). Only keep the in-viewport wrap copy so
              // the hover/click doesn't fire from off-screen wrap positions.
              // Stars dimmer than clickMagCutoff are excluded from the hit table so
              // they become non-interactive at low zoom ("dust" stars).
              // Hit radius: half the glow radius so bright stars have a generous
              // click target; dim/unglowd stars fall back to max(coreR, 6).
              if (p.x >= 0 && p.x <= w - padX * 2 && p.y >= 0 && p.y <= h - padY * 2 && s.mag <= _clickMagCutoff) {
                lastDraw.push({ entry, x: p.x, y: p.y, r: Math.max(coreR, glowR * 0.5, 6) });
              }
            }
          });
          ctx.globalAlpha = 1;
        },

        /**
         * Return the COPY_OFFSETS that overlap the current viewport
         * longitude range. Each offset shifts a copy of the sky to lon span
         * [off-180, off+180]; keep only those intersecting [west, east].
         * Typical mid-zoom: 1-2 wraps; z=2 global view: 2-3.
         */
        _visibleWraps: function () {
          const b = this._map.getBounds();
          const west = b.getWest();
          const east = b.getEast();

          const ALL = [-720, -360, 0, 360, 720];
          const out = [];
          for (let i = 0; i < ALL.length; i++) {
            const off = ALL[i];
            if (off + 180 >= west && off - 180 <= east) out.push(off);
          }
          return out.length ? out : [0]; // safety: never return empty
        },

        /**
         * drop all cached sprites so the next redraw rebuilds them
         * with current Lum.params (chromaScale → tint hex, glareAlphaPeak →
         * glare gradient stops). Sky.setChromaScale() and Sky.setGlareAlphaPeak()
         * call this.
         */
        rebuildSpriteCache: function () {
          this._spriteCache.clear();
          this.redraw();
        },

        /**
         * Lazily build (and cache) a PSF sprite for the given tint hex. Each
         * sprite is a 64×64 RGBA canvas rendered once and reused across all
         * stars sharing that tint. `kind` is 'glow' or 'glare'.
         */
        _getSprite: function (tintHex, kind) {
          const key = kind + ':' + tintHex;
          let cv = this._spriteCache.get(key);
          if (cv) return cv;
          const size = 64;
          cv = document.createElement('canvas');
          cv.width = cv.height = size;
          const ctx = cv.getContext('2d');
          const cx = size / 2,
            cy = size / 2,
            r = size / 2;
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          // Parse hex → rgb
          const n = parseInt(tintHex.replace('#', ''), 16);
          const R = (n >> 16) & 0xff,
            G = (n >> 8) & 0xff,
            B = n & 0xff;
          if (kind === 'glow') {
            // Spec §5.2 stops — tinted PSF.
            grad.addColorStop(0, 'rgba(' + R + ',' + G + ',' + B + ',1)');
            grad.addColorStop(0.35, 'rgba(' + R + ',' + G + ',' + B + ',0.95)');
            grad.addColorStop(0.55, 'rgba(' + R + ',' + G + ',' + B + ',0.55)');
            grad.addColorStop(0.78, 'rgba(' + R + ',' + G + ',' + B + ',0.18)');
            grad.addColorStop(1, 'rgba(' + R + ',' + G + ',' + B + ',0)');
          } else {
            // Glare — extremely wide diffuse halo, only used by brightest stars.
            // peak alpha read from Lum.params (live tunable via
            // Sky.setGlareAlphaPeak). Default 0.05; cap at 0.07 — above that
            // Stellarium gets "large halo" bug reports (issue #105).
            const gp = Lum.params && Lum.params.glareAlphaPeak !== undefined ? Lum.params.glareAlphaPeak : 0.05;
            const gp2 = gp * 0.34; // maintain original 0.012/0.035 ratio
            grad.addColorStop(0, 'rgba(' + R + ',' + G + ',' + B + ',' + gp.toFixed(3) + ')');
            grad.addColorStop(0.45, 'rgba(' + R + ',' + G + ',' + B + ',' + gp2.toFixed(3) + ')');
            grad.addColorStop(1, 'rgba(' + R + ',' + G + ',' + B + ',0)');
          }
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, size, size);
          this._spriteCache.set(key, cv);
          return cv;
        },

        /**
         * Find the nearest drawn entry within `tol` px of the given container
         * point. Ties broken by lowest mag (brightest star wins click-merge).
         */
        hitTest: function (point, tol) {
          tol = tol || 12;
          const tol2 = tol * tol;
          let best = null;
          let bestMag = Infinity;
          for (const item of this._lastDraw) {
            const dx = item.x - point.x;
            const dy = item.y - point.y;
            const d2 = dx * dx + dy * dy;
            const maxR2 = Math.max(tol2, (item.r + tol) * (item.r + tol));
            if (d2 > maxR2) continue;
            if (item.entry.star.mag < bestMag) {
              best = item.entry;
              bestMag = item.entry.star.mag;
            }
          }
          return best;
        },

        _onMapClick: function (ev) {
          if (!this.options.onClick) return;
          // A foreground layer (e.g. the body canvas) may own this click — yield if so.
          if (this.options.priorityHitTest && this.options.priorityHitTest(ev.containerPoint)) return;
          const target = this.hitTest(ev.containerPoint, 12);
          if (target) {
            window._skyClickConsumed = true;
            this.options.onClick(target, ev);
          }
        },

        _onMapContextMenu: function (ev) {
          if (!this.options.onContextMenu) return;
          if (this.options.priorityHitTest && this.options.priorityHitTest(ev.containerPoint)) return;
          const target = this.hitTest(ev.containerPoint, 12);
          if (target) {
            window._skyClickConsumed = true;
            if (ev.originalEvent) ev.originalEvent.preventDefault();
            this.options.onContextMenu(target, ev);
          }
        },

        /**
         * hover tracking. canvas itself has pointerEvents: none, so the
         * map's mousemove fires normally; we run hitTest each rAF tick and toggle
         * the cursor on the map container.
         */
        _onMapMouseMove: function (ev) {
          if (this._hoverRaf != null) return;
          const cp = ev.containerPoint;
          this._hoverRaf = requestAnimationFrame(() => {
            this._hoverRaf = null;
            if (!this._map) return;
            const e = this.hitTest(cp, 10);
            if (e === this._hoverEntry) return;
            this._hoverEntry = e;
            this._map.getContainer().style.cursor = e ? 'pointer' : '';
          });
        },

        _onMapMouseOut: function () {
          if (!this._map) return;
          this._hoverEntry = null;
          if (this._hoverRaf != null) {
            cancelAnimationFrame(this._hoverRaf);
            this._hoverRaf = null;
          }
          this._map.getContainer().style.cursor = '';
        },

        spriteCacheSize: function () {
          return this._spriteCache.size;
        },
      })
    : null;
