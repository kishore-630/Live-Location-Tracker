/* ==========================================================================
   CYBER UI — presentation layer only
   - decorative background nodes
   - visual feedback for data the application already renders
   Contains NO geolocation, network, socket, auth or ID logic.
   Every routine is guarded: a failure here must never break the app.
   ========================================================================== */
(function () {
    "use strict";

    var CY = window.CyberUI = window.CyberUI || {};

    var reduced = false;
    try {
        reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { /* older browsers */ }

    /* ---- decorative background accents (purely visual) ---- */
    CY.initBackground = function () {
        try {
            var host = document.querySelector(".cy-bg");
            if (!host) return;
            ["a", "b"].forEach(function (n) {
                var el = document.createElement("span");
                el.className = "cy-bg__accent cy-bg__accent--" + n;
                el.setAttribute("aria-hidden", "true");
                host.appendChild(el);
            });
        } catch (e) { }
    };

    /* ---- keep the target counter honest ----
       Counts cards that the application itself rendered. No data is
       invented, and the count follows live socket insertions too. */
    CY.syncTargetCount = function () {
        try {
            var list = document.querySelector("#tar-content");
            var badge = document.querySelector("[data-cy-target-count]");
            if (!list || !badge) return;

            var cards = list.querySelectorAll(".cy-card");
            badge.textContent = cards.length + (cards.length === 1 ? " TARGET" : " TARGETS");

            /* the server-rendered empty state must step aside as soon as the
               first real target shows up over the socket */
            var empty = list.querySelector(".cy-empty");
            if (cards.length > 0 && empty && empty.parentNode) {
                empty.parentNode.removeChild(empty);
            }

            /* animate only cards the socket handler appended at runtime;
               server-rendered cards are marked in the template and keep
               their CSS stagger */
            for (var i = 0; i < cards.length; i++) {
                var c = cards[i];
                if (c.getAttribute("data-cy-counted") === "1") continue;
                c.setAttribute("data-cy-counted", "1");
                if (!reduced) {
                    c.classList.add("cy-in");
                    c.style.setProperty("--cy-d", "0ms");
                }
            }
        } catch (e) { }
    };

    CY.watchTargets = function () {
        try {
            var list = document.querySelector("#tar-content");
            if (!list || typeof MutationObserver === "undefined") return;

            CY.syncTargetCount();

            new MutationObserver(function () {
                CY.syncTargetCount();
            }).observe(list, { childList: true });
        } catch (e) { }
    };

    /* ---- entrance sequencing for static blocks ---- */
    CY.stagger = function (selector, step) {
        try {
            var nodes = document.querySelectorAll(selector);
            var s = step || 70;
            for (var i = 0; i < nodes.length; i++) {
                nodes[i].style.setProperty("--cy-d", (i * s) + "ms");
            }
        } catch (e) { }
    };

    function boot() {
        CY.initBackground();
        CY.watchTargets();
        CY.stagger(".cy-stagger");
    }

    try {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", boot);
        } else {
            boot();
        }
    } catch (e) { }
})();