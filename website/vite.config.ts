import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL("../", import.meta.url).pathname);

  return {
    base: env.VITE_BASE_PATH || "/",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
