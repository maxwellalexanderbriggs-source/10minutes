# 10 Minutes

A minimal Next.js app with a Convex backend, ready to deploy on Vercel.

## Local development

Install dependencies:

```bash
npm install
```

Start Convex and follow its one-time setup prompt:

```bash
npm run dev:backend
```

In another terminal, start Next.js:

```bash
npm run dev
```

Open <http://localhost:3000>.

## Vercel

Import this repository into Vercel, connect the Convex integration, and use:

```text
npx convex deploy --cmd 'npm run build'
```

as the Vercel build command. The integration supplies `CONVEX_DEPLOY_KEY` and `NEXT_PUBLIC_CONVEX_URL`.
