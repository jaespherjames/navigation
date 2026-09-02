import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import SvgMapOverlay from './SvgMapOverlay.jsx'
import './App.css'

maplibregl.setWorkerUrl(workerUrl)

function App() {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const stylesCache = useRef({})
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mapStyle, setMapStyle] = useState('fiord')
  const [showLabels, setShowLabels] = useState(true)
  const [show3d, setShow3d] = useState(true)
  const [buildingColor, setBuildingColor] = useState('#e0e0e0')
  const [mapInstance, setMapInstance] = useState(null)
  const [mapReady, setMapReady] = useState(false)
  const show3dRef = useRef(show3d)
  const showLabelsRef = useRef(showLabels)
  const buildingColorRef = useRef(buildingColor)

  useEffect(() => { show3dRef.current = show3d }, [show3d])
  useEffect(() => { showLabelsRef.current = showLabels }, [showLabels])
  useEffect(() => { buildingColorRef.current = buildingColor }, [buildingColor])

  const applyCustomLayers = (map) => {
    map.setProjection({ type: 'globe' })

    const layers = map.getStyle().layers
    let labelLayerId
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].type === 'symbol' && layers[i].layout?.['text-field']) {
        labelLayerId = layers[i].id
        break
      }
    }

    // 1. Add 3D layer if it doesn't exist, using current state for visibility & color
    if (!map.getLayer('real-3d-buildings')) {
      map.addLayer(
        {
          id: 'real-3d-buildings',
          source: 'openmaptiles',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 13,
          layout: {
            visibility: show3dRef.current ? 'visible' : 'none'
          },
          paint: {
            'fill-extrusion-color': buildingColorRef.current,
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
    }

    // 2. Re-apply current label visibility state across all symbol layers
    const labelVisibility = showLabelsRef.current ? 'visible' : 'none'
    layers.forEach((layer) => {
      if (layer.type === 'symbol') {
        map.setLayoutProperty(layer.id, 'visibility', labelVisibility)
      }
    })
  }

  // Helper to load/combine style JSON
  const getStyleJson = async (targetStyle) => {
    if (stylesCache.current[targetStyle]) {
      return stylesCache.current[targetStyle]
    }

    const [fiordRes, brightRes] = await Promise.all([
      fetch('https://tiles.openfreemap.org/styles/fiord'),
      fetch('https://tiles.openfreemap.org/styles/bright'),
    ])
    const fiordJson = await fiordRes.json()
    const brightJson = await brightRes.json()

    let styleJson = targetStyle === 'bright' ? brightJson : fiordJson

    if (targetStyle === 'fiord') {
      styleJson.sprite = brightJson.sprite
      const fiordLayerIds = new Set(fiordJson.layers.map((l) => l.id))
      const poiLayers = brightJson.layers.filter(
        (layer) => !fiordLayerIds.has(layer.id) && layer.layout?.['icon-image']
      )
      styleJson.layers = [...styleJson.layers, ...poiLayers]
    }

    stylesCache.current[targetStyle] = styleJson
    return styleJson
  }

  useEffect(() => {
    let isCancelled = false

    const initMap = async () => {
      const styleJson = await getStyleJson('fiord')
      if (isCancelled) return

      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: styleJson,
        center: [0,20],
        minZoom: 3,
        zoom: 1.5,
        pitch: 0,
        bearing: 0,
      })

      mapRef.current = map
      setMapInstance(map)
      map.addControl(new maplibregl.NavigationControl(), 'top-right')

      const START_LEVELING_ZOOM = 4
      let isLevelingActive = false

      map.on('zoom', () => {
        const currentZoom = map.getZoom()
        if (currentZoom <= START_LEVELING_ZOOM && !isLevelingActive && map.getPitch() > 0) {
          isLevelingActive = true
          map.scrollZoom.disable()
          map.dragRotate.disable()
          map.easeTo({
            pitch: 0,
            duration: 150,
            easing: (t) => t * (2 - t)
          })
          map.once('moveend', () => {
            map.scrollZoom.enable()
            if (map.getZoom() > START_LEVELING_ZOOM) {
              map.dragRotate.enable()
            }
            isLevelingActive = false
          })
        } else if (currentZoom > START_LEVELING_ZOOM && !isLevelingActive && !map.dragRotate.isEnabled()) {
          map.dragRotate.enable()
        }
      })

      map.on('load', () => {
        map.resize()
        setMapReady(true)
      })

      // Ensure initial projection and layers apply cleanly on first render
      map.once('styledata', () => {
        map.setProjection({ type: 'globe' })
        applyCustomLayers(map)
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
  }, []) // Empty dependency array so map initializes only once

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed)
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.resize()
      }
    }, 300)
  }

  const toggleMapStyle = async () => {
    const nextStyle = mapStyle === 'fiord' ? 'bright' : 'fiord'
    setMapStyle(nextStyle)

    if (mapRef.current) {
      const styleJson = await getStyleJson(nextStyle)

      // 1. Re-apply globe projection explicitly on style switch
      mapRef.current.setProjection({ type: 'globe' })

      // 2. Preserve view state across style changes
      mapRef.current.setStyle(styleJson, { transformStyle: (previous, next) => next })

      // 3. Wait for styledata to ensure layers attach properly
      mapRef.current.once('styledata', () => {
        applyCustomLayers(mapRef.current)
      })
    }
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

  // 3. Handler to toggle 3D building layer visibility
  const toggle3d = () => {
    const nextState = !show3d
    setShow3d(nextState)

    if (mapRef.current && mapRef.current.getLayer('real-3d-buildings')) {
      mapRef.current.setLayoutProperty(
        'real-3d-buildings',
        'visibility',
        nextState ? 'visible' : 'none'
      )
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
            <SvgMapOverlay map={mapInstance} mapReady={mapReady} />

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

            <div className="control-button-group">
              
              {/* 3D Objects Button */}
              <button
                className={`icon-toggle-btn ${show3d ? 'is-active' : ''}`}
                onClick={toggle3d}
                aria-label="Toggle 3D Objects"
                title={show3d ? "Hide 3D Objects" : "Show 3D Objects"}
              >
                <svg
                  className="toggle-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </button>

              {/* Labels Button */}
              <button
                className={`icon-toggle-btn ${showLabels ? 'is-active' : ''}`}
                onClick={toggleLabels}
                aria-label="Toggle Labels"
                title={showLabels ? "Hide Labels" : "Show Labels"}
              >
                <svg
                  className="toggle-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 7V4h16v3" />
                  <path d="M9 20h6" />
                  <path d="M12 4v16" />
                </svg>
              </button>

              {/* Theme Switch Button */}
              <button
                className={`icon-toggle-btn ${mapStyle === 'bright' ? 'is-bright' : ''}`}
                onClick={toggleMapStyle}
                aria-label="Toggle Theme"
                title={mapStyle === 'fiord' ? 'Switch to Bright Mode' : 'Switch to Dark Mode'}
              >
                <div className="icon-wrapper">
                  <svg
                    className="theme-icon moon-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                  <svg
                    className="theme-icon sun-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div ref={mapContainer} className="map" />
    </div>
  )
}

export default App