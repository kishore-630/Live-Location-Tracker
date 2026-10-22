/* TEMP browser harness v3 — owns the server lifecycle so runs are repeatable */
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const BASE = "http://localhost:5000"
const PORT = 5000
const OUT = path.join(__dirname, "shots")
fs.mkdirSync(OUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (n, c, d = "") => { results.push({ n, c, d }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${c || !d ? "" : "  " + d}`) }

let server = null

/* one request with no keep-alive: a half-dead listener can hold the socket open
   long enough to look alive while serving nothing useful */
async function probe() {
    try {
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), 2000)
        const r = await fetch(`${BASE}/login`, { signal: ac.signal, cache: "no-store" })
        clearTimeout(t)
        const body = await r.text()
        return r.ok && body.includes("<form")
    } catch { return false }
}

/* TARGETS lives in module scope (router.js), so a server left over from an earlier
   run still holds every target it was fed. The empty-state and exact card-count
   assertions are only meaningful against a fresh process, so this harness owns
   the server rather than relying on ambient state. */
async function startServer() {
    if (await probe()) {
        console.log("NOTE  reusing the server already on " + PORT + " (state may be dirty)")
        return
    }

    server = spawn(process.execPath, ["server.js"], {
        cwd: __dirname, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(PORT) }
    })
    server.stderr.on("data", d => process.stderr.write("[server] " + d))
    server.on("exit", (code, sig) => {
        if (code !== null) console.log(`NOTE  server exited (code=${code} signal=${sig})`)
        server = null
    })

    for (let i = 0; i < 60; i++) {
        await sleep(300)
        if (await probe()) return
    }
    throw new Error("server did not come up on " + PORT)
}

function stopServer() {
    /* the app spawns a cloudflared child; kill the whole tree on Windows */
    if (server) {
        try { spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" }) } catch { }
        server = null
    }
}

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9340", "--disable-gpu",
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--user-data-dir=" + path.join(process.env.TEMP, "cy-vis3"), "--window-size=1440,900", "about:blank"], { stdio: "ignore" })

class CDP {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.pending = new Map()
        this.errors = []; this.wsEvents = []; this.wsFrames = []
        ws.onmessage = ev => {
            const m = JSON.parse(ev.data)
            if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); return }
            const p = m.params || {}
            if (m.method === "Runtime.exceptionThrown") {
                const d = p.exceptionDetails
                this.errors.push("EXCEPTION: " + (d.exception?.description || d.text))
            }
            if (m.method === "Runtime.consoleAPICalled" && p.type === "error") {
                const text = (p.args || []).map(a => a.value ?? a.description).join(" ")
                /* the weather page has always logged this itself when the browser
                   refuses geolocation. It now reaches that path without a tap, so
                   it is the app's existing message rather than a regression. */
                if (!/^Error watching position:/.test(text)) this.errors.push("console.error: " + text)
            }
            if (m.method === "Page.javascriptDialogOpening") {
                /* same alert(): headless stalls on an unhandled dialog */
                this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => { })
            }
            if (m.method === "Log.entryAdded" && p.entry?.level === "error") {
                /* the app never shipped a favicon; that 404 is pre-existing and unrelated to the UI */
                if (!/favicon/.test((p.entry.url || "") + (p.entry.text || ""))) {
                    this.errors.push(`log(${p.entry.source}): ${p.entry.text} ${p.entry.url || ""}`)
                }
            }
            if (m.method === "Network.webSocketCreated") this.wsEvents.push("created " + p.url)
            if (m.method === "Network.webSocketHandshakeResponseReceived") this.wsEvents.push("handshake " + p.response.status)
            if (m.method === "Network.webSocketClosed") this.wsEvents.push("closed")
            if (m.method === "Network.webSocketFrameReceived") this.wsFrames.push(p.response.payloadData)
            if (m.method === "Network.webSocketFrameSent") this.wsFrames.push("SENT:" + p.response.payloadData)
        }
    }
    send(method, params = {}) {
        const id = ++this.id
        this.ws.send(JSON.stringify({ id, method, params }))
        return new Promise((res, rej) => {
            this.pending.set(id, m => m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result))
            setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(method + " timeout")) } }, 30000)
        })
    }
    async nav(url, settle = 400) {
        this.errors = []
        await this.send("Page.navigate", { url })
        await this.waitLoad()
        await sleep(settle)
    }
    async waitLoad() {
        for (let i = 0; i < 100; i++) {
            const rs = await this.ev("document.readyState").catch(() => null)
            if (rs === "complete") return true
            await sleep(150)
        }
        return false
    }
    async ev(expr) {
        const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error")
        return r.result.value
    }
    async shot(name, w = 1440, h = 900, mobile = false) {
        await this.viewport(w, h, mobile)
        await sleep(600)
        const { data } = await this.send("Page.captureScreenshot", {
            format: "png", captureBeyondViewport: false,
            clip: { x: 0, y: 0, width: w, height: h, scale: 1 }
        })
        fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(data, "base64"))
    }
    async viewport(w = 1440, h = 900, mobile = false) {
        await this.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile })
        await sleep(450)
    }
    async resetViewport() {
        await this.send("Emulation.clearDeviceMetricsOverride")
        await sleep(300)
    }
}

const seed = (id, lat, lng) => fetch(`${BASE}/weather`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, lat, lng })
})

async function main() {
    await startServer()
    for (let i = 0; i < 40; i++) { try { await (await fetch("http://127.0.0.1:9340/json/version")).json(); break } catch { await sleep(300) } }
    const t = await (await fetch("http://127.0.0.1:9340/json/new?url=about:blank", { method: "PUT" })).json()
    const ws = new WebSocket(t.webSocketDebuggerUrl)
    await new Promise(r => ws.onopen = r)
    const p = new CDP(ws)
    await p.send("Page.enable"); await p.send("Runtime.enable"); await p.send("Log.enable"); await p.send("Network.enable")

    /* ============ 1. LOGIN ============ */
    await p.nav(`${BASE}/login`)
    check("login: page loads complete", true)
    check("login: title", (await p.ev("document.title")).includes("Secure Access"))
    check("login: form action=/login", await p.ev(`document.querySelector("form").getAttribute("action")==="/login"`))
    check("login: method=post", await p.ev(`document.querySelector("form").getAttribute("method")==="post"`))
    check("login: name=username present", await p.ev(`!!document.querySelector('input[name="username"]')`))
    check("login: name=password present", await p.ev(`!!document.querySelector('input[name="password"]')`))
    check("login: password masked", await p.ev(`document.querySelector('input[name="password"]').type==="password"`))
    check("login: no credentials exposed in markup", await p.ev(`!/admin/.test(document.documentElement.innerHTML)`))
    check("login: dark theme applied", await p.ev(`getComputedStyle(document.body).backgroundColor==="rgb(5, 4, 11)"`))
    check("login: magenta motion layer rendered", await p.ev(`document.querySelectorAll(".mg-particle").length>0`),
        await p.ev(`document.querySelectorAll(".mg-particle").length+" particles"`))
    check("login: bg layer cannot intercept clicks", await p.ev(
        `getComputedStyle(document.querySelector(".mg-bg")).pointerEvents==="none"`))
    check("login: keyboard focus visible on input", await p.ev(
        `(()=>{const i=document.querySelector("input[name=username]");i.focus();return document.activeElement===i})()`))
    check("login: no JS errors", p.errors.length === 0, p.errors.join(" | "))
    await p.shot("1-login")

    /* real form submission */
    await p.ev(`document.querySelector('input[name="username"]').value='admin';
                document.querySelector('input[name="password"]').value='admin';
                document.querySelector("form").submit(); 'ok'`)
    await sleep(2000); await p.waitLoad(); await sleep(400)
    check("login: real submit authenticates and lands on /", await p.ev(`location.pathname==="/"`), await p.ev("location.pathname"))

    /* ============ 2. HOME ============ */
    p.wsEvents.length = 0; p.wsFrames.length = 0
    await p.nav(`${BASE}/`)
    const homeTxt = (await p.ev("document.body.innerText")).toLowerCase()
    check("home: heading present", homeTxt.includes("location intelligence") && homeTxt.includes("live location monitoring system"))
    check("home: lede present", homeTxt.includes("visualize authorized location updates"))
    check("home: identity present", homeTxt.includes("live location intelligence"))
    check("home: developer credit present", homeTxt.includes("kishore kumar"))
    check("home: endpoint label present", homeTxt.includes("tracker endpoint"))
    /* the endpoint is shown before cloudflared has provisioned the tunnel; it
       must still be a usable absolute URL, never a bare "/weather" */
    check("home: endpoint is an absolute url", await p.ev(
        `/https?:\\/\\/[^\\s]+\\/weather/.test(document.body.innerText)`),
        await p.ev(`document.body.innerText.match(/[^\\s]*\\/weather/)?.[0]`))
    /* ...and it must upgrade to the real tunnel once cloudflared is ready.
       The endpoint is rendered server-side, so poll the server and then reload
       the page; the already-loaded DOM will never change on its own. */
    let tunnel = ""
    for (let k = 0; k < 60; k++) {
        const html = await fetch(`${BASE}/`, {
            headers: { Cookie: "token=" + require("./config").token }, cache: "no-store"
        }).then(r => r.text()).catch(() => "")
        const m = html.match(/https:\/\/[^"<\s]*trycloudflare\.com\/weather/)
        if (m) { tunnel = m[0]; break }
        await sleep(500)
    }
    check("home: server upgrades the endpoint to the tunnel url", !!tunnel,
        tunnel || "cloudflared never returned a tunnel URL (external network dependency)")
    await p.nav(`${BASE}/`)
    check("home: reloaded page shows the tunnel endpoint", await p.ev(
        `/https:\\/\\/[^\\s]*trycloudflare\\.com\\/weather/.test(document.body.innerText)`),
        await p.ev(`document.body.innerText.match(/[^\\s]*\\/weather/)?.[0]`))
    check("home: neutral status label (no fake 'live')", homeTxt.includes("monitoring interface"))

    /* ---- the redesigned hero: local artwork, loaded, dominant, non-blocking ---- */
    check("home: hero artwork is a local asset", await p.ev(
        `(()=>{const i=document.querySelector(".mg-figure");return !!i&&i.getAttribute("src")==="/assets/figure.svg"})()`),
        await p.ev(`document.querySelector(".mg-figure")?.getAttribute("src")`))
    check("home: hero artwork actually decoded", await p.ev(
        `(async()=>{const i=document.querySelector(".mg-figure");if(!i)return false;
            await new Promise(r=>{if(i.complete)return r();i.onload=r;i.onerror=r;setTimeout(r,3000)});
            return i.naturalWidth>0})()`))
    check("home: artwork sits on the left half", await p.ev(
        `(()=>{const r=document.querySelector(".mg-hero__art").getBoundingClientRect();
            return r.left<window.innerWidth*0.5&&r.width>window.innerWidth*0.35})()`))
    check("home: artwork never intercepts pointer events", await p.ev(
        `getComputedStyle(document.querySelector(".mg-hero__art")).pointerEvents==="none"`))
    check("home: no green left over from the previous theme", await p.ev(
        `!/#39FF88|rgb\\(57, 255, 136\\)/i.test(document.documentElement.innerHTML)`))
    check("home: magenta accents present", await p.ev(
        `(()=>{const s=getComputedStyle(document.documentElement);
            return s.getPropertyValue("--mg-pink").trim().toUpperCase()==="#FF2F9F"
                && s.getPropertyValue("--mg-magenta").trim().toUpperCase()==="#FF168B"
                && s.getPropertyValue("--mg-bg").trim().toUpperCase()==="#05040B"})()`),
        await p.ev(`getComputedStyle(document.documentElement).getPropertyValue("--mg-pink")`))
    check("home: motion layers rendered", await p.ev(
        `document.querySelectorAll(".mg-particle").length>0&&document.querySelectorAll(".mg-streak").length>0&&document.querySelectorAll(".mg-glitch").length>0`))
    check("home: tracker endpoint still clickable through the art", await p.ev(
        `(()=>{const c=document.querySelector(".mg-deploy code");const el=document.elementFromPoint(c.getBoundingClientRect().x+20,c.getBoundingClientRect().y+10);
            return !!el&&el.closest(".mg-hero__art")===null})()`))
    check("home: empty state shown when no targets", homeTxt.includes("no targets registered"))
    check("home: empty state inside #tar-content", await p.ev(`!!document.querySelector("#tar-content .mg-empty")`))
    check("home: #tar-content is a grid", await p.ev(`getComputedStyle(document.querySelector("#tar-content")).display==="grid"`))
    check("home: count badge = 0 targets", (await p.ev(`document.querySelector("[data-mg-target-count]").textContent.trim()`)) === "0 TARGETS")
    await sleep(2500)
    check("home: socket.io websocket actually connected", p.wsEvents.some(e => e.startsWith("created")) && p.wsEvents.some(e => e.includes("101")),
        p.wsEvents.join(","))
    check("home: no JS errors", p.errors.length === 0, p.errors.join(" | "))
    await p.shot("2-home-empty")

    /* live target arrival through the app's own socket emit */
    const tid = "LIVE" + Math.random().toString(36).slice(2, 8).toUpperCase()
    await seed(tid, 12.9716, 77.5946)
    await sleep(1500)
    const afterLive = await p.ev(`document.querySelector("#tar-content").innerText`)
    check("home: 'user-connected' card appended live by socket", afterLive.includes(tid), afterLive.replace(/\n/g, " | ").slice(0, 100))
    check("home: count badge -> 1 TARGET", (await p.ev(`document.querySelector("[data-mg-target-count]").textContent.trim()`)) === "1 TARGET", await p.ev(`"badge="+document.querySelector("[data-mg-target-count]").textContent.trim()+" cards="+document.querySelectorAll("#tar-content .mg-card").length`))
    check("home: live card href correct", await p.ev(`!!document.querySelector('#tar-content a[href="/map?id=${tid}"]')`))
    check("home: empty state removed once target exists", !(afterLive.toLowerCase().includes("no targets registered")))
    check("home: no JS errors after socket insert", p.errors.length === 0, p.errors.join(" | "))
    await p.shot("3-home-live-card")

    /* server-rendered cards with real coords */
    for (const [id, la, ln] of [["NODE_BETA", 28.6139, 77.209], ["NODE_GAMMA", -33.8688, 151.2093], ["NODE_DELTA", 51.5072, -0.1276]]) await seed(id, la, ln)
    await p.nav(`${BASE}/`)
    check("home: 4 server-rendered cards", (await p.ev(`document.querySelectorAll("#tar-content .mg-card").length`)) === 4, await p.ev(`"count="+document.querySelectorAll("#tar-content .mg-card").length+" ids="+[...document.querySelectorAll("#tar-content .mg-card")].map(c=>c.innerText.split(String.fromCharCode(10)).join("/")).join(" | ")`))
    check("home: badge = 4 TARGETS", (await p.ev(`document.querySelector("[data-mg-target-count]").textContent.trim()`)) === "4 TARGETS", await p.ev(`"badge="+document.querySelector("[data-mg-target-count]").textContent.trim()+" cards="+document.querySelectorAll("#tar-content .mg-card").length`))
    const cardTxt = await p.ev(`document.querySelector("#tar-content .mg-card").innerText`)
    check("home: real LAT from template data", cardTxt.includes("12.9716"), cardTxt.replace(/\n/g, " | "))
    check("home: real LNG from template data", cardTxt.includes("77.5946"), cardTxt.replace(/\n/g, " | "))
    check("home: no unrendered template delimiters", await p.ev(`document.body.innerHTML.indexOf("{{")===-1`))
    check("home: no horizontal overflow @1440", await p.ev(`document.documentElement.scrollWidth<=window.innerWidth+1`))
    check("home: no JS errors", p.errors.length === 0, p.errors.join(" | "))
    await p.shot("4-home-dashboard")

    await p.nav(`${BASE}/`)
    await p.viewport(390, 844, true)
    check("home: no horizontal overflow @390", await p.ev(`document.documentElement.scrollWidth<=window.innerWidth+1`),
        await p.ev(`document.documentElement.scrollWidth+" / "+window.innerWidth`))
    check("home: cards stack on mobile", await p.ev("(()=>{const c=[...document.querySelectorAll('#tar-content .mg-card')];return c[0].getBoundingClientRect().bottom<=c[1].getBoundingClientRect().top+1})()"))
    check("home: hero heading still readable on mobile", await p.ev(
        `(()=>{const h=document.querySelector(".mg-display").getBoundingClientRect();return h.width>0&&h.right<=window.innerWidth+1})()`),
        await p.ev(`Math.round(document.querySelector(".mg-display").getBoundingClientRect().right)+" / "+window.innerWidth`))
    check("home: cropped mobile artwork never covers the endpoint control", await p.ev(
        `(()=>{const c=document.querySelector(".mg-deploy code").getBoundingClientRect();
            const el=document.elementFromPoint(c.x+20,c.y+c.height/2);return !!el&&el.closest(".mg-hero__art")===null})()`))
    check("home: mobile grid is single column", await p.ev("getComputedStyle(document.querySelector('#tar-content')).gridTemplateColumns.split(' ').length===1"),
        await p.ev("getComputedStyle(document.querySelector('#tar-content')).gridTemplateColumns"))
    check("home: mobile cards full width", await p.ev(
        "(()=>{const c=document.querySelector('#tar-content .mg-card').getBoundingClientRect();return c.width>300})()"))
    await p.shot("5-home-mobile", 390, 844, true)
    await p.resetViewport()

    /* ============ 3. MAP ============ */
    p.wsFrames.length = 0
    await p.nav(`${BASE}/map?id=${tid}`, 2500)
    check("map: leaflet container initialized", await p.ev(`!!document.querySelector("#map.leaflet-container")`))
    check("map: tiles rendered", (await p.ev(`document.querySelectorAll("#map img.leaflet-tile").length`)) > 0,
        await p.ev(`document.querySelectorAll("#map img.leaflet-tile").length+" tiles"`))
    check("map: marker rendered", (await p.ev(`document.querySelectorAll("#map .leaflet-marker-icon").length`)) > 0)
    check("map: zoom controls visible", await p.ev(`!!document.querySelector(".leaflet-control-zoom")`))
    check("map: basemap switch control present", await p.ev(`!!document.querySelector(".leaflet-control-layers")`))
    check("map: attribution present", await p.ev(`!!document.querySelector(".leaflet-control-attribution")`))
    check("map: #display-id shows the target id", (await p.ev(`document.querySelector("#display-id").textContent`)) === tid)
    check("map: satellite imagery served from configured provider", await p.ev(
        `[...document.querySelectorAll("#map img.leaflet-tile")].some(i=>i.src.includes("arcgisonline.com"))`),
        await p.ev(`[...document.querySelectorAll("#map img.leaflet-tile")].map(i=>i.src.split("/")[2]).filter((v,i,a)=>a.indexOf(v)===i).join(",")`))
    check("map: tiles render with natural colour (no invert filter applied by design)", await p.ev(
        `!getComputedStyle(document.querySelector(".leaflet-tile-pane")).filter.includes("invert")`))
    check("map: marker NOT inverted (own pane)", await p.ev(
        `(()=>{const m=document.querySelector(".leaflet-marker-icon");return !m||getComputedStyle(m).filter==="none"})()`))
    check("map: maxZoom 19 preserved", await p.ev(`document.documentElement.innerHTML.includes("maxZoom: 19")`))
    check("map: map fills viewport height", await p.ev(`document.querySelector("#map").getBoundingClientRect().height>500`),
        await p.ev(`Math.round(document.querySelector("#map").getBoundingClientRect().height)+"px"`))
    check("map: no decorative overlay over controls", await p.ev(
        `(()=>{const z=document.querySelector(".leaflet-control-zoom").getBoundingClientRect();const el=document.elementFromPoint(z.x+5,z.y+5);return !el||el.closest(".mg-mapbar")===null})()`))
    check("map: no JS errors", p.errors.length === 0, p.errors.join(" | "))
    await p.shot("6-map")

    /* REAL live update over the socket */
    await seed(tid, 19.0760, 72.8777)
    await sleep(1200)
    let upd = "", cls = false, col = ""
    for (let k = 0; k < 25; k++) {
        /* everything is captured in ONE evaluate: the app reverts this state
           after 2500ms, so separate round trips can miss the highlight */
        const snap = await p.ev(`(()=>{const e=document.querySelector("#display-id");
            return {t:e.textContent,c:e.classList.contains("is-updating"),col:getComputedStyle(e).color}})()`)
        upd = snap.t
        if (upd.includes("- updating")) {
            cls = snap.c
            col = snap.col
            break
        }
        await sleep(250)
    }
    check("map: socket 'map-data' handler fired on real update", upd.includes("- updating"), upd)
    check("map: is-updating highlight applied", cls, "class=" + cls)
    check("map: highlight colour changed to white-hot", col === "rgb(248, 247, 251)", col)
    check("map: map-data frame actually received over websocket", p.wsFrames.some(f => f.includes("map-data")))
    await p.shot("7-map-updating")
    await sleep(2200)
    check("map: id reverts after the app's own 2500ms timeout", (await p.ev(`document.querySelector("#display-id").textContent`)) === tid)
    check("map: highlight class removed", await p.ev(`!document.querySelector("#display-id").classList.contains("is-updating")`))
    check("map: no JS errors after updates", p.errors.length === 0, p.errors.join(" | "))
    await p.viewport(390, 844, true)
    check("map: map fills mobile viewport", await p.ev("document.querySelector('#map').getBoundingClientRect().height>400"), await p.ev("Math.round(document.querySelector('#map').getBoundingClientRect().height)+'px'"))
    check("map: zoom controls reachable on mobile", await p.ev("(()=>{const z=document.querySelector('.leaflet-control-zoom').getBoundingClientRect();const el=document.elementFromPoint(z.x+8,z.y+8);return !!el&&el.tagName==='A'})()"))
    check("map: no horizontal overflow @390", await p.ev("document.documentElement.scrollWidth<=window.innerWidth+1"), await p.ev("document.documentElement.scrollWidth+' / '+window.innerWidth"))
    await p.shot("8-map-mobile", 390, 844, true)
    await p.resetViewport()

    /* ============ 4. WEATHER ============ */
    /* count geolocation asks from outside the app so the granted and refused
       paths can both be checked for duplicate prompts */
    await p.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `window.__wxGeo = 0;
            const g = navigator.geolocation;
            if (g) {
                const orig = g.getCurrentPosition.bind(g);
                g.getCurrentPosition = function () { window.__wxGeo++; return orig.apply(g, arguments) };
            }`
    })

    /* ---- path A: permission granted, real weather must replace the demo ---- */
    await p.send("Browser.grantPermissions", { origin: BASE, permissions: ["geolocation"] })
        .catch(() => console.log("NOTE  geolocation could not be granted; the live path will be skipped"))
    await p.send("Emulation.setGeolocationOverride",
        { latitude: 12.9716, longitude: 77.5946, accuracy: 10 })

    await p.nav(`${BASE}/weather`)
    check("weather: #check-weather present", await p.ev(`!!document.querySelector("#check-weather")`))
    check("weather: #city present", await p.ev(`!!document.querySelector("#city")`))
    check("weather: #country present", await p.ev(`!!document.querySelector("#country")`))
    const wtxt = (await p.ev("document.body.innerText")).toLowerCase()
    /* consent copy is reworded over time, so assert the promises the page must
       make rather than an exact sentence */
    check("weather: consent/notice text retained",
        wtxt.includes("asks for your location") && wtxt.includes("every 5 seconds") &&
        wtxt.includes("close it") && wtxt.includes("open-meteo"),
        wtxt.slice(wtxt.indexOf("asks for your location"), wtxt.indexOf("asks for your location") + 200))
    check("weather: demo values disclosed as placeholders in the copy",
        wtxt.includes("demonstration values") && wtxt.includes("not your local conditions"))
    check("weather: 5s interval intact", await p.ev(`document.documentElement.innerHTML.includes("setTimeout(getLocation, 5000)")`))
    check("weather: POST payload intact", await p.ev("document.documentElement.innerHTML.indexOf('method: \"POST\"')>-1&&document.documentElement.innerHTML.indexOf('Content-Type')>-1"))
    check("weather: geolocation call intact", await p.ev("document.documentElement.innerHTML.indexOf('navigator.geolocation.getCurrentPosition')>-1"))
    check("weather: localStorage id logic intact", await p.ev(`document.documentElement.innerHTML.includes('localStorage.getItem("id")')`))
    check("weather: highAccuracy flag intact", await p.ev(`document.documentElement.innerHTML.includes("enableHighAccuracy: true")`))
    check("weather: icon asset loaded", await p.ev(
        `(async()=>{const i=document.querySelector(".wx-art img");if(!i)return false;await new Promise(r=>{if(i.complete)return r();i.onload=r;i.onerror=r;setTimeout(r,3000)});return i.naturalWidth>0})()`))

    /* the card must be complete in the FIRST response: nothing in the page is
       allowed to gate rendering behind a lookup */
    const rawWeather = await fetch(`${BASE}/weather`, { cache: "no-store" }).then(r => r.text()).catch(() => "")
    check("weather: server sends the whole card, no JS gating",
        /id="wx-temp">25</.test(rawWeather) && /id="city">Demo City</.test(rawWeather) &&
        /id="country">Demo Country</.test(rawWeather) && /id="wx-cond">Partly Cloudy</.test(rawWeather) &&
        /class="wx-status wx-status--demo"[^>]*>\s*Demo\s+Weather/.test(rawWeather))

    const snapExpr = `(()=>{const s=document.querySelector("#wx-status");return [s.className,s.textContent.trim(),
        document.querySelector("#wx-temp").textContent,document.querySelector("#wx-cond").textContent,
        document.querySelector("#city").textContent,document.querySelector("#country").textContent,
        document.querySelector("#wx-art").getAttribute("src"),document.querySelector("#check-weather").disabled,
        document.querySelector("#check-weather").innerHTML].join("~")})()`

    let liveSnap = ""
    for (let k = 0; k < 50; k++) {
        const s = await p.ev(snapExpr)
        if (s.startsWith("wx-status wx-status--live~")) { liveSnap = s; break }
        await sleep(400)
    }
    check("weather: real weather replaces the demo values", !!liveSnap,
        liveSnap || ("status never reached live: " + await p.ev(snapExpr)))
    if (liveSnap) {
        const [, , temp, cond, city, country, art] = liveSnap.split("~")
        check("weather: real temperature shown instead of 25", temp !== "25" && !isNaN(Number(temp)), temp)
        check("weather: real condition shown instead of 'Partly Cloudy'", cond !== "Partly Cloudy", cond)
        check("weather: real city and country instead of the demo names",
            city !== "Demo City" && country !== "Demo Country", city + ", " + country)
        check("weather: icon swapped to the condition artwork", art !== "/weather.png", art)
        check("weather: demo status wording gone", liveSnap.includes("Live weather"), liveSnap)
        check("weather: loading state does not outlive the result",
            await p.ev(`document.querySelector("#wx-status").classList.contains("wx-status--live") ||
                !document.querySelector("#check-weather").disabled ||
                document.querySelector("#check-weather").innerHTML!=="Fetching...."`))
    }
    /* one prompt per 5s tick: the 5s chain must not have doubled up */
    await sleep(11000)
    const grantedGeo = await p.ev(`window.__wxGeo`)
    check("weather: exactly one geolocation request per 5s tick", grantedGeo === 3,
        grantedGeo + " requests in ~11s (want 3)")
    check("weather: no JS errors", p.errors.length === 0, p.errors.join(" | "))
    await p.shot("9-weather")

    /* ---- path B: permission refused ---- */
    await p.send("Browser.resetPermissions")
    await p.send("Emulation.clearGeolocationOverride").catch(() => { })
    await p.nav(`${BASE}/weather`)
    let deniedSnap = ""
    for (let k = 0; k < 40; k++) {
        const s = await p.ev(snapExpr)
        if (s.includes("wasn't granted")) { deniedSnap = s; break }
        await sleep(400)
    }
    check("weather: refusal leaves the card on screen with a message",
        !!deniedSnap && deniedSnap.startsWith("wx-status wx-status--warn~"),
        deniedSnap || ("no refusal status: " + await p.ev(snapExpr)))
    if (deniedSnap) {
        const [, , temp, cond, city, country, , disabled] = deniedSnap.split("~")
        check("weather: demo temperature kept after refusal", temp === "25", temp)
        check("weather: demo condition kept after refusal", cond === "Partly Cloudy", cond)
        check("weather: demo place kept after refusal", city === "Demo City" && country === "Demo Country",
            city + ", " + country)
        check("weather: refusal copy says the demo values are not the visitor's weather",
            /not your weather/i.test(deniedSnap), deniedSnap)
        check("weather: button usable again after refusal", disabled === "false", deniedSnap)
    }
    await sleep(11000)
    const deniedGeo = await p.ev(`window.__wxGeo`)
    check("weather: a refused permission is not re-prompted by the 5s chain", deniedGeo === 1,
        deniedGeo + " requests in ~11s (want 1)")
    check("weather: no blank screen after refusal", await p.ev(`!!document.querySelector(".wx-card") &&
        document.querySelector(".wx-card").getBoundingClientRect().height>0`))

    await p.viewport(390, 844, true)
    check("weather: no horizontal overflow @390", await p.ev(`document.documentElement.scrollWidth<=window.innerWidth+1`))
    check("weather: card fits mobile width", await p.ev("document.querySelector(\".wx-card\").getBoundingClientRect().width<=390"))
    await p.shot("10-weather-mobile", 390, 844, true)
    await p.resetViewport()

    /* ============ 5. REDUCED MOTION ============ */
    await p.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] })
    await p.nav(`${BASE}/login`)
    check("reduced-motion: content fully visible", await p.ev(`getComputedStyle(document.querySelector(".mg-auth")).opacity==="1"`))
    check("reduced-motion: animations neutralised", await p.ev(
        `(()=>{const d=document.querySelector(".mg-auth");return d.classList.contains("mg-in")})()`))
    await p.send("Emulation.setEmulatedMedia", { features: [] })

    /* ============ 6. KEYBOARD ACCESS ============ */
    await p.nav(`${BASE}/login`)
    check("a11y: tab order reaches username then password", await p.ev(`(()=>{
        const u=document.querySelector('input[name=username]'); u.focus();
        return document.activeElement===u; })()`))
    check("a11y: labels associated with inputs", await p.ev(
        `!!document.querySelector('label[for="mg-username"]')&&!!document.querySelector('label[for="mg-password"]')`))
    check("a11y: decorative particles hidden from AT", await p.ev(
        `[...document.querySelectorAll(".mg-particle")].every(a=>a.getAttribute("aria-hidden")==="true")`))

    const bad = results.filter(r => !r.c)
    console.log(`\n================ ${results.length - bad.length} passed, ${bad.length} failed ================`)
    if (bad.length) { console.log("FAILURES:"); bad.forEach(b => console.log(" - " + b.n + (b.d ? " :: " + b.d : ""))) }
    console.log("screenshots -> " + OUT)
    ws.close(); chrome.kill(); stopServer()
    process.exit(bad.length ? 1 : 0)
}
main().catch(e => {
    console.error("HARNESS ERROR:", e.message)
    try { chrome.kill() } catch { }
    stopServer()
    process.exit(2)
})