import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig.json "paths": resolve the SDK to its source so the
      // test suite needs no pre-built ../pof-sdk/dist and zero network.
      "@hunch-0g/pof": fileURLToPath(
        new URL("../pof-sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
