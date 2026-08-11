(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveal = () => document.body.classList.add("brand-ready");

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(reveal), { once: true });
  } else {
    requestAnimationFrame(reveal);
  }

  const sections = document.querySelectorAll(".reveal-on-enter");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    sections.forEach((section) => section.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.24 });

  sections.forEach((section) => observer.observe(section));
})();
