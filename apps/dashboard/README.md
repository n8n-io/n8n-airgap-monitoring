# Airgap Monitoring Dashboard

View instance reports and their historic data.

## Project Setup

```sh
pnpm install
```

### Running against a local backend

The dev server proxies `/api` to `http://localhost:3000` (see `vite.config.ts`), so `apps/api` needs to be running there. Both of its tokens are required to boot; set the dashboard one to whatever you want to type into the login form:

```sh
pnpm --filter api build
N8N_INSTANCE_AUTH_TOKEN=dev-instance-token N8N_DASHBOARD_AUTH_TOKEN=dev-secret pnpm --filter api start
```

Then start the dashboard below and log in with `dev-secret`.

### Seeding sample data

In order to have dummy data for instance reports ready, there is a "seed" script for instance reports on the api app.
Run the following command with the API running as described above:

```sh
N8N_INSTANCE_AUTH_TOKEN=dev-instance-token pnpm --filter api seed
```

### Compile and Hot-Reload for Development

```sh
pnpm dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
pnpm test
```

### Lint with [ESLint](https://eslint.org/)

```sh
pnpm lint
```
