(() => {
  const init = () => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    document.documentElement.dataset.v117Motion = reduced ? "reduced" : "full";
    document.body.classList.add("v117-ready");
    const sections = [...document.querySelectorAll(".container > section:not(.hidden), .brand-closing")];
    sections.forEach((section, index) => {
      section.classList.add("v117-reveal");
      section.style.setProperty("--v117-reveal-index", String(index));
    });
    if (reduced || !("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("v117-visible"));
    } else {
      const observer = new IntersectionObserver((entries, currentObserver) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("v117-visible");
          currentObserver.unobserve(entry.target);
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -8%" });
      sections.forEach((section) => observer.observe(section));
    }
    const map = document.querySelector("#treemap");
    if (!map) return;
    const enhanceTiles = () => map.querySelectorAll(".tile").forEach((tile, index) => {
      if (!tile.hasAttribute("tabindex")) tile.tabIndex = 0;
      tile.style.setProperty("--v117-tile-index", String(index));
    });
    enhanceTiles();
    new MutationObserver(enhanceTiles).observe(map, { childList: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
