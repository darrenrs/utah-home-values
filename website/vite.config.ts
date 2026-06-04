import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const env = loadEnv(mode, projectRoot);

  return {
    envDir: projectRoot,
    base: env.VITE_BASE_PATH || "/",
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("./index.html", import.meta.url)),
          about: fileURLToPath(new URL("./about/index.html", import.meta.url)),
          rank: fileURLToPath(new URL("./rank/index.html", import.meta.url)),
        },
      },
    },
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
