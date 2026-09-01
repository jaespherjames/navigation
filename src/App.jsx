import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

function App() {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mapStyle, setMapStyle] = useState('fiord')
  const [showLabels, setShowLabels] = useState(true)
  const [buildingColor, setBuildingColor] = useState('#e0e0e0')

  useEffect(() => {
    let isCancelled = false

    const initMap = async () => {
      // Fetch both style definitions
      const [fiordRes, brightRes] = await Promise.all([
        fetch('https://tiles.openfreemap.org/styles/fiord'),
        fetch('https://tiles.openfreemap.org/styles/bright')
      ])
      const fiordJson = await fiordRes.json()
      const brightJson = await brightRes.json()

      let styleJson = mapStyle === 'bright' ? brightJson : fiordJson

      // When using Fiord, import Bright's sprite AND POI layers
      if (mapStyle === 'fiord') {
        styleJson.sprite = brightJson.sprite

        // Find layers in bright that render icons but aren't in fiord
        const fiordLayerIds = new Set(fiordJson.layers.map((l) => l.id))
        const poiLayers = brightJson.layers.filter(
          (layer) => !fiordLayerIds.has(layer.id) && layer.layout?.['icon-image']
        )

        // Merge POI icon layers into Fiord
        styleJson.layers = [...styleJson.layers, ...poiLayers]
      }

      if (isCancelled) return

      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: styleJson,
        center: [-74.006, 40.7128],
        minZoom: 3,
        zoom: 16,
        pitch: 60,
        bearing: -17.6,
      })

      mapRef.current = map
      map.addControl(new maplibregl.NavigationControl(), 'top-right')

      const START_LEVELING_ZOOM = 4;
      let isLevelingActive = false;

      map.on('zoom', () => {
        const currentZoom = map.getZoom();

        // Case 1: Zooming out past threshold -> Level the map to 0 pitch
        if (currentZoom <= START_LEVELING_ZOOM && !isLevelingActive && map.getPitch() > 0) {
          isLevelingActive = true;

          map.scrollZoom.disable();
          map.dragRotate.disable();

          map.easeTo({
            pitch: 0,
            duration: 200,
            easing: (t) => t * (2 - t)
          });

          map.once('moveend', () => {
            map.scrollZoom.enable();
            // Re-enable pitch controls if the user zoomed back in during the animation
            if (map.getZoom() > START_LEVELING_ZOOM) {
              map.dragRotate.enable();
            }
            isLevelingActive = false;
          });
        }
        // Case 2: Zoomed in past threshold -> Ensure pitch/rotate controls are restored
        else if (currentZoom > START_LEVELING_ZOOM && !isLevelingActive && !map.dragRotate.isEnabled()) {
          map.dragRotate.enable();
        }
      });

      map.on('load', () => {
        map.setProjection({ type: 'globe' })
        map.resize()

        const layers = map.getStyle().layers
        let labelLayerId
        for (let i = 0; i < layers.length; i++) {
          if (layers[i].type === 'symbol' && layers[i].layout?.['text-field']) {
            labelLayerId = layers[i].id
            break
          }
        }

        map.addLayer(
          {
            id: 'real-3d-buildings',
            source: 'openmaptiles',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 13,
            paint: {
              'fill-extrusion-color': buildingColor,
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13,
                0,
                15.05,
                ['coalesce', ['get', 'render_height'], ['get', 'height'], 10]
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13,
                0,
                15.05,
                ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0]
              ],
              'fill-extrusion-opacity': 0.8
            }
          },
          labelLayerId
        )

        const visibility = showLabels ? 'visible' : 'none'
        layers.forEach((layer) => {
          if (layer.type === 'symbol') {
            map.setLayoutProperty(layer.id, 'visibility', visibility)
          }
        })
      })
    }

    initMap()

    return () => {
      isCancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [mapStyle])

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed)
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.resize()
      }
    }, 300)
  }

  const toggleMapStyle = () => {
    const nextStyle = mapStyle === 'fiord' ? 'bright' : 'fiord'
    setMapStyle(nextStyle)
  }

  const toggleLabels = () => {
    const nextState = !showLabels
    setShowLabels(nextState)

    if (mapRef.current) {
      const layers = mapRef.current.getStyle().layers
      const visibility = nextState ? 'visible' : 'none'

      layers.forEach((layer) => {
        if (layer.type === 'symbol') {
          mapRef.current.setLayoutProperty(layer.id, 'visibility', visibility)
        }
      })
    }
  }

  const handleColorChange = (e) => {
    const color = e.target.value
    setBuildingColor(color)
    if (mapRef.current && mapRef.current.getLayer('real-3d-buildings')) {
      mapRef.current.setPaintProperty('real-3d-buildings', 'fill-extrusion-color', color)
    }
  }

  return (
    <div className="app-container">
      <button
        className={`toggle-btn ${isCollapsed ? 'collapsed' : ''}`}
        onClick={toggleSidebar}
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <svg className="icon-default" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
        </svg>
        <svg className="icon-arrow left" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        <svg className="icon-arrow right" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-content">
          <h3>Sidebar Menu</h3>
          <p>Controls & Options go here.</p>

          <div className="sidebar-footer">
            <div className="color-picker-control">
              <label htmlFor="building-color-picker">Building Color</label>
              <div className="color-picker-wrapper">
                <input
                  id="building-color-picker"
                  type="color"
                  value={buildingColor}
                  onChange={handleColorChange}
                />
                <span className="color-code">{buildingColor.toUpperCase()}</span>
              </div>
            </div>

            <button className="theme-toggle-btn" onClick={toggleLabels}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7V4h16v3" />
                <path d="M9 20h6" />
                <path d="M12 4v16" />
              </svg>
              <span>{showLabels ? 'Hide Labels' : 'Show Labels'}</span>
            </button>

            <button className="theme-toggle-btn" onClick={toggleMapStyle}>
              {mapStyle === 'fiord' ? (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                  <span>Bright Mode</span>
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                  </svg>
                  <span>Fiord Mode</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div ref={mapContainer} className="map" />
    </div>
  )
}

export default App