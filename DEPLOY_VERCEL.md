# Deploying motion-forge to motion.ursly.io (Vercel)

ursly.io already lives on Vercel (`3.33.130.190` / `15.197.148.33` are
Vercel's anycast IPs), so this is the path of least surprise. You'll
end up with **`https://motion.ursly.io`** serving the marketing site
and **`https://motion.ursly.io/studio`** serving the edge editor.

The repo at `motion/web/` is already Vercel-ready — `vercel.json` and
`.vercelignore` are committed. You just need to authenticate the CLI
(one-time) and run the deploy.

## One-time setup (~3 minutes)

```bash
# 1. authenticate the CLI in your terminal (the OAuth flow opens a browser)
vercel login

# 2. link the local web/ folder to a new Vercel project
cd /Users/tony/stonyp90-websites/motion/web
vercel link \
  --project motion-forge \
  --yes

# 3. first production deploy. Vercel runs `npm ci && next build` in the cloud.
vercel deploy --prod --yes

# Output of this command includes the deploy URL, e.g.
#   https://motion-forge-stonyp90.vercel.app
# That URL works immediately. Curl it to verify before doing DNS.

# 4. attach the custom subdomain
vercel domains add motion.ursly.io motion-forge
```

`vercel domains add` will print one of two things:

- **CNAME**: `cname.vercel-dns.com` → add a `motion` CNAME at your DNS
  provider pointing to that hostname.
- **A records**: two IPv4 addresses → add two A records for `motion`
  pointing at those.

Either way, point your DNS for `motion.ursly.io` at the target, then
Vercel auto-provisions a Let's Encrypt cert within ~30 s. SSL on day
one.

## Subsequent deploys (zero manual work)

After the one-time link, you have two options:

1. **CLI**: `cd motion/web && vercel deploy --prod --yes` from anywhere
   that has the CLI auth'd.
2. **Git integration** (recommended): in the Vercel dashboard for the
   `motion-forge` project, connect the GitHub repo `stonyp90/motion`,
   set root directory to `web`, and Vercel auto-deploys every push to
   `main` (with preview deploys for PRs).

## What you're shipping

```
motion/web/
├── package.json          Next 15 + React 19 + Tailwind + lottie-react
├── vercel.json           framework=nextjs, regions=[iad1], cache headers for /demos /lottie
├── .vercelignore         excludes node_modules + .next + the 37 MB chrono.mp4 demo
├── src/app/
│   ├── page.tsx          marketing single-page narrative
│   └── studio/page.tsx   client-side edge editor
├── src/components/       Header, Footer, 9 marketing sections, StudioClient
├── src/lib/lottie/       client-side Lottie transform (recolor, retime)
└── public/
    ├── lottie/           three preset Lottie files (~90 KB total)
    └── demos/            chrono.mp4 is gitignored; regen via `motion-forge panelize`
```

Bundle size from the last local build:
- `/`         7.12 kB · First Load JS 114 kB
- `/studio`   5.63 kB · First Load JS 112 kB

## Cost

Free Hobby tier is fine for this. The site is fully static (no API
routes), so Vercel serves everything from its CDN at $0 / request.
Bandwidth: 100 GB/mo on Hobby, $0.40/GB after. The hero `chrono.mp4`
(37 MB) is the only weighty asset — at 1k page loads/mo that's ~37 GB.

If you hit Pro ($20/mo), you also get analytics + larger image
optimization quotas.

## Rollback

`vercel rollback` from the web/ directory shows the deploy history and
flips production back to any prior deploy in one command. Each deploy
gets a unique URL that lives forever — preview links never break.
