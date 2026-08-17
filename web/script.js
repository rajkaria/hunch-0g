/* 0G Arena — landing interactions */
(function () {
  "use strict";

  /* Gate the .reveal hidden state on JS actually running,
     so the page renders fully when JS is disabled or fails */
  document.documentElement.classList.add("js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Nav: scrolled state ---------- */
  var nav = document.getElementById("nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Nav: mobile toggle ---------- */
  var toggle = document.getElementById("nav-toggle");
  var links = document.getElementById("nav-links");
  if (toggle && links) {
    var closeMenu = function (refocus) {
      if (!links.classList.contains("open")) return;
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      if (refocus) toggle.focus();
    };
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") closeMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu(true);
    });
    document.addEventListener("click", function (e) {
      if (links.classList.contains("open") && nav && !nav.contains(e.target)) {
        closeMenu(false);
      }
    });
  }

  /* ---------- Ticker: seamless loop + pause off-screen ---------- */
  var track = document.getElementById("ticker-track");
  if (track && track.firstElementChild && !reduceMotion) {
    track.appendChild(track.firstElementChild.cloneNode(true));
    if ("IntersectionObserver" in window) {
      var tickerIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          track.style.animationPlayState = entry.isIntersecting ? "running" : "paused";
        });
      });
      tickerIO.observe(track.parentElement);
    }
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Terminal: staged line playback, looping while in view ---------- */
  var body = document.getElementById("terminal-body");
  if (body) {
    var lines = Array.prototype.slice.call(body.querySelectorAll(".tline"));
    var DELAYS = [0, 500, 750, 1350, 1900, 2600, 3150, 3850, 4400, 5150, 5700, 6500];
    var LOOP_MS = 11500;

    var playOnce = function () {
      lines.forEach(function (line, i) {
        setTimeout(function () {
          line.classList.add("visible");
        }, DELAYS[i] || i * 550);
      });
    };
    var resetLines = function () {
      lines.forEach(function (line) { line.classList.remove("visible"); });
    };

    if (reduceMotion || !("IntersectionObserver" in window)) {
      lines.forEach(function (line) { line.classList.add("visible"); });
    } else {
      var started = false;
      var inView = false;
      var tio = new IntersectionObserver(
        function (entries) {
          inView = entries.some(function (e) { return e.isIntersecting; });
          if (inView && !started) {
            started = true;
            playOnce();
            /* replays are skipped while the terminal is off-screen
               (WCAG 2.2.2 — no perpetual motion out of view) */
            setInterval(function () {
              if (!inView) return;
              resetLines();
              setTimeout(playOnce, 450);
            }, LOOP_MS);
          }
        },
        { threshold: 0.25 }
      );
      tio.observe(body);
    }
  }

  /* ---------- Copy quick-start ---------- */
  var copyBtn = document.getElementById("copy-btn");
  var pre = document.getElementById("quickstart");
  if (copyBtn && pre) {
    var flash = function (label) {
      copyBtn.textContent = label;
      setTimeout(function () { copyBtn.textContent = "copy"; }, 1800);
    };
    copyBtn.addEventListener("click", function () {
      var text = pre.innerText
        .split("\n")
        .filter(function (l) { return l.trim().charAt(0) === "$"; })
        .map(function (l) { return l.replace(/^\s*\$\s*/, ""); })
        .join("\n");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { flash("copied ✓"); },
          function () { flash("failed"); }
        );
      } else {
        /* non-secure-context / legacy fallback */
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          flash(document.execCommand("copy") ? "copied ✓" : "failed");
        } catch (err) {
          flash("failed");
        }
        document.body.removeChild(ta);
      }
    });
  }
})();
