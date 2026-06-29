/**
 * body-canvas-layer.js — canvas renderer for solar-system bodies' glow + core.
 *
 * Replaces the per-body SVG circleMarker + ~20 `mix-blend-mode: screen` glow
 * divIcons (planets, the Sun, the Moon, and the Galilean/Saturn moons) with a
 * single canvas. Those blended DOM layers each forced the GPU to re-read the
 * basemap backdrop on every composite; at high zoom + moonlight the working set
 * blew past the GPU's VRAM budget and thrashed. One bitmap that only
 * setTransform()s during the zoom tween and repaints on settle removes that
 * whole layer stack — the same trick the star canvas and veil masks already use.
 *
 * The layer owns an authoritative Map of body descriptors keyed by id; map.js's
 * placeWrappedLumBody upserts one per body each update (and removeAllExcept /
 * removeBody prune the rest). Each redraw sorts the descriptors far→near by
 * geocentric distance (painter's algorithm: the nearer body paints last and
 * occludes), projects each to canvas pixels across the visible world-wrap
 * copies, and draws the glare + glow as additive radial gradients and the core
 * as a source-over disc. The disk texture and the name label stay in the DOM
 * (the label so its text remains selectable); the canvas owns hit-testing.
 *
 * Public API:
 *   const layer = new BodyCanvasLayer({ paneName: 'body-canvas' });
 *   layer.addTo(map);
 *   layer.setBody(id, {                 // upsert one body
 *     lat, lng, zKey,                    // zKey = geocentric distance (AU)
 *     glow: { glowR, glareR, coreCol, tint, alpha } | null,
 *     core: { r, color, alpha } | null,
 *     hitR,                              // click radius (covers the disk)
 *     onClick, onContextMenu, tooltipText,
 *   });
 *   layer.removeBody(id);
 *   layer.removeAllExcept(['sun']);      // prune before a full planet refresh
 *   layer.redraw();                      // throttled to rAF
 *
 * Depends on Lum (luminosity.js) only for the _rgba colour helper.
 */
const BodyCanvasLayer =
  typeof L !== 'undefined'
    ? L.Layer.extend({
        options: {
          paneName: 'body-canvas',
          // Oversize the canvas so a mid-drag pan (CSS-translated until moveend)
          // does not expose a blank edge before the redraw. Matches SkyCanvasLayer.
          padding: 0.5,
        },

        initialize: function (options) {
          L.setOptions(this, options);
          this._bodies = new Map(); // id → descriptor
          this._lastDraw = []; // [{entry, x, y, r, lat, lng}] for hit testing
          this._rafHandle = null;
          this._canvas = null;
          this._ctx = null;
          this._w = 0;
          this._h = 0;
          this._padX = 0;
          this._padY = 0;
          this._dpr = 1;
          this._drawZoom = null;
          this._drawTLLatLng = null;
          this._hoverEntry = null;
          this._hoverRaf = null;
          this._tooltip = null;
        },

        onAdd: function (map) {
          this._map = map;
          const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated body-canvas');
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
          if (this._tooltip) map.closeTooltip(this._tooltip);
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

        // ---- Body Registry ----

        setBody: function (id, descriptor) {
          descriptor.id = id;
          this._bodies.set(id, descriptor);
        },

        removeBody: function (id) {
          this._bodies.delete(id);
        },

        // Drop every registered body except the listed ids. updateMarkers calls
        // this before a full planet/moon refresh so hidden or culled bodies
        // (which are simply not re-added) leave no stale glow behind; the Sun is
        // kept because it updates on its own path.
        removeAllExcept: function (keepIds) {
          const keep = new Set(keepIds);
          for (const id of this._bodies.keys()) {
            if (!keep.has(id)) this._bodies.delete(id);
          }
        },

        // ---- Zoom / View Tracking (mirrors SkyCanvasLayer) ----

        // Translate+scale the frozen bitmap during the zoom tween so it tracks
        // the basemap; the crisp repaint happens on zoomend. Anchored on the
        // canvas's actual top-left (container (-padX,-padY)).
        _animateZoom: function (ev) {
          const m = this._map;
          if (!m || !this._canvas) return;
          const scale = m.getZoomScale(ev.zoom, m.getZoom());
          const canvasTLLatLng = m.containerPointToLatLng([-this._padX, -this._padY]);
          const offset = m._latLngToNewLayerPoint(canvasTLLatLng, ev.zoom, ev.center);
          L.DomUtil.setTransform(this._canvas, offset, scale);
        },

        // flyTo drives zoom via `zoom` (never `zoomanim`); track it the same way,
        // re-rasterizing once the flight drifts ≥0.5 level so cores/glows stay crisp.
        _onZoom: function () {
          const m = this._map;
          if (!m || !this._canvas || this._drawTLLatLng == null) return;
          const z = m.getZoom();
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

        // Resize / reposition the canvas to the current viewport (+padding), then
        // repaint synchronously. Called on add, moveend, zoomend, viewreset, resize.
        _reset: function () {
          if (!this._map || !this._canvas) return;
          const size = this._map.getSize();
          const padding = this.options.padding || 0;
          const padX = Math.round(size.x * padding);
          const padY = Math.round(size.y * padding);
          const tl = this._map.containerPointToLayerPoint([-padX, -padY]);
          L.DomUtil.setPosition(this._canvas, tl);
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
          this._drawZoom = this._map.getZoom();
          this._drawTLLatLng = this._map.containerPointToLatLng([-padX, -padY]);

          if (this._rafHandle != null) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
          }
          this._doRedraw();
        },

        // Schedule a redraw on the next frame; coalesces N calls into one. Used by
        // map.js after each body update (time tick, zoom, locale, toggle).
        redraw: function () {
          if (this._rafHandle != null) return;
          this._rafHandle = requestAnimationFrame(() => {
            this._rafHandle = null;
            this._doRedraw();
          });
        },

        // Return the world-wrap offsets overlapping the current viewport. Mirrors
        // SkyCanvasLayer: each offset shifts a copy of the world to lon span
        // [off-180, off+180]; keep only those intersecting [west, east].
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
          return out.length ? out : [0];
        },

        // ---- Redraw ----

        _doRedraw: function () {
          const ctx = this._ctx;
          const map = this._map;
          if (!ctx || !map) return;

          const dpr = this._dpr;
          const w = this._w;
          const h = this._h;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          const lastDraw = (this._lastDraw = []);
          if (!this._bodies.size) return;

          const padX = this._padX;
          const padY = this._padY;
          // pixelOrigin only changes on zoom/move, both of which trigger _reset →
          // a fresh redraw, so it stays valid for this frame. project() is
          // unrounded (matches SkyCanvasLayer) so a sweeping body does not shimmer
          // along integer pixel boundaries during playback.
          const origin = map.getPixelOrigin();
          const wraps = this._visibleWraps();

          // Painter's algorithm: farthest body first, so a nearer body's core and
          // glow paint over it. Replaces the old per-pane z-index sort
          // (updateInnerBodyZOrder) with one ordering for every body at once.
          const list = Array.from(this._bodies.values()).sort((a, b) => b.zKey - a.zKey);

          for (let bi = 0; bi < list.length; bi++) {
            const d = list[bi];
            // Skip a body whose Leaflet group has left the map (its layer was
            // toggled off). The group stays referenced in the descriptor, so this
            // catches Sun/Moon/Planet hide without any per-toggle bookkeeping —
            // the descriptor is simply not drawn while its group is detached.
            if (d.group && !d.group._map) continue;
            const glow = d.glow;
            const core = d.core;
            const glowR = glow ? glow.glowR : 0;
            const glareR = glow ? glow.glareR : 0;
            const coreR = core ? core.r : 0;
            const margin = Math.max(glowR, glareR, coreR, d.hitR || 0) + 8;

            const lat = d.lat;
            const lon0 = GeoUtils ? GeoUtils.normLng(d.lng) : (((d.lng % 360) + 540) % 360) - 180;

            for (let k = 0; k < wraps.length; k++) {
              const lng = lon0 + wraps[k];
              const lp = map.project([lat, lng]).subtract(origin);
              const p = map.layerPointToContainerPoint(lp);
              const cx = p.x + padX;
              const cy = p.y + padY;
              if (cx < -margin || cx > w + margin || cy < -margin || cy > h + margin) continue;

              // Additive glare + glow (one canvas blends them instead of ~20
              // mix-blend-mode: screen DOM layers), then the source-over core disc.
              if (glow && glow.alpha > 0) {
                ctx.globalCompositeOperation = 'lighter';
                if (glareR > 0) this._paintGlare(ctx, cx, cy, glareR, glow);
                if (glowR > coreR) this._paintGlow(ctx, cx, cy, glowR, glow);
                ctx.globalCompositeOperation = 'source-over';
              }
              if (core && coreR > 0 && core.alpha > 0) {
                ctx.globalAlpha = core.alpha;
                ctx.fillStyle = core.color;
                ctx.beginPath();
                ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.globalAlpha = 1;

              // Store the in-viewport copy for hit testing (container coords match
              // the click event's containerPoint). lat/lng carried for the tooltip.
              if (p.x >= 0 && p.x <= w - padX * 2 && p.y >= 0 && p.y <= h - padY * 2) {
                lastDraw.push({ entry: d, x: p.x, y: p.y, r: Math.max(d.hitR || 0, coreR, 6), lat, lng });
              }
            }
          }
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        },

        // Radial glow gradient — same stops as Lum.glowGradientCSS: an inner
        // core-coloured plateau handing off to the faint tinted halo. Built inline
        // (only ~18 bodies) rather than cached as a fixed sprite, because the
        // hand-off offsets depend on each body's coreR/glowR ratio.
        _paintGlow: function (ctx, cx, cy, glowR, glow) {
          const cF = Math.round((100 * glow.coreR) / Math.max(glowR, 0.001));
          const s1 = Math.min(cF, 35) / 100;
          const s2 = Math.min(Math.max(cF + 15, 50), 55) / 100;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
          g.addColorStop(0, Lum._rgba(glow.coreCol, 1.0));
          g.addColorStop(s1, Lum._rgba(glow.coreCol, 0.95));
          g.addColorStop(s2, Lum._rgba(glow.coreCol, 0.55));
          g.addColorStop(0.78, Lum._rgba(glow.tint, 0.18));
          g.addColorStop(1, Lum._rgba(glow.tint, 0.0));
          ctx.globalAlpha = glow.alpha;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
          ctx.fill();
        },

        // Very wide, very faint diffuse halo — same stops as Lum.glareGradientCSS.
        _paintGlare: function (ctx, cx, cy, glareR, glow) {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glareR);
          g.addColorStop(0, Lum._rgba(glow.tint, 0.035));
          g.addColorStop(0.45, Lum._rgba(glow.tint, 0.012));
          g.addColorStop(1, Lum._rgba(glow.tint, 0.0));
          ctx.globalAlpha = glow.alpha;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, glareR, 0, Math.PI * 2);
          ctx.fill();
        },

        // ---- Hit Testing & Interaction ----

        // Nearest drawn body within `tol` px of the container point. Ties broken
        // by smallest zKey (the nearer body wins the click, mirroring how it
        // paints on top). Returns the _lastDraw item (entry + wrapped latlng).
        hitTest: function (point, tol) {
          tol = tol || 12;
          const tol2 = tol * tol;
          let best = null;
          let bestZ = Infinity;
          for (const item of this._lastDraw) {
            const dx = item.x - point.x;
            const dy = item.y - point.y;
            const d2 = dx * dx + dy * dy;
            const maxR2 = Math.max(tol2, (item.r + tol) * (item.r + tol));
            if (d2 > maxR2) continue;
            if (item.entry.zKey < bestZ) {
              best = item;
              bestZ = item.entry.zKey;
            }
          }
          return best;
        },

        _onMapClick: function (ev) {
          const item = this.hitTest(ev.containerPoint, 12);
          if (item && item.entry.onClick) {
            window._skyClickConsumed = true;
            item.entry.onClick(ev);
          }
        },

        _onMapContextMenu: function (ev) {
          const item = this.hitTest(ev.containerPoint, 12);
          if (item && item.entry.onContextMenu) {
            window._skyClickConsumed = true;
            if (ev.originalEvent) ev.originalEvent.preventDefault();
            item.entry.onContextMenu(ev);
          }
        },

        // The canvas has pointerEvents:none, so the map's mousemove fires; run
        // hitTest each rAF tick and toggle the pointer cursor + name tooltip.
        _onMapMouseMove: function (ev) {
          if (this._hoverRaf != null) return;
          const cp = ev.containerPoint;
          this._hoverRaf = requestAnimationFrame(() => {
            this._hoverRaf = null;
            if (!this._map) return;
            const item = this.hitTest(cp, 10);
            const entry = item ? item.entry : null;
            if (entry === this._hoverEntry) return;
            this._hoverEntry = entry;
            this._map.getContainer().style.cursor = entry ? 'pointer' : '';
            this._updateTooltip(item);
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
          this._updateTooltip(null);
        },

        // Reuse a single Leaflet tooltip for the hovered body's name. Tooltip text
        // is decorative on hover (the DOM label already shows the name), so it
        // does not need to be selectable.
        _updateTooltip: function (item) {
          const map = this._map;
          if (!map) return;
          if (!item || !item.entry.tooltipText) {
            if (this._tooltip) map.closeTooltip(this._tooltip);
            return;
          }
          if (!this._tooltip) {
            this._tooltip = L.tooltip({
              direction: 'top',
              offset: [0, -8],
              opacity: 0.92,
              className: 'celestial-tooltip',
            });
          }
          this._tooltip.setLatLng([item.lat, item.lng]).setContent(item.entry.tooltipText);
          map.openTooltip(this._tooltip);
        },
      })
    : null;
