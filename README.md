# HR Outreach Automation

A MERN-stack tool for managing HR contacts, drafting personalized job inquiry emails, reviewing each message, attaching one PDF resume, and sending approved emails through Gmail.

## Features

- Import HR/company contacts from CSV (email, company, contact name, role).
- Manage contact list and campaign status.
- Generate editable AI-assisted email drafts (optional provider configured through environment).
- Preview each individual email before sending.
- Store multiple PDF resumes with editable target roles and skill keywords.
- Automatically recommend a role-matched resume and use a marked common/default resume when no targeted resume reaches the match threshold.
- Edit resume metadata, replace a PDF later, switch the common fallback, and manually override the selected attachment for any draft.
- Attach the selected PDF resume to each approved email.
- Gmail OAuth 2.0 integration (no Gmail password or app password stored).
- Track pending, sent, skipped, and failed statuses.
- Duplicate-send guard based on campaign + recipient.
- Development mode defaults to dry-run; real sending requires explicit configuration and an in-app approval.

## Stack

- Client: React, Vite, Tailwind CSS
- Server: Node.js, Express
- Database: MongoDB + Mongoose
- Email: Gmail API via Google OAuth 2.0
- AI: Optional OpenAI-compatible API integration

## Prerequisites

- Node.js 20+
- MongoDB local instance or MongoDB Atlas
- Google Cloud project with Gmail API enabled and OAuth client credentials
- Optional AI API key

## Local setup

1. Clone this repository.
2. Create a local `server/uploads` folder (created automatically when the API starts); resume PDFs are stored there and never committed to Git.
3. Install dependencies:
   ```bash
   npm install
   npm run install:all
   ```
3. Copy `.env.example` to `.env` in the project root and fill in your own values.
4. Start MongoDB.
5. Run both API and client:
   ```bash
   npm run dev
   ```
6. Open the URL printed by Vite (typically http://localhost:5173).

## Gmail OAuth setup

1. In Google Cloud Console, create/select a project and enable the Gmail API.
2. Configure the OAuth consent screen.
3. Create a Web application OAuth client.
4. Add `http://localhost:4000/api/auth/google/callback` as an authorized redirect URI.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in root `.env`.
6. Click **Connect Gmail** in the app and complete Google's consent flow.

Request the narrowest Gmail scope that allows sending (`https://www.googleapis.com/auth/gmail.send`). Never paste OAuth credentials into source code or commit `.env`.

## Resume matching

From **Resume Library**, upload one PDF per target role and add comma-separated target roles and skills (for example, “MERN Stack Developer, React Developer” and “React, Node.js, Express, MongoDB”). Mark one general-purpose resume as **Common fallback**. The server scores role and skill overlap during draft generation; if no candidate resume reaches the match threshold, it selects the common fallback. The draft editor shows the selection and reason, and you can choose another resume before approving the email. Use **Edit details** to update keywords later or **Replace PDF** to upload a newer version.

## AI draft generation

AI drafting is optional. Set `AI_API_KEY` and `AI_BASE_URL` in root `.env` to use a compatible chat-completions endpoint. Without it, the server returns a useful template draft. Review and edit all drafts before sending.

## Security and responsible use

- `.env`, OAuth tokens, uploaded resumes, and local database data are excluded from Git.
- Gmail credentials are stored locally in a server-side token file and excluded from Git. For production, use encrypted secret storage and a persistent, access-controlled database.
- The server only sends drafts with explicit approval in the UI; there is no bulk auto-send route.
- Start with a small, relevant list. Verify addresses and personalize messages. Respect recipient preferences and applicable anti-spam rules.
- Do not commit real HR contact lists or resumes to a public repository.

## Current limitations

This is an initial working scaffold. OAuth, CRUD APIs, CSV import, draft review, resume upload, send logging, and optional AI integration are provided as a baseline and should be tested with your own Google Cloud configuration before use. Production deployment should add user authentication, rate limiting, CSRF protection, and encrypted token storage.

## Scripts

- `npm run dev`: run client and server together
- `npm run build`: build client
- `npm start`: start API server
