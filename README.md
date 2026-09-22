# 10 Minutes

A mobile-first event app for submitting questions, choosing the best ones, and voting on who is most likely.

## Flow

1. Guests submit “Who is most likely to…” questions.
2. The admin approves or rejects each submission.
3. Guests vote for their favorite approved questions.
4. The 15 highest-ranked questions are frozen and guests choose their answers.
5. Voting closes and everyone sees the final results.

The admin controls the live phase at `/admin`.

## Local setup

Install dependencies:

```bash
npm install
```

Configure and start the Convex backend:

```bash
npm run dev:backend
```

Set the admin passcode in the Convex deployment. Do not put the real value in `.env.local` or commit it to Git:

```bash
npx convex env set ADMIN_PASSCODE <your-passcode>
```

In a second terminal, start Next.js:

```bash
npm run dev
```

Open <http://localhost:3000>. The admin controls are at <http://localhost:3000/admin>.

## Vercel deployment

1. Import this GitHub repository into Vercel.
2. Install and connect the Convex integration for the project.
3. Add `CONVEX_DEPLOY_KEY` to the Vercel project if the integration did not add it automatically.
4. Set `ADMIN_PASSCODE` in both the Convex development and production deployments.

`vercel.json` deploys the Convex functions before building the Next.js app. The Convex deployment supplies `NEXT_PUBLIC_CONVEX_URL` during that build.

## Commands

```bash
npm run dev          # Next.js development server
npm run dev:backend  # Convex development server
npm run lint         # Lint the project
npm run build        # Production Next.js build
```
