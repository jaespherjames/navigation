import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

function App() {
  const mapContainer = useRef(null)

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/bright',
      center: [-74.006, 40.7128], // Manhattan, NYC (dense real 3D building area)
      zoom: 10,
      pitch: 60,
      bearing: -17.6,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.resize()

      // Find the label layer so 3D buildings stay underneath text labels
      const layers = map.getStyle().layers
      let labelLayerId
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].type === 'symbol' && layers[i].layout?.['text-field']) {
          labelLayerId = layers[i].id
          break
        }
      }

      // Add 3D layer pulling directly from OpenStreetMap building data
      map.addLayer(
        {
          id: 'real-3d-buildings',
          source: 'openmaptiles', // Default vector tile source from OpenFreeMap
          'source-layer': 'building', // Pre-existing layer containing real building footprints
          type: 'fill-extrusion',
          minzoom: 13,
          paint: {
            // Render actual building color, defaulting to light gray if undefined
            'fill-extrusion-color': '#e0e0e0',
            
            // Get real building heights from OpenStreetMap attributes (with fallbacks)
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
    })

    return () => map.remove()
  }, [])

  return <div ref={mapContainer} className="map" />
}

export default App