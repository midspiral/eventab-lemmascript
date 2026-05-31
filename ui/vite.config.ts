import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Inline everything into ONE index.html so it works on GitHub Pages AND file://.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
});
