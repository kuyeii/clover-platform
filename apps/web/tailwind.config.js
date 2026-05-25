/** @type {import('tailwindcss').Config} */
import typography from "@tailwindcss/typography";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sidebar: "#F7FAFE",
        brand: {
          50: "#EEF8FF",
          100: "#D9EFFF",
          500: "#1698D6",
          600: "#0F86C2",
          700: "#0B6FA4",
          900: "#0F172A",
        },
        ink: "#111827",
        mist: "#F5F9FE",
      },
      fontFamily: {
        sans: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 12px 40px rgba(15, 23, 42, 0.08)",
        soft: "0 18px 50px rgba(15, 23, 42, 0.08)",
        glow: "0 18px 42px rgba(22, 152, 214, 0.18)",
      },
      maxWidth: {
        "8xl": "88rem",
      },
      scale: {
        115: "1.15",
      },
    },
  },
  plugins: [typography],
};
