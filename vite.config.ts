import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devApiProxyTarget = (
    env.VITE_DEV_API_PROXY_TARGET || "https://asia-southeast2-sehatai-68f20.cloudfunctions.net/aiProxy"
  )
    .trim()
    .replace(/\/$/, "");

  return {
    server: {
      host: true,
      port: 5173,
      strictPort: false,
      proxy: {
        "/api": {
          target: devApiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: false,
      proxy: {
        "/api": {
          target: devApiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
        },
        includeAssets: ["health-ai-icon-192.png", "health-ai-icon-512.png"],
        manifest: {
          name: "Health Edukasi App",
          short_name: "Health Edukasi",
          description: "Dashboard edukasi kesehatan dengan insight edukasi.",
          theme_color: "#0f172a",
          background_color: "#f8fafc",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "/health-ai-icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/health-ai-icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("node_modules/react") ||
              id.includes("node_modules/react-dom") ||
              id.includes("node_modules/scheduler")
            ) {
              return "vendor-react";
            }
            if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) {
              return "vendor-firebase";
            }
            return "vendor-misc";
          },
        },
      },
    },
  };
});
