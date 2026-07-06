/**
 * starlight-layer.js — canvas layer that warps the baked integrated-starlight
 * texture (data/sky/starlight.png) onto the celestial sphere as a diffuse
 * Milky-band underlight. Fills in the dust at low/mid zoom, where drawing the
 * 5.5M Gaia points individually is too expensive; per-star tier-2 takes over as
 * you zoom in (the two crossfade — see Sky.update).
 *
 * Cloned from veil-canvas-layer.js for the full-sky rotating-canvas plumbing
 * (padding oversample, flyTo tracking, project-unrounded, zoom-tween transform).
 * Only _doRedraw differs: instead of filling bands, it warps one equirectangular
 * RA/Dec texture. The texture is horizontally linear in RA (= linear in map lng,
 * so one drawImage per world-wrap copy is exact) and sliced into Dec bands to
 * approximate the Web-Mercator vertical stretch.
 *
 * Public API:
 *   new StarlightCanvasLayer({
 *     paneName: 'starlight',
 *     getTexture: () => tintedCanvas | null,     // pulled each redraw
 *     getContext: () => ({ gmst, alpha }),        // alpha ≤ 0 → skip
 *   }).addTo(map);
 *   layer.redraw();                                // throttled to rAF
 */
const StarlightCanvasLayer =
  typeof L !== 'undefined'
    ? L.Layer.extend({
        options: {
          getTexture: null,
          getContext: null,
          paneName: 'starlight',
          blendMode: 'lighter', // additive: the underlight adds, never darkens
          // Oversize so a mid-drag pan (CSS-translated until moveend) shows no
          // blank edge before the redraw. Matches SkyCanvasLayer / VeilCanvasLayer.
          padding: 0.5,
          // Low-frequency blurred glow — full retina DPR just quadruples the GPU
          // texture for no visible gain (same rationale as the veil layer).
          maxDpr: 1,
          // Dec bands to slice the texture into — more bands track the Mercator
          // vertical nonlinearity more closely at the cost of more drawImage calls.
          decBands: 90,
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
          this._drawZoom = null;
          this._drawTLLatLng = null;
        },

        onAdd: function (map) {
          this._map = map;
          const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated starlight-canvas');
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
        // top-left, matching SkyCanvasLayer / VeilCanvasLayer.
        _animateZoom: function (ev) {
          const m = this._map;
          if (!m || !this._canvas) return;
          const scale = m.getZoomScale(ev.zoom, m.getZoom());
          const canvasTLLatLng = m.containerPointToLatLng([-this._padX, -this._padY]);
          const offset = m._latLngToNewLayerPoint(canvasTLLatLng, ev.zoom, ev.center);
          L.DomUtil.setTransform(this._canvas, offset, scale);
        },

        // flyTo drives zoom via `zoom` (never `zoomanim`); track it the same way,
        // re-rasterizing once the flight drifts ≥0.5 level so the warp stays crisp.
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
        // repaint. Called on add, moveend, zoomend, viewreset, resize.
        _reset: function () {
          if (!this._map || !this._canvas) return;
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

        // Schedule a redraw next frame; coalesces N calls into one. Used by
        // Sky.update on time ticks (gmst changes → the band drifts west).
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

          const tex = this.options.getTexture ? this.options.getTexture() : null;
          const C = this.options.getContext ? this.options.getContext() : null;
          if (!tex || !C) return;
          const gmst = C.gmst;
          const alpha = C.alpha;
          // alpha folds in daylight fade + the crossfade to per-star dust; ≤0 means
          // the layer contributes nothing this frame, so skip the whole warp.
          if (!Number.isFinite(gmst) || !(alpha > 0)) return;

          const padX = this._padX;
          const padY = this._padY;
          // pixelOrigin only changes on zoom/move (both → _reset → fresh redraw),
          // so it stays valid this frame. project() is unrounded (matches the star
          // canvas) so the band does not shimmer during time playback.
          const origin = map.getPixelOrigin();
          const TW = tex.width;
          const TH = tex.height;
          const NY = this.options.decBands || 90;

          // x depends only on lng in Web Mercator; y only on lat. Cache both.
          const xOf = (lng) => map.layerPointToContainerPoint(map.project([0, lng]).subtract(origin)).x + padX;
          const yOf = (lat) => map.layerPointToContainerPoint(map.project([lat, 0]).subtract(origin)).y + padY;
          // Clamp lat to the Web-Mercator limit so polar texture rows collapse to
          // zero height instead of projecting to ±Infinity.
          const LAT_MAX = 85;

          const b = map.getBounds();
          const west = b.getWest() - 5;
          const east = b.getEast() + 5;

          ctx.globalCompositeOperation = this.options.blendMode || 'lighter';
          ctx.globalAlpha = alpha;
          ctx.imageSmoothingEnabled = true;

          // A sky point at RA appears at map lng = RA − gmst + k·360. The texture
          // (RA 0→360) is therefore a 360°-wide strip whose left edge sits at
          // lng = −gmst + k·360; draw the world-wrap copies k that fall in view.
          for (let k = -3; k <= 3; k++) {
            const lngL = -gmst + k * 360;
            const lngR = lngL + 360;
            if (lngR < west || lngL > east) continue;
            const xL = xOf(lngL);
            const xR = xOf(lngR);
            const dw = xR - xL;
            if (xR < -1 || xL > w + 1 || dw <= 0) continue;

            for (let j = 0; j < NY; j++) {
              const decHi = 90 - (180 * j) / NY;
              const decLo = 90 - (180 * (j + 1)) / NY;
              const yTop = yOf(Math.min(LAT_MAX, Math.max(-LAT_MAX, decHi)));
              const yBot = yOf(Math.min(LAT_MAX, Math.max(-LAT_MAX, decLo)));
              const dh = yBot - yTop;
              if (dh <= 0.01) continue; // collapsed polar band
              if (yBot < -1 || yTop > h + 1) continue; // off-canvas band
              ctx.drawImage(tex, 0, (TH * j) / NY, TW, TH / NY, xL, yTop, dw, dh);
            }
          }
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        },
      })
    : null;

if (typeof window !== 'undefined') window.StarlightCanvasLayer = StarlightCanvasLayer;
