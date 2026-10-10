# API server

The Express API stores contacts and drafts in MongoDB, requests Gmail's send-only OAuth scope, and keeps tokens in an ignored local file under `data/tokens.json`.

Run from the repository root after installing dependencies:
```bash
npm run dev --prefix server
```

Configure the root `.env`; do not place secrets in this folder or commit them. `DRY_RUN=true` is the safe default: send requests return without sending mail. Set it to `false` only after completing a local test and reviewing each draft in the UI.
