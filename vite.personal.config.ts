import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve(__dirname, "personal"),
  plugins: [react()],
  // No original VITE_/GLM_ secret-bearing environment variables are exposed.
  envPrefix: "PUBLIC_PERSONAL_",
  build: {
    outDir: path.resolve(__dirname, "dist-personal"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
