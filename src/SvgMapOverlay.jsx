import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'

const SOURCE_ID = 'svg-building-overlay'
const LAYER_ID = 'svg-building-overlay-layer'

function metersToDegrees(meters, atLatitude) {
  const metersPerDegreeLat = 111320
  const metersPerDegreeLng = 111320 * Math.cos((atLatitude * Math.PI) / 180)
  return {
    dLat: meters / metersPerDegreeLat,
    dLng: meters / metersPerDegreeLng,
  }
}

function rasterizeSvg(file, targetWidthPx = 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => {
      const svgText = reader.result
      const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
      const svgEl = doc.documentElement

      if (svgEl.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
        reject(new Error('That file does not look like a valid SVG.'))
        return
      }

      let aspect = 1
      const viewBox = svgEl.getAttribute('viewBox')
      if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map(Number)
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          aspect = parts[2] / parts[3]
        }
      } else {
        const w = parseFloat(svgEl.getAttribute('width'))
        const h = parseFloat(svgEl.getAttribute('height'))
        if (w > 0 && h > 0) aspect = w / h
      }

      const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
      const img = new Image()
      img.onload = () => {
        const width = targetWidthPx
        const height = Math.round(targetWidthPx / aspect)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        URL.revokeObjectURL(blobUrl)
        resolve({ dataUrl: canvas.toDataURL('image/png'), aspect })
      }
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl)
        reject(new Error('Could not rasterize that SVG.'))
      }
      img.src = blobUrl
    }
    reader.readAsText(file)
  })
}

function computeCoordinates(map, aspect, widthMeters) {
  const center = map.getCenter()
  const heightMeters = widthMeters / aspect
  const { dLng: halfDLng } = metersToDegrees(widthMeters / 2, center.lat)
  const { dLat: halfDLat } = metersToDegrees(heightMeters / 2, center.lat)

  return [
    [center.lng - halfDLng, center.lat + halfDLat], // top-left
    [center.lng + halfDLng, center.lat + halfDLat], // top-right
    [center.lng + halfDLng, center.lat - halfDLat], // bottom-right
    [center.lng - halfDLng, center.lat - halfDLat], // bottom-left
  ]
}

function getBoundingBoxCenter(coords) {
  const avgLng = (coords[0][0] + coords[1][0] + coords[2][0] + coords[3][0]) / 4
  const avgLat = (coords[0][1] + coords[1][1] + coords[2][1] + coords[3][1]) / 4
  return [avgLng, avgLat]
}

export default function SvgMapOverlay({ map, mapReady }) {
  const [fileName, setFileName] = useState(null)
  const [widthMeters, setWidthMeters] = useState(40)
  const [hasOverlay, setHasOverlay] = useState(false)
  const [error, setError] = useState(null)

  const overlayData = useRef(null)
  const coordsRef = useRef(null)
  const cornerMarkersRef = useRef([])
  const centerMarkerRef = useRef(null)

  const removeMarkers = () => {
    cornerMarkersRef.current.forEach((m) => m.remove())
    cornerMarkersRef.current = []
    if (centerMarkerRef.current) {
      centerMarkerRef.current.remove()
      centerMarkerRef.current = null
    }
  }

  const syncSourceCoordinates = (coords) => {
    coordsRef.current = coords
    if (map && map.getSource(SOURCE_ID)) {
      map.getSource(SOURCE_ID).setCoordinates(coords)
    }
  }

  const updateAllMarkerPositions = (coords) => {
    // Reposition existing corner markers without recreating them
    cornerMarkersRef.current.forEach((marker, i) => {
      marker.setLngLat(coords[i])
    })
    // Reposition existing center marker
    if (centerMarkerRef.current) {
      centerMarkerRef.current.setLngLat(getBoundingBoxCenter(coords))
    }
  }

  const setupAllMarkers = (coords) => {
    removeMarkers()
    if (!map) return

    // 1. Create Corner Handles
    coords.forEach((coord, idx) => {
      const el = document.createElement('div')
      el.className = 'overlay-corner-handle'

      const marker = new maplibregl.Marker({
        element: el,
        draggable: true,
      })
        .setLngLat(coord)
        .addTo(map)

      marker.on('drag', () => {
        const newLngLat = marker.getLngLat()
        const nextCoords = [...coordsRef.current]
        nextCoords[idx] = [newLngLat.lng, newLngLat.lat]
        
        syncSourceCoordinates(nextCoords)

        // Keep center handle aligned with reshaped corners
        if (centerMarkerRef.current) {
          centerMarkerRef.current.setLngLat(getBoundingBoxCenter(nextCoords))
        }
      })

      cornerMarkersRef.current.push(marker)
    })

    // 2. Create Center Move Handle
    const centerPoint = getBoundingBoxCenter(coords)
    const centerEl = document.createElement('div')
    centerEl.className = 'overlay-center-handle'

    let dragStartPos = null

    const centerMarker = new maplibregl.Marker({
      element: centerEl,
      draggable: true,
    })
      .setLngLat(centerPoint)
      .addTo(map)

    centerMarker.on('dragstart', () => {
      dragStartPos = centerMarker.getLngLat()
    })

    centerMarker.on('drag', () => {
      if (!dragStartPos) return
      const currentPos = centerMarker.getLngLat()

      const dLng = currentPos.lng - dragStartPos.lng
      const dLat = currentPos.lat - dragStartPos.lat

      // Move all 4 corner coordinates by the drag delta
      const nextCoords = coordsRef.current.map(([lng, lat]) => [lng + dLng, lat + dLat])
      
      syncSourceCoordinates(nextCoords)
      
      // Update corner markers in-place
      cornerMarkersRef.current.forEach((m, i) => {
        m.setLngLat(nextCoords[i])
      })

      dragStartPos = currentPos
    })

    centerMarkerRef.current = centerMarker
  }

  const placeOverlay = (coordinates) => {
    if (!map || !overlayData.current) return

    coordsRef.current = coordinates

    if (map.getSource(SOURCE_ID)) {
      map.getSource(SOURCE_ID).setCoordinates(coordinates)
    } else {
      map.addSource(SOURCE_ID, {
        type: 'image',
        url: overlayData.current.dataUrl,
        coordinates,
      })
      map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: { 'raster-opacity': 1, 'raster-resampling': 'linear' },
      })
      setHasOverlay(true)
    }

    setupAllMarkers(coordinates)
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.svg')) {
      setError('Please choose a .svg file.')
      return
    }

    setError(null)
    try {
      const { dataUrl, aspect } = await rasterizeSvg(file)
      overlayData.current = { dataUrl, aspect }
      setFileName(file.name)

      if (map?.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      if (map?.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      removeMarkers()
      setHasOverlay(false)

      if (map && mapReady) {
        placeOverlay(computeCoordinates(map, aspect, widthMeters))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const handlePlaceAtCenter = () => {
    if (!map || !overlayData.current) return
    const coords = computeCoordinates(map, overlayData.current.aspect, widthMeters)
    placeOverlay(coords)
  }

  const handleWidthChange = (e) => {
    const value = Number(e.target.value)
    setWidthMeters(value)
    if (map && overlayData.current && map.getSource(SOURCE_ID)) {
      const coords = computeCoordinates(map, overlayData.current.aspect, value)
      syncSourceCoordinates(coords)
      updateAllMarkerPositions(coords)
    }
  }

  const handleRemove = () => {
    if (map?.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
    if (map?.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    removeMarkers()
    setHasOverlay(false)
    setFileName(null)
    overlayData.current = null
  }

  useEffect(() => {
    return () => {
      removeMarkers()
    }
  }, [])

  return (
    <div className="svg-overlay-control">
      <label className="svg-overlay-title">Building Overlay</label>

      <input
        id="svg-upload-input"
        type="file"
        accept=".svg,image/svg+xml"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        className="svg-upload-btn"
        onClick={() => document.getElementById('svg-upload-input').click()}
      >
        {fileName ? fileName : 'Upload SVG…'}
      </button>

      {overlayData.current && (
        <>
          <label htmlFor="svg-width-slider" className="svg-width-label">
            Width: {widthMeters}m
          </label>
          <input
            id="svg-width-slider"
            type="range"
            min="5"
            max="500"
            step="1"
            value={widthMeters}
            onChange={handleWidthChange}
          />

          <div className="svg-overlay-actions">
            <button type="button" onClick={handlePlaceAtCenter} disabled={!mapReady}>
              Place at Center
            </button>
            {hasOverlay && (
              <button type="button" onClick={handleRemove} className="svg-remove-btn">
                Remove
              </button>
            )}
          </div>
        </>
      )}

      {error && <p className="svg-overlay-error">{error}</p>}
    </div>
  )
}