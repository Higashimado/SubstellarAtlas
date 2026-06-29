/**
 * veil-canvas-layer.js — canvas renderer for the sub-point veil masks
 * (day twilight, moonlight, day-brighten).
 *
 * Replaces the per-band L.polygon SVG approach (one viewport-filling complex
 * path with night-cap holes, × up to 7 world-wrap copies). Those big vector
 * layers were re-rasterized by the GPU every animated-zoom frame at device
 * resolution and saturated the GPU at high zoom. A canvas is a single bitmap:
 * the zoom tween only setTransform()s it (cheap), and it repaints once on
 * settle — the same trick that keeps the star canvas smooth.
 *
 * The layer is a dumb projector/filler: all geometry (anti-body point, band
 * culling, viewport densification, small-circle contours) stays in map.js,
 * which hands over ready-to-draw bands in lat/lng via the getBands() option.
 * Each redraw fills the canvas rectangle minus the projected night-cap holes
 * with the band's colour/alpha (evenodd), so the veil covers everywhere except
 * inside the caps — identical coverage to the SVG "outer rect minus holes".
 *
 * Public API:
 *   const layer = new VeilCanvasLayer({
 *     paneName: 'twilight-mask',
 *     getBands: () => [                       // pulled each redraw; null entry = skip
 *       { solid: true, color, alpha } |       // viewport wholly day-side
 *       { holes: [[[lat,lng],…], …], color, alpha } |  // rect minus cap holes
 *       null,                                  // band contributes nothing
 *     ],
 *   });
 *   layer.addTo(map);
 *   layer.redraw();                            // throttled to rAF
 *
 * Band paint order matches the array order; same-colour bands stack to the
 * day-strength gradient regardless of order (alpha-over of one colour is
 * order-independent in result).
 */
const VeilCanvasLayer =
  typeof L !== 'undefined'
    ? L.Layer.extend({
        options: {
          getBands: null,
          paneName: 'twilight-mask',
          // Oversize the canvas so a mid-drag pan (CSS-translated until moveend)
          // does not expose a blank edge before the redraw. Matches SkyCanvasLayer.
          padding: 0.5,
          // Cap the backing-store resolution. The veil is a low-frequency alpha
          // gradient (feathered bands + flat interior) with no text/thin lines, so
          // rendering it at full retina DPR just quadruples the GPU texture for no
          // visible gain. The oversized (2× viewport) canvas at DPR 2–3 reaches
          // 65–145 MB; allocating that on top of the high-zoom tile pyramid pushes
          // the renderer past its GPU working-set budget and the GPU thrashes
          // (evict + re-upload) — multi-hundred-ms to multi-second GPUTask stalls,
          // none of it on the main thread. Clamping DPR to 1 cuts the texture ~75%
          // at DPR 2 and keeps total GPU memory inside budget. null = no cap
          // (SkyCanvasLayer needs full DPR for crisp stars, so it leaves this unset).
          maxDpr: null,
          // Apply a CSS Gaussian blur to the canvas for a soft veil edge. Only
          // active at zoom < blurMaxZoom; at high zoom the dense-arc geometry is
          // already sub-pixel-precise so blur adds nothing, and CSS filter on a
          // large canvas forces GPU re-rasterization on every composite. 0 = off.
          blur: 0,
          blurMaxZoom: null,
        },

        initialize: function (options) {
          L.setOptions(this, options);
          this._rafHandle = null;
          this._canvas = null;
          this._ctx = null;
          this._w = 0;
          this._h = 0;
          this._padX = 0;
          this._padY = 0;
          this._dpr = 1;
          this._blurOn = false;
          this._drawZoom = null;
          this._drawTLLatLng = null;
        },

        onAdd: function (map) {
          this._map = map;
          const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated veil-canvas');
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
            },
            this
          );
          this._reset();
        },

        onRemove: function (map) {
          if (this._canvas && this._canvas.parentNode) {
            this._canvas.parentNode.removeChild(this._canvas);
          }
          map.off(
            {
              viewreset: this._reset,
              zoom: this._onZoom,
              zoomend: this._onZoomEnd,
              moveend: this._reset,
              resize: this._reset,
              zoomanim: this._animateZoom,
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

        // Translate+scale the frozen bitmap during the zoom tween so it tracks the
        // basemap; the crisp repaint happens on zoomend. Anchored on the canvas's
        // actual top-left (container (-padX,-padY)), matching SkyCanvasLayer.
        _animateZoom: function (ev) {
          const m = this._map;
          if (!m || !this._canvas) return;
          const scale = m.getZoomScale(ev.zoom, m.getZoom());
          const canvasTLLatLng = m.containerPointToLatLng([-this._padX, -this._padY]);
          const offset = m._latLngToNewLayerPoint(canvasTLLatLng, ev.zoom, ev.center);
          L.DomUtil.setTransform(this._canvas, offset, scale);
        },

        // flyTo drives the zoom by firing `zoom` (never `zoomanim`); track it the
        // same way, re-rasterizing once the flight drifts ≥0.5 level from the raster
        // so the veil edge stays crisp instead of CSS-ballooning. Mirrors SkyCanvasLayer.
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

        // Toggle `filter: blur(Npx)` on the canvas element based on the current
        // zoom level. Called from _reset() so it re-evaluates after every zoom
        // settle — at high zoom the dense-arc geometry is already precise and
        // re-rasterizing a large canvas for blur is wasteful.
        _applyBlur: function () {
          if (!this._canvas || !this._map) return;
          const b = this.options.blur || 0;
          const maxZ = this.options.blurMaxZoom;
          const on = b > 0 && (maxZ == null || this._map.getZoom() < maxZ);
          this._blurOn = on;
          this._canvas.style.filter = on ? 'blur(' + b + 'px)' : '';
        },

        // Resize / reposition the canvas to the current viewport (+padding), then
        // repaint synchronously. Called on add, moveend, zoomend, viewreset, resize.
        _reset: function () {
          if (!this._map || !this._canvas) return;
          this._applyBlur();
          const size = this._map.getSize();
          const padding = this.options.padding || 0;
          const padX = Math.round(size.x * padding);
          const padY = Math.round(size.y * padding);
          const tl = this._map.containerPointToLayerPoint([-padX, -padY]);
          L.DomUtil.setPosition(this._canvas, tl);
          this._canvas.style.transformOrigin = '0 0';

          const dpr = Math.min(window.devicePixelRatio || 1, this.options.maxDpr || Infinity);
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
        // map.js on time ticks (the geometry-changing path).
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
          const w = this._w;
          const h = this._h;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.globalCompositeOperation = 'source-over';

          const getBands = this.options.getBands;
          if (!getBands) return;
          const bands = getBands();
          if (!bands || !bands.length) {
            ctx.globalAlpha = 1;
            return;
          }

          const padX = this._padX;
          const padY = this._padY;
          // pixelOrigin only changes on zoom/move, both of which trigger _reset →
          // a fresh redraw, so it stays valid for this frame. project() is
          // unrounded (matches SkyCanvasLayer) so a sweeping terminator does not
          // shimmer along integer pixel boundaries during playback.
          const origin = map.getPixelOrigin();

          for (let b = 0; b < bands.length; b++) {
            const band = bands[b];
            if (!band) continue;
            ctx.globalAlpha = band.alpha;
            ctx.fillStyle = band.color;
            if (band.solid) {
              ctx.fillRect(0, 0, w, h);
              continue;
            }
            const holes = band.holes;
            if (!holes || !holes.length) continue;
            ctx.beginPath();
            ctx.rect(0, 0, w, h);
            for (let r = 0; r < holes.length; r++) {
              const ring = holes[r];
              for (let i = 0; i < ring.length; i++) {
                const lp = map.project(ring[i]).subtract(origin);
                const p = map.layerPointToContainerPoint(lp);
                const x = p.x + padX;
                const y = p.y + padY;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.closePath();
            }
            // evenodd: the canvas rect minus each cap ring → veil everywhere
            // except inside the night caps, matching the SVG fill-rule semantics.
            ctx.fill('evenodd');
          }
          ctx.globalAlpha = 1;
        },
      })
    : null;
