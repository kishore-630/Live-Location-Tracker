/* Glass UI — interface helpers only (no app logic touched) */
(function () {
    "use strict";

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* --- animated orbs inside .glass-bg --- */
    function buildOrbs() {
        var host = document.querySelector(".glass-bg");
        if (!host) return;
        ["1", "2", "3"].forEach(function (n) {
            var orb = document.createElement("span");
            orb.className = "glass-bg__orb glass-bg__orb--" + n;
            host.appendChild(orb);
        });
    }

    /* --- subtle pointer tilt on .g-tilt --- */
    function bindTilt() {
        document.querySelectorAll(".g-tilt").forEach(function (el) {
            if (reduced) return;
            var raf = null;

            el.addEventListener("pointermove", function (e) {
                var r = el.getBoundingClientRect();
                var x = (e.clientX - r.left) / r.width - .5;
                var y = (e.clientY - r.top) / r.height - .5;
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(function () {
                    el.style.transform =
                        "perspective(900px) rotateX(" + (-y * 5).toFixed(2) +
                        "deg) rotateY(" + (x * 6).toFixed(2) + "deg)";
                });
            });

            el.addEventListener("pointerleave", function () {
                if (raf) cancelAnimationFrame(raf);
                el.style.transform = "";
            });
        });
    }

    /* --- staggered reveal for cards added later (live targets) --- */
    function stagger(nodes) {
        var list = Array.prototype.slice.call(nodes);
        var limit = Math.min(list.length, 8);
        for (var i = 0; i < limit; i++) {
            list[i].style.animationDelay = (0.05 + i * 0.05) + "s";
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    function init() {
        buildOrbs();
        bindTilt();
        stagger(document.querySelectorAll(".stagger-item"));
    }

    window.GlassUI = { stagger: stagger };
})();