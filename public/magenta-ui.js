/* ==========================================================================
   MAGENTA UI — presentation layer only
   Live Location Intelligence (Kishore Kumar)

   Adds the ambient motion behind the hero artwork and keeps the target
   counter honest. It contains NO geolocation, network, socket, auth or ID
   logic, and every routine is guarded: a failure here must never break the
   application.
   ========================================================================== */
(function () {
    "use strict";

    var MG = window.MagentaUI = window.MagentaUI || {};

    var reduced = false;
    try {
        reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { /* older browsers */ }

    var rand = function (a, b) { return a + Math.random() * (b - a); };

    /* picks a randomised subset of child nodes, so thin phones and low-power
       devices get a lighter background than desktop */
    function host(name, wanted, fn) {
        var el = document.querySelector(name);
        if (!el) return;
        var room = window.innerWidth < 720 ? Math.round(wanted * 0.5) : wanted;
        for (var i = 0; i < room; i++) el.appendChild(fn(i));
    }

    /* ---------- 1. drifting particles ---------- */
    MG.initParticles = function () {
        if (reduced) return;
        host(".mg-motion__particles", 34, function () {
            var el = document.createElement("span");
            el.className = "mg-particle";
            el.setAttribute("aria-hidden", "true");
            el.style.setProperty("--mg-x", rand(2, 98).toFixed(1) + "%");
            el.style.setProperty("--mg-y", rand(10, 98).toFixed(1) + "%");
            el.style.setProperty("--mg-size", rand(1, 2.6).toFixed(2) + "px");
            el.style.setProperty("--mg-dur", rand(18, 40).toFixed(1) + "s");
            el.style.setProperty("--mg-delay", (-rand(0, 30)).toFixed(1) + "s");
            el.style.setProperty("--mg-dx", rand(-8, 8).toFixed(1) + "vw");
            el.style.setProperty("--mg-op", rand(.25, .7).toFixed(2));
            return el;
        });
    };

    /* ---------- 2. slow magenta light streaks ---------- */
    MG.initStreaks = function () {
        if (reduced) return;
        host(".mg-motion__streaks", 7, function () {
            var el = document.createElement("span");
            el.className = "mg-streak";
            el.setAttribute("aria-hidden", "true");
            el.style.top = rand(8, 92).toFixed(1) + "%";
            el.style.setProperty("--mg-len", rand(12, 34).toFixed(1) + "vw");
            el.style.setProperty("--mg-dur", rand(24, 46).toFixed(1) + "s");
            el.style.setProperty("--mg-delay", (-rand(0, 40)).toFixed(1) + "s");
            return el;
        });
    };

    /* ---------- 3. occasional horizontal glitch accents ---------- */
    MG.initGlitch = function () {
        if (reduced) return;
        host(".mg-motion__glitch", 3, function () {
            var el = document.createElement("span");
            el.className = "mg-glitch";
            el.setAttribute("aria-hidden", "true");
            el.style.setProperty("--mg-y", rand(18, 82).toFixed(1) + "%");
            el.style.setProperty("--mg-size", rand(1, 2).toFixed(1) + "px");
            el.style.setProperty("--mg-dur", rand(13, 21).toFixed(1) + "s");
            el.style.setProperty("--mg-delay", (-rand(0, 18)).toFixed(1) + "s");
            return el;
        });
    };

    /* ---------- 4. fine polygonal outlines that appear and fade ---------- */
    MG.initWire = function () {
        var el = document.querySelector(".mg-motion__wire");
        if (!el) return;
        /* a handful of open triangles — a quiet nod to the faceted artwork */
        var shapes = [
            "40,300 190,40 360,250",
            "10,470 220,330 120,60",
            "300,330 470,120 520,420",
            "150,420 330,220 420,480"
        ];
        el.innerHTML = shapes.map(function (pts) {
            var p = pts.split(" ");
            var d = "M" + p[0] + "L" + p[1] + "L" + p[2] + "Z";
            return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1"/>';
        }).join("");
        if (reduced) el.style.opacity = ".12";
    };

    /* ---------- 5. subtle parallax on the artwork ----------
       Pointer movement only, and only where a real pointer exists. Scroll is
       deliberately NOT used: the hero is tall enough that a scroll-linked
       transform would feel like page-shake on long pages. */
    MG.initParallax = function () {
        var art = document.querySelector(".mg-hero__art");
        if (!art || reduced) return;
        if (!window.matchMedia || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

        var tx = 0, ty = 0, cx = 0, cy = 0, raf = null;

        function loop() {
            cx += (tx - cx) * 0.06;
            cy += (ty - cy) * 0.06;
            art.style.transform = "translate3d(" + (cx * 10).toFixed(2) + "px," + (cy * 7).toFixed(2) + "px,0)";
            raf = (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001)
                ? window.requestAnimationFrame(loop)
                : null;
        }

        function request() { if (!raf) raf = window.requestAnimationFrame(loop); }

        window.addEventListener("pointermove", function (e) {
            tx = (e.clientX / window.innerWidth - 0.5) * 2;
            ty = (e.clientY / window.innerHeight - 0.5) * 2;
            request();
        }, { passive: true });
    };

    /* ---------- 6. keep the target counter honest ----------
       Counts the cards the application itself renders. Nothing is invented,
       and the count follows live socket insertions too. */
    MG.syncTargetCount = function () {
        try {
            var list = document.querySelector("#tar-content");
            var badge = document.querySelector("[data-mg-target-count]");
            if (!list || !badge) return;

            var cards = list.querySelectorAll(".mg-card");
            badge.textContent = cards.length + (cards.length === 1 ? " TARGET" : " TARGETS");

            /* the server-rendered empty state steps aside as soon as the first
               real target arrives over the socket */
            var empty = list.querySelector(".mg-empty");
            if (cards.length > 0 && empty && empty.parentNode) {
                empty.parentNode.removeChild(empty);
            }

            /* animate only cards the socket handler appended at runtime;
               server-rendered cards keep their CSS stagger */
            for (var i = 0; i < cards.length; i++) {
                var c = cards[i];
                if (c.getAttribute("data-mg-counted") === "1") continue;
                c.setAttribute("data-mg-counted", "1");
                if (!reduced) {
                    c.classList.add("mg-in");
                    c.style.setProperty("--mg-d", "0ms");
                }
            }
        } catch (e) { }
    };

    MG.watchTargets = function () {
        try {
            var list = document.querySelector("#tar-content");
            if (!list || typeof MutationObserver === "undefined") return;

            MG.syncTargetCount();

            new MutationObserver(function () {
                MG.syncTargetCount();
            }).observe(list, { childList: true });
        } catch (e) { }
    };

    /* ---------- 7. entrance sequencing ---------- */
    MG.stagger = function (selector, step) {
        try {
            var nodes = document.querySelectorAll(selector);
            var s = step || 70;
            for (var i = 0; i < nodes.length; i++) {
                nodes[i].style.setProperty("--mg-d", (i * s) + "ms");
            }
        } catch (e) { }
    };

    function boot() {
        MG.initParticles();
        MG.initStreaks();
        MG.initGlitch();
        MG.initWire();
        MG.initParallax();
        MG.watchTargets();
        MG.stagger(".mg-stagger", 90);
    }

    try {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", boot);
        } else {
            boot();
        }
    } catch (e) { }
})();