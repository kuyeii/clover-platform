/** @type {import('tailwindcss').Config} */
import typography from "@tailwindcss/typography";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sidebar: "#ffffff",
        brand: {
          50: "#eef8fc",
          100: "#e2f2f9",
          200: "#c7e6f4",
          500: "#0284c7",
          600: "#0274ad",
          700: "#026699",
          900: "#243447",
        },
        ink: "#243447",
        mist: "#f7f9fc",
        surface: "#ffffff",
        "surface-soft": "#fbfcfe",
        border: "#e4eaf0",
        muted: "#63778b",
        success: "#3d7b68",
        danger: "#a35f68",
        warning: "#8b6d35",
      },
      fontFamily: {
        sans: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(15, 23, 42, 0.04)",
        soft: "0 1px 2px rgba(15, 23, 42, 0.04)",
        glow: "0 0 0 3px rgba(2, 132, 199, 0.12)",
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
