import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve("electron/main.ts") } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve("electron/preload.ts") },
      rollupOptions: { output: { format: "cjs", entryFileNames: "preload.js" } }
    }
  },
  renderer: {
    resolve: { alias: { "@": resolve("src") } },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          manager: resolve("src/renderer/manager.html"),
          pet: resolve("src/renderer/pet.html"),
          chat: resolve("src/renderer/chat.html")
        }
      }
    }
  }
});
