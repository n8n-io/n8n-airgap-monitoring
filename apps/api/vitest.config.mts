import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "api",
    env: { NODE_ENV: "test" },
  },
});
