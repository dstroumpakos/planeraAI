// Same utility vocabulary as the website's agency portal (Tailwind v4 accepts any
// integer opacity step such as `text-white/45`; v3 needs them declared).
const opacity = {};
for (let i = 0; i <= 100; i++) opacity[i] = String(i / 100);
module.exports = {
  content: ["./index.html"],
  theme: { extend: { opacity, fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] } } },
};
