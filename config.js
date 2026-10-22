/* Map basemap configuration.
 *
 * Satellite imagery comes from Esri World Imagery — a free, publicly
 * documented service that needs NO API key and carries no scraping.
 * Google / Bing tiles are deliberately NOT used: their URLs are undocumented.
 *
 * Every value can be overridden with environment variables, so a keyed
 * provider (MapTiler, Thunderforest, self-hosted tiles...) can be swapped in
 * without touching any source file:
 *
 *   SATELLITE_TILE_URL, SATELLITE_LABELS_URL, SATELLITE_ATTRIBUTION,
 *   SATELLITE_LABELS, STREET_TILE_URL, STREET_ATTRIBUTION
 *
 * If the provider you choose requires a key, supply it through the provider's
 * own URL/env mechanism. Keys are never written into views/*.html.
 */
const satellite = {
    url: process.env.SATELLITE_TILE_URL
        || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    /* place/border labels drawn over the imagery, like Google's satellite view */
    labelsUrl: process.env.SATELLITE_LABELS_URL
        || "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    labels: process.env.SATELLITE_LABELS !== "false",
    attribution: process.env.SATELLITE_ATTRIBUTION
        || "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19
}

const street = {
    url: process.env.STREET_TILE_URL
        || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: process.env.STREET_ATTRIBUTION
        || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}

module.exports = {
    port: 5000,
    username: "admin",
    password: "admin",
    token: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    map: { satellite, street }
}