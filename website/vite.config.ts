import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The commit the site is built from, shown in the footer. COMMIT_HASH
// overrides it for builds outside a git checkout.
function buildCommit() {
  if (process.env.COMMIT_HASH) {
    return process.env.COMMIT_HASH;
  }

  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const env = loadEnv(mode, projectRoot);

  return {
    envDir: projectRoot,
    base: env.VITE_BASE_PATH || "/",
    plugins: [react()],
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    },
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
