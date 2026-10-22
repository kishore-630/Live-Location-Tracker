/* ==========================================================================
   CINEMATIC UI — presentation only
   Live Location Tracking System (Kishore Kumar)

   Two jobs, nothing else:
     1. CIN.Stage  — canvas atmosphere (code rain, particles, streaks,
                    glitch bands) for the page that opts in via
                    <div class="cx-stage" data-cinematic="...">.
     2. CIN.Intro  — short skippable opening sequence.

   It contains NO geolocation, socket, auth, ID, network or data logic, and it
   never touches application state. Every routine is guarded: if the animation
   layer fails for any reason, the interface underneath still works.

   Performance contract:
     - exactly one requestAnimationFrame loop per page, shared by every effect
     - devicePixelRatio aware, capped, with debounced resize
     - paused when the tab is hidden, torn down on pagehide
     - transform/opacity-friendly drawing, blur only on a few glyphs
     - prefers-reduced-motion renders a single static frame and starts no loop
   ========================================================================== */
(function () {
    "use strict";

    var CIN = window.CinematicUI = window.CinematicUI || {};

    var GLYPHS = "0123456789ABCDEF<>/\\[]{}=+*#$%&";
    var GREENS = ["57,255,136", "0,229,255"];
    var HOT = "255,93,115";
    var INTRO_KEY = "cx-intro-seen";

    function reducedMotion() {
        try {
            return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch (e) {
            return false;
        }
    }

    function rand(a, b) {
        return a + Math.random() * (b - a);
    }

    /* ======================================================================
       1. STAGE — canvas atmosphere
       ====================================================================== */

    function Stage(host) {
        var density = host.getAttribute("data-cinematic") === "subtle" ? "subtle" : "full";
        var small = Math.min(window.innerWidth, window.innerHeight) < 700;
        var lowPower = small || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

        var canvas = document.createElement("canvas");
        canvas.className = "cx-stage__canvas";
        canvas.setAttribute("aria-hidden", "true");
        host.insertBefore(canvas, host.firstChild);

        var ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return; /* no 2d context: page still works, just no ambience */

        var cfg = {
            /* tail length kept short on purpose: glyph count is the single
               biggest cost in a canvas code-rain */
            tail: density === "subtle" ? 6 : (lowPower ? 7 : 11),
            fontSize: lowPower ? 13 : 14,
            colAlpha: density === "subtle" ? .22 : (lowPower ? .42 : .55),
            speedMin: density === "subtle" ? 14 : 26,
            speedMax: density === "subtle" ? 34 : 74,
            particles: density === "subtle" ? (lowPower ? 6 : 10) : (lowPower ? 18 : 30),
            streaks: density === "subtle" ? 0 : 2,
            glitchBands: density === "subtle" ? 0 : 1,
            minStep: lowPower ? 34 : 26 /* ms between frames */
        };

        var dpr = 1, w = 0, h = 0, columns = [], particles = [], streaks = [], bands = [];
        var running = false, rafId = 0, last = 0, acc = 0, nextBand = 0, elapsed = 0;

        /* ---------- sizing ---------- */
        function resize() {
            var maxDpr = lowPower ? 1 : 2;
            dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            buildColumns();
        }

        function buildColumns() {
            var fs = cfg.fontSize;
            var count = Math.max(6, Math.floor(w / (fs * 1.15)));
            columns = [];
            for (var i = 0; i < count; i++) {
                columns.push({
                    x: i * fs * 1.15 + rand(0, 4),
                    y: rand(-h, h),
                    speed: rand(cfg.speedMin, cfg.speedMax),
                    tint: GREENS[i % GREENS.length],
                    chars: [],
                    len: 0,
                    hot: false
                });
            }
        }

        function seedParticles() {
            particles = [];
            for (var i = 0; i < cfg.particles; i++) {
                particles.push({
                    x: rand(0, w),
                    y: rand(0, h),
                    vx: rand(-7, 7),
                    vy: rand(-11, -2),
                    r: rand(.6, 1.9),
                    life: rand(.2, 1),
                    decay: rand(.06, .2),
                    hot: Math.random() < .14
                });
            }
        }

        function seedStreak() {
            streaks = [];
            for (var i = 0; i < cfg.streaks; i++) {
                streaks.push({
                    y: rand(h * .1, h * .9),
                    x: -w * rand(.2, .6),
                    len: rand(w * .14, w * .4),
                    v: rand(340, 760),
                    a: rand(.18, .5)
                });
            }
        }

        /* ---------- glyph streams ---------- */
        function glyph(col, reset) {
            return GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
        }

        function resetColumn(col) {
            col.y = rand(-h * .6, -20);
            col.speed = rand(cfg.speedMin, cfg.speedMax);
            col.len = (rand(6, cfg.tail * 2.2)) | 0;
            col.chars = [];
            col.hot = Math.random() < .12;
            col.tint = Math.random() < .18 ? HOT : GREENS[(Math.random() * GREENS.length) | 0];
        }

        function stepColumn(col, dt) {
            col.y += col.speed * dt;
            if (col.y - col.len * cfg.fontSize > h + 40) resetColumn(col);

            var need = Math.ceil(col.len) + 1;
            while (col.chars.length < need) col.chars.push(glyph(col));

            /* occasional character mutation = flicker without re-drawing */
            if (Math.random() < dt * 2.2) {
                var at = (Math.random() * col.chars.length) | 0;
                col.chars[at] = glyph(col);
            }
        }

        function drawColumn(col) {
            var fs = cfg.fontSize;
            ctx.font = "600 " + fs + "px 'JetBrains Mono', ui-monospace, monospace";
            ctx.textBaseline = "top";
            var max = Math.min(col.chars.length, cfg.tail);

            for (var i = 0; i < max; i++) {
                var ch = col.chars[i];
                if (!ch) continue;
                var y = col.y - i * fs;
                if (y < -fs || y > h) continue;

                var fade = 1 - i / max;
                /* head glyph is the brightest thing in the column */
                var alpha = cfg.colAlpha * Math.pow(fade, 1.7) * (i === 0 ? 1.5 : 1);
                if (alpha <= .012) continue;

                if (i === 0) {
                    ctx.fillStyle = "rgba(" + col.tint + "," + Math.min(.85, alpha) + ")";
                    ctx.fillText(ch, col.x, y);
                } else {
                    ctx.fillStyle = "rgba(" + col.tint + "," + alpha + ")";
                    ctx.fillText(ch, col.x, y);
                }
            }
        }

        /* ---------- frame ---------- */
        function step(dt) {
            ctx.clearRect(0, 0, w, h);

            for (var i = 0; i < columns.length; i++) {
                stepColumn(columns[i], dt);
                drawColumn(columns[i]);
            }

            ctx.globalCompositeOperation = "lighter";
            for (var p = 0; p < particles.length; p++) {
                var q = particles[p];
                q.x += q.vx * dt;
                q.y += q.vy * dt;
                q.life -= q.decay * dt;
                if (q.life <= 0 || q.y < -10 || q.x < -10 || q.x > w + 10) {
                    q.x = rand(0, w);
                    q.y = rand(h * .35, h + 10);
                    q.life = rand(.35, 1);
                    q.vx = rand(-7, 7);
                    q.vy = rand(-11, -2);
                    q.r = rand(.6, 1.9);
                    q.hot = Math.random() < .14;
                }
                var tint = q.hot ? HOT : (p % 2 ? "0,229,255" : "57,255,136");
                ctx.fillStyle = "rgba(" + tint + "," + (q.life * .5).toFixed(3) + ")";
                ctx.fillRect(q.x, q.y, q.r * 2, q.r * 2);
            }

            for (var s = 0; s < streaks.length; s++) {
                var k = streaks[s];
                k.x += k.v * dt;
                if (k.x > w + k.len) k.x = -k.len - rand(0, w * .4);
                ctx.fillStyle = "rgba(0,229,255," + (k.a * .25).toFixed(3) + ")";
                ctx.fillRect(k.x, k.y, k.len, 1);
                ctx.fillStyle = "rgba(57,255,136," + (k.a * .7).toFixed(3) + ")";
                ctx.fillRect(k.x + k.len * .62, k.y, k.len * .38, 1);
            }

            /* rare glitch band: a displaced slice of digital noise */
            if (cfg.glitchBands && elapsed > nextBand) {
                nextBand = elapsed + rand(4.5, 11);
                bands = [{ y: rand(0, h), h: rand(10, 46), life: 1 }];
            }
            for (var b = bands.length - 1; b >= 0; b--) {
                var band = bands[b];
                band.life -= dt * 3.4;
                if (band.life <= 0) {
                    bands.splice(b, 1);
                    continue;
                }
                ctx.fillStyle = "rgba(0,229,255," + (band.life * .05).toFixed(3) + ")";
                ctx.fillRect(0, band.y, w, band.h);
                ctx.fillStyle = "rgba(57,255,136," + (band.life * .22).toFixed(3) + ")";
                for (var f = 0; f < 5; f++) {
                    var fx = rand(0, w);
                    ctx.fillRect(fx, band.y + rand(0, band.h), rand(10, 46), 1);
                }
            }

            ctx.globalCompositeOperation = "source-over";
        }

        var elapsed = 0;

        function frame(now) {
            if (!running) return;
            var dt = Math.min(.05, (now - last) / 1000 || 0.016);
            last = now;
            elapsed += dt;

            acc += dt * 1000;
            if (acc >= cfg.minStep) {
                /* fixed-ish step keeps the rain smooth on 60Hz and cheap on 120Hz */
                var use = Math.min(acc / 1000, .05);
                acc = 0;
                step(use);
            }

            rafId = requestAnimationFrame(frame);
        }

        function start() {
            if (running) return;
            running = true;
            last = performance.now();
            rafId = requestAnimationFrame(frame);
        }

        function stop() {
            if (!running) return;
            running = false;
            cancelAnimationFrame(rafId);
            rafId = 0;
        }

        /* ---------- lifecycle ---------- */
        var resizeTimer = 0;
        function onResize() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(resize, 150);
        }

        function onVisibility() {
            if (document.hidden) stop();
            else start();
        }

        resize();
        seedParticles();
        seedStreak();

        if (reducedMotion()) {
            /* one static frame, then nothing runs at all */
            step(0);
        } else {
            window.addEventListener("resize", onResize, { passive: true });
            document.addEventListener("visibilitychange", onVisibility);
            start();
        }

        window.addEventListener("pagehide", function () {
            stop();
            clearTimeout(resizeTimer);
            window.removeEventListener("resize", onResize);
            document.removeEventListener("visibilitychange", onVisibility);
        }, { once: true });

        CIN.stopStage = stop;
    }

    /* ======================================================================
       2. INTRO — short, skippable, never blocking
       ====================================================================== */

    function Intro(options) {
        var opts = options || {};
        var duration = opts.duration || 2600;

        /* returning visitors in the same session skip it; reduced motion and
           any previous choice skip it permanently */
        if (reducedMotion()) return;
        /* a page can opt out entirely (the map leads straight into imagery) */
        if (document.body.hasAttribute("data-no-intro")) return;
        try {
            if (sessionStorage.getItem(INTRO_KEY)) return;
            if (localStorage.getItem(INTRO_KEY)) return;
        } catch (e) { /* storage blocked: still play once per page load */ }

        var overlay = document.createElement("div");
        overlay.className = "cx-intro" + (opts.brief ? " cx-intro--brief" : "");
        overlay.innerHTML =
            '<div class="cx-intro__sweep"></div>' +
            '<div class="cx-intro__stack">' +
            '<p class="cx-intro__kicker">Live Location Tracking System</p>' +
            '<h2 class="cx-intro__title cx-glitch" data-text="LOCATION INTELLIGENCE">LOCATION INTELLIGENCE</h2>' +
            '<p class="cx-intro__sub">Authorized Monitoring System</p>' +
            '<p class="cx-intro__credit">Engineered by Kishore Kumar</p>' +
            '</div>' +
            '<button class="cx-intro__skip" type="button">Skip intro</button>';

        document.body.appendChild(overlay);

        /* pause the page's own entrance animations until the overlay lifts */
        document.body.classList.add("cx-booting");

        var done = false;
        var timer = 0;
        var skipBtn = overlay.querySelector(".cx-intro__skip");

        function finish(remember) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            overlay.classList.add("is-out");
            document.body.classList.remove("cx-booting");
            document.body.classList.add("cx-ready");

            if (remember) {
                try {
                    sessionStorage.setItem(INTRO_KEY, "1");
                    localStorage.setItem(INTRO_KEY, "1");
                } catch (e) { /* ignore */ }
            }

            setTimeout(function () {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 700);
        }

        function skip() {
            /* skipping once opts out of future intros entirely */
            finish(true);
        }

        timer = setTimeout(function () { finish(false); }, duration);

        skipBtn.addEventListener("click", skip);
        document.addEventListener("keydown", function onKey(e) {
            if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
                document.removeEventListener("keydown", onKey);
                skip();
            }
        });
    }

    CIN.Stage = Stage;
    CIN.Intro = Intro;
    CIN.reducedMotion = reducedMotion;

    /* ---------- boot ---------- */
    function boot() {
        try {
            var host = document.querySelector("[data-cinematic]");
            if (host) Stage(host);

            Intro({
                /* the login terminal gets a shorter sequence; the map view
                   leads straight into the satellite view */
                brief: document.body.hasAttribute("data-intro-brief"),
                duration: document.body.hasAttribute("data-intro-brief") ? 1800 : 2600
            });
        } catch (e) {
            /* presentation failure must never break the application */
        }
    }

    try {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", boot);
        } else {
            boot();
        }
    } catch (e) { }
})();