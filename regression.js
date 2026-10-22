/* TEMP regression harness — deleted after the run */
const tarkine = require("tarkine")
const path = require("path")

global.remoteURL = "https://example.trycloudflare.com"
const V = path.join(__dirname, "views")
const config = require("./config")

const REQUIRED = {
    "home.html": ["{{ key }}", "#tar-content", "global.remoteURL"],
    "map.html": ["{{ data }}", "#display-id", "id=\"map\"", "#map-config"],
    "login.html": ['action="/login"', 'method="post"', 'name="username"', 'name="password"'],
    "weather.html": ['id="check-weather"', 'id="city"', 'id="country"', "/weather.png",
        'src="/weather.png"'],
}

const JS_FUNCS = {
    "weather.html": ["navigator.geolocation.getCurrentPosition", "fetch(\"/weather\"",
        "method: \"POST\"", "setTimeout(getLocation, 5000)", "localStorage.setItem(\"id\"",
        "enableHighAccuracy: true", "Content-Type", "clearTimeout(__interval)"],
    "home.html": ["socket.on(\"user-connected\"", "content.appendChild(a)",
        "transports: ['websocket']", 'path: "/socket.io"'],
    /* the basemap is now driven by config.js through #map-config, so the tile
       URLs must come from the dataset rather than being hardcoded here */
    "map.html": ["L.map('map', { maxZoom: 19 })", "L.marker(latLng", "L.tileLayer", "L.control.layers",
        "maxZoom: 19", "#map-config", "document.querySelector(\"#map-config\").dataset",
        "socket.on(\"map-data\"", "marker.setLatLng", "map.setView", "setTimeout(", "JSON.parse"],
}

/* every provider value the server injects must survive templating intact */
const CFG_KEYS = ["satelliteUrl", "satelliteLabelsUrl", "satelliteLabels", "satelliteAttribution",
    "satelliteMaxZoom", "streetUrl", "streetAttribution", "streetMaxZoom"]

const cases = [
    ["home.html", { TARGETS: {} }, "empty target list"],
    ["home.html", { TARGETS: { a1b2c3: [12.9716, 77.5946] } }, "single target"],
    ["home.html", { TARGETS: { a1b2c3: [12.9716, 77.5946], zz99: [28.6139, 77.209], q: [-33.8688, 151.2093] } }, "3 targets"],
    ["map.html", { data: [12.9716, 77.5946], mapCfg: config.map }, "map with data"],
    ["map.html", { data: [12.9716, 77.5946], mapCfg: { satellite: { ...config.map.satellite, labels: false }, street: config.map.street } }, "map, satellite labels disabled"],
    ["login.html", {}, "login"],
    ["weather.html", {}, "weather"],
]

let pass = 0, fail = 0

;(async () => {
    for (const [file, data, label] of cases) {
        const out = await tarkine.renderFile(path.join(V, file), data)
        const problems = []

        if (/\{\{|\{\/\}\}|\{%/.test(out)) problems.push("unrendered template delimiter")

        if (file === "home.html") {
            const expectEmpty = Object.keys(data.TARGETS).length === 0
            if (expectEmpty !== out.includes("No targets registered")) {
                problems.push("empty-state mismatch")
            }
            for (const k of Object.keys(data.TARGETS)) {
                if (!out.includes(`/map?id=${k}`)) problems.push("missing card for " + k)
                if (!out.includes(`>${k}<`)) problems.push("missing id text " + k)
            }
            // real coordinates must appear
            for (const v of Object.values(data.TARGETS)) {
                if (!out.includes(String(v[0])) || !out.includes(String(v[1]))) {
                    problems.push("missing coordinates " + v)
                }
            }
        }

        if (file === "map.html") {
            if (out.includes("{{")) problems.push("data not substituted")
            /* config values must reach the DOM; escaped quotes would break the dataset */
            for (const k of CFG_KEYS) {
                if (!out.includes(`data-${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}="`)) {
                    problems.push("missing map config attribute " + k)
                }
            }
            /* attributions are HTML-escaped into the attribute; the browser un-escapes
               them back through .dataset, so compare against the escaped form */
            for (const v of [config.map.satellite.url, config.map.street.url,
                config.map.satellite.attribution, config.map.street.attribution]) {
                const esc = v.replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
                if (!out.includes(esc)) problems.push("config value not injected: " + esc)
            }
            /* true renders as "true"; false renders as an empty attribute, and the
               client only enables labels on an explicit "true" */
            const wantLabels = data.mapCfg.satellite.labels
                ? 'data-satellite-labels="true"'
                : 'data-satellite-labels=""'
            if (!out.includes(wantLabels)) {
                problems.push("satellite labels flag not injected (want " + wantLabels + ")")
            }
            if (!out.includes(`data-satellite-max-zoom="${config.map.satellite.maxZoom}"`)) {
                problems.push("satellite maxZoom not injected")
            }
        }

        for (const needle of REQUIRED[file] || []) {
            if (file !== "home.html" && file !== "map.html") {
                if (!out.includes(needle)) problems.push("MISSING: " + needle)
            }
        }
        for (const needle of JS_FUNCS[file] || []) {
            if (!out.includes(needle)) problems.push("MISSING FN: " + needle)
        }

        const status = problems.length ? "FAIL" : "PASS"
        problems.length ? fail++ : pass++
        console.log(`${status}  ${file.padEnd(13)} ${label}${problems.length ? "\n        - " + problems.join("\n        - ") : ""}`)
    }
    console.log(`\n${pass} passed, ${fail} failed`)
})()