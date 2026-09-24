// Loads nearby emergency locations onto a Leaflet map.
// Sources: FEMA (shelters, Disaster Recovery Centers) and USGS The National Map
// (hospitals, ambulance, fire/EMS, police). Free, public, no API key needed.
//
// Usage: loadNearbyPlaces(map, lat, lon, radiusMiles)

const FEMA = "https://gis.fema.gov/arcgis/rest/services";
const USGS = "https://carto.nationalmap.gov/arcgis/rest/services/structures/MapServer";

const PLACE_LAYERS = [
  { label: "Open Shelter",   url: `${FEMA}/NSS/OpenShelters/FeatureServer/0`, color: "#0f766e", nameField: "shelter_name" },
  { label: "FEMA Recovery Center", url: `${FEMA}/FEMA/DRC/FeatureServer/0`,  color: "#1d4ed8", nameField: null },
  { label: "Hospital",       url: `${USGS}/49`, color: "#be123c", nameField: "name" },
  { label: "Ambulance",      url: `${USGS}/50`, color: "#ea580c", nameField: "name" },
  { label: "Fire / EMS",     url: `${USGS}/51`, color: "#b45309", nameField: "name" },
  { label: "Police",         url: `${USGS}/53`, color: "#6d28d9", nameField: "name" },
];

function buildQueryUrl(layerUrl, lat, lon, radiusMiles) {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${lon},${lat}`,          // ArcGIS expects longitude first
    geometryType: "esriGeometryPoint",
    inSR: "4326",                       // input is regular lat/lon
    outSR: "4326",                      // return lat/lon for Leaflet
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusMiles),
    units: "esriSRUnit_StatuteMile",
    outFields: "*",
    resultRecordCount: "50",            // keep the map readable
    f: "geojson",
  });
  return `${layerUrl}/query?${params}`;
}

// Field names differ between services, so try a few common ones.
function getName(props, preferredField) {
  const keys = [preferredField, "name", "NAME", "shelter_name", "SHELTER_NAME", "Name"];
  for (const key of keys) {
    if (key && props[key]) return props[key];
  }
  return "Unnamed location";
}

function getAddress(props) {
  const street = props.address || props.ADDRESS || props.address1 || "";
  const city = props.city || props.CITY || "";
  const state = props.state || props.STATE || "";
  return [street, city, state].filter(Boolean).join(", ");
}

async function loadLayer(map, layer, lat, lon, radiusMiles) {
  try {
    const res = await fetch(buildQueryUrl(layer.url, lat, lon, radiusMiles));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();

    return L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 8, color: "#ffffff", weight: 2,
          fillColor: layer.color, fillOpacity: 0.95,
        }),
      onEachFeature: (feature, marker) => {
        const p = feature.properties || {};
        const address = getAddress(p);
        marker.bindPopup(
          `<strong>${getName(p, layer.nameField)}</strong><br>` +
          `${layer.label}${address ? `<br>${address}` : ""}`
        );
      },
    }).addTo(map);
  } catch (err) {
    // One failed source should not break the whole map.
    console.warn(`Could not load ${layer.label}:`, err);
    return null;
  }
}

async function loadNearbyPlaces(map, lat, lon, radiusMiles = 10) {
  const layers = await Promise.all(
    PLACE_LAYERS.map((layer) => loadLayer(map, layer, lat, lon, radiusMiles))
  );

  // Toggle each category on and off from the map's layer control.
  const overlays = {};
  PLACE_LAYERS.forEach((layer, i) => {
    if (layers[i]) overlays[layer.label] = layers[i];
  });
  L.control.layers(null, overlays, { collapsed: false }).addTo(map);
  return overlays;
}

// Example: center on the user's current location.
// navigator.geolocation.getCurrentPosition(
//   (pos) => loadNearbyPlaces(map, pos.coords.latitude, pos.coords.longitude, 10),
//   () => loadNearbyPlaces(map, 36.8508, -76.2859, 10) // fallback: Norfolk, VA
// );
