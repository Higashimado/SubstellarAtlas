/**
 * leaflet-subpixel.js — make Leaflet's vector + marker positioning sub-pixel.
 *
 * Leaflet 1.9.4 rounds the projected pixel of every marker, polyline/polygon,
 * circleMarker and tooltip to the nearest integer:
 *   - Map.latLngToLayerPoint() does `project(latlng)._round()`
 *   - Marker.update() rounds a second time via `.round()`
 *
 * When such a layer is animated over time (timeline playback), each element
 * crosses an integer pixel boundary at a DIFFERENT sub-pixel phase, so each one
 * steps 1px independently — visible as per-element shimmer/jitter even though the
 * true motion is smooth (and, in Web Mercator, a uniform translation: x is linear
 * in lng and the dec/lat of stars is fixed, so a pure time change shifts every
 * element by the exact same fractional amount). The rounding is what destroys
 * that uniformity.
 *
 * This module overrides the four positioning methods that draw VISIBLE moving
 * layers (constellation labels/lines & boundaries, deep-sky icons, ecliptic /
 * galactic / lunar grids, planet & moon & sun disks, eclipse curves, comet /
 * meteor / satellite markers, veil-mask polygons, …) so they project WITHOUT
 * rounding: layerPoint = project(latlng) − pixelOrigin, which is fractional.
 * pixelOrigin itself stays integer, but it is a constant offset shared by every
 * element in a frame, so it introduces zero per-element relative error.
 *
 * Scope is deliberately surgical — we do NOT patch Map.latLngToLayerPoint itself,
 * leaving Leaflet's geometry/bounds math (image-overlay placement, getBoundsZoom,
 * tile pixel bounds, …) on the stock rounded version. Tiles never go through
 * latLngToLayerPoint, so the basemap is untouched and stays pixel-snapped/crisp.
 * The canvas star layer (sky-canvas-layer.js) already projects sub-pixel directly.
 *
 * Note: L.Circle (geographic radius) keeps its own _project, whose Earth-CRS
 * branch is already sub-pixel — only L.CircleMarker (pixel radius) needed fixing.
 * Marker zoom-anim (_animateZoom) keeps stock rounding: sub-pixel isn't needed
 * mid-tween, and the zIndex it derives from y must stay an integer.
 *
 * Must load AFTER leaflet.js and BEFORE any layer module creates instances.
 */
(function () {
  if (typeof L === 'undefined') return;

  // Fractional layer point. project() is NOT rounded (only latLngToLayerPoint
  // adds ._round()); getPixelOrigin() is a per-frame integer constant offset.
  function layerPointNR(map, latlng) {
    return map.project(latlng).subtract(map.getPixelOrigin());
  }

  // ---- Marker ----
  // Steady-state positioning (setLatLng / moveend / zoomend path).
  // Mirrors L.Marker.prototype.update (1.9.4) but without the `.round()`, and
  // inlines _setPos so the y-derived zIndex stays an integer (fractional zIndex
  // is invalid CSS and would silently drop the marker's stacking order).
  if (L.Marker) {
    L.Marker.prototype.update = function () {
      if (this._icon && this._map) {
        var pos = layerPointNR(this._map, this._latlng);
        L.DomUtil.setPosition(this._icon, pos);
        if (this._shadow) {
          L.DomUtil.setPosition(this._shadow, pos);
        }
        this._zIndex = Math.round(pos.y) + this.options.zIndexOffset;
        this._resetZIndex();
      }
      return this;
    };
  }

  // ---- Polyline / Polygon ----
  // Polygon extends Polyline. Mirrors
  // L.Polyline.prototype._projectLatlngs (1.9.4) exactly, swapping
  // latLngToLayerPoint → layerPointNR. Covers lines, boundaries, grids,
  // eclipse curves and veil-mask polygons.
  if (L.Polyline) {
    L.Polyline.prototype._projectLatlngs = function (latlngs, result, projectedBounds) {
      var flat = latlngs[0] instanceof L.LatLng,
        len = latlngs.length,
        i,
        ring;
      if (flat) {
        ring = [];
        for (i = 0; i < len; i++) {
          ring[i] = layerPointNR(this._map, latlngs[i]);
          projectedBounds.extend(ring[i]);
        }
        result.push(ring);
      } else {
        for (i = 0; i < len; i++) {
          this._projectLatlngs(latlngs[i], result, projectedBounds);
        }
      }
    };
  }

  // ---- CircleMarker ----
  // Pixel-radius dots: planet/sun/moon disks, asterism verts,
  // satellite position. NOT L.Circle, which overrides _project itself.
  if (L.CircleMarker) {
    L.CircleMarker.prototype._project = function () {
      this._point = layerPointNR(this._map, this._latlng);
      this._updateBounds();
    };
  }

  // ---- Tooltip ----
  // Leaflet's vector tooltips, if any are used as labels.
  if (L.Tooltip) {
    L.Tooltip.prototype._updatePosition = function () {
      var pos = layerPointNR(this._map, this._latlng);
      this._setPosition(pos);
    };
  }
})();
