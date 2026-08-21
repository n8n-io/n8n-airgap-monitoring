import { defineProject, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// A project of the root vitest.config.mts, which discovers it via `projects: ["apps/*"]`.
// Merged with the Vite config so the `@` alias and the Vue plugin stay defined in one place.
export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: 'dashboard',
      environment: 'jsdom',
      setupFiles: ['./src/testing/setup.ts'],
    },
  }),
)
