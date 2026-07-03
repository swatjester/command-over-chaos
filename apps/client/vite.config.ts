import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    // Resolve workspace packages to their TS source: dev + build work from a
    // fresh clone with no pre-build step, and edits to packages/ hot-reload.
    alias: {
      "@coc/sim": src("../../packages/sim/src/index.ts"),
      "@coc/protocol": src("../../packages/protocol/src/index.ts"),
      "@coc/shared": src("../../packages/shared/src/index.ts"),
    },
  },
});
