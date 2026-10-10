import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { google } from 'googleapis';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const uploadDir = path.join(rootDir, 'uploads');
const dataDir = path.join(rootDir, 'data');
const tokenPath = path.join(dataDir, 'tokens.json');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const app = express();
const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const DRY_RUN = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const MAX_RESUME_MB = Number(process.env.MAX_RESUME_MB || 5);

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

const ContactSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  company: { type: String, trim: true, default: '' },
  contactName: { type: String, trim: true, default: '' },
  role: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['new', 'contacted', 'replied', 'do_not_contact'], default: 'new' }
}, { timestamps: true });

const ResumeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  originalName: { type: String, required: true },
  fileName: { type: String, required: true },
  size: { type: Number, required: true },
  targetRoles: { type: [String], default: [] },
  skills: { type: [String], default: [] },
  description: { type: String, default: '' },
  isDefault: { type: Boolean, default: false }
}, { timestamps: true });

const DraftSchema = new mongoose.Schema({
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  recipient: { type: String, required: true, lowercase: true, trim: true },
  resume: { type: mongoose.Schema.Types.ObjectId, ref: 'Resume', default: null },
  resumeName: { type: String, default: '' },
  resumeMatchScore: { type: Number, default: 0 },
  resumeMatchReason: { type: String, default: '' },
  fallbackUsed: { type: Boolean, default: false },
  resumeAutoSelected: { type: Boolean, default: true },
  company: { type: String, default: '' },
  roleTarget: { type: String, default: 'Entry-Level Software Developer' },
  subject: { type: String, required: true, trim: true },
  body: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'skipped', 'failed'], default: 'pending' },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: '' }
}, { timestamps: true });

DraftSchema.index({ contact: 1, status: 1 });
const Contact = mongoose.model('Contact', ContactSchema);
const Resume = mongoose.model('Resume', ResumeSchema);
const Draft = mongoose.model('Draft', DraftSchema);

const memoryStorage = multer.memoryStorage();
const csvUpload = multer({ storage: memoryStorage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv');
  cb(allowed ? null : new Error('Please upload a .csv file.'), allowed);
}});
const resumeUpload = multer({ storage: multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, _file, cb) => cb(null, 'resume.pdf')
}), limits: { fileSize: MAX_RESUME_MB * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
  cb(allowed ? null : new Error('Resume must be a PDF file.'), allowed);
}});
const libraryResumeUpload = multer({ storage: multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, _file, cb) => cb(null, `resume-${Date.now()}-${randomBytes(10).toString('hex')}.pdf`)
}), limits: { fileSize: MAX_RESUME_MB * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
  cb(allowed ? null : new Error('Resume must be a PDF file.'), allowed);
}});

const oauthStateSet = new Set();
let cachedOAuthClient;

function getOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) return null;
  if (!cachedOAuthClient) cachedOAuthClient = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  return cachedOAuthClient;
}

function readTokens() {
  try { return JSON.parse(fs.readFileSync(tokenPath, 'utf8')); } catch { return null; }
}
function writeTokens(tokens) {
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}
function getAuthenticatedOAuthClient() {
  const client = getOAuthClient();
  const tokens = readTokens();
  if (client && tokens) client.setCredentials(tokens);
  return { client, connected: Boolean(client && tokens?.refresh_token) };
}
function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function splitKeywords(value) {
  return String(value || '').split(/[,;|\n]/).map(s => s.trim()).filter(Boolean);
}
function words(value) {
  return new Set(String(value || '').toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').split(/[\s,;|/-]+/).filter(w => w.length > 1));
}
function scoreResume(resume, contact, applicant = {}) {
  const targetRole = contact.role?.trim() || applicant.targetRole || 'Entry-Level Software Developer';
  const jobText = `${targetRole} ${applicant.targetRole || ''}`;
  const jobWords = words(jobText);
  const roleWords = words((resume.targetRoles || []).join(' '));
  const skillWords = words((resume.skills || []).join(' '));
  const exactRole = (resume.targetRoles || []).some(role => {
    const a = role.toLowerCase().trim(), b = targetRole.toLowerCase().trim();
    return a && b && (a.includes(b) || b.includes(a));
  });
  const roleHits = [...jobWords].filter(w => roleWords.has(w)).length;
  const roleScore = jobWords.size ? Math.min(65, (roleHits / jobWords.size) * 65) : 0;
  const applicantSkillWords = words(applicant.skills || '');
  const skillHits = [...applicantSkillWords].filter(w => skillWords.has(w)).length;
  const skillScore = applicantSkillWords.size ? Math.min(20, (skillHits / applicantSkillWords.size) * 20) : 0;
  const score = Math.round(Math.min(100, roleScore + skillScore + (exactRole ? 25 : 0)));
  return { score, roleHits, exactRole, reason: exactRole ? `Target role matches “${targetRole}”.` : `Matched ${roleHits} role keywords and ${skillHits} skill keywords.` };
}
async function selectResumeForDraft(contact, applicant = {}, requestedResumeId = '') {
  const all = await Resume.find().lean();
  if (requestedResumeId) {
    const selected = all.find(r => String(r._id) === String(requestedResumeId));
    if (!selected) throw new Error('The selected resume was not found. Refresh the resume library and try again.');
    return { resume: selected, score: 100, reason: 'Manually selected by you.', fallbackUsed: false, auto: false };
  }
  const ranked = all.map(resume => ({ resume, ...scoreResume(resume, contact, applicant) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best && best.score >= 25 && (best.exactRole || best.roleHits >= 2)) {
    return { resume: best.resume, score: best.score, reason: best.reason, fallbackUsed: false, auto: true };
  }
  const fallback = all.find(r => r.isDefault);
  if (fallback) {
    return { resume: fallback, score: best?.score || 0, reason: 'No resume met the match threshold; the common/default resume was selected as fallback.', fallbackUsed: true, auto: true };
  }
  return { resume: null, score: best?.score || 0, reason: 'No suitable resume or common fallback is uploaded yet.', fallbackUsed: true, auto: true };
}

function defaultDraft(contact, applicant = {}) {
  const fullName = applicant.name?.trim() || 'Your Name';
  const jobTarget = applicant.targetRole?.trim() || 'Entry-Level Software Developer';
  const skillLine = applicant.skills?.trim() || 'JavaScript, React.js, Node.js, Express.js, MongoDB, REST APIs, and Git';
  const subject = `Application Inquiry — ${jobTarget}${contact.company ? ` | ${contact.company}` : ''}`;
  const greeting = contact.contactName ? `Dear ${contact.contactName},` : 'Dear Hiring Team,';
  const body = `${greeting}

I hope you are doing well.

My name is ${fullName}, and I am reaching out to inquire about suitable ${jobTarget} opportunities${contact.company ? ` at ${contact.company}` : ' within your organization'}.

My background includes hands-on work with ${skillLine}. I am eager to contribute to a development team, continue learning, and grow as a software professional.

I have attached my resume for your consideration. I would appreciate it if you could consider my profile for relevant current or upcoming openings.

Thank you for your time and consideration.

Best regards,
${fullName}`;
  return { subject, body };
}

async function generateWithAI(contact, applicant = {}) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return defaultDraft(contact, applicant);
  const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const prompt = {
    model,
    temperature: 0.6,
    messages: [
      { role: 'system', content: 'Write honest, concise, respectful job inquiry emails. Do not invent qualifications, relationships, vacancies, or facts. Return only valid JSON with subject and body string fields.' },
      { role: 'user', content: JSON.stringify({
        contact: { name: contact.contactName, company: contact.company, email: contact.email, knownRole: contact.role },
        applicant: {
          name: applicant.name || 'Your Name',
          targetRole: applicant.targetRole || 'Entry-Level Software Developer',
          skills: applicant.skills || 'JavaScript, React.js, Node.js, Express.js, MongoDB, REST APIs, Git',
          experience: applicant.experience || 'Entry-level web development candidate',
          context: applicant.context || 'Ask if suitable current or upcoming openings are available.'
        },
        requirements: 'Use a natural professional tone; 100-160 words; avoid aggressive sales language; subject should be specific but truthful. Address person by name only if known. Return JSON only.'
      }) }
    ]
  };
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(prompt),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI provider returned an empty draft.');
  const cleaned = content.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error('AI response was not valid JSON. Try again or use the template draft.'); }
  if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') throw new Error('AI response is missing subject or body.');
  return { subject: parsed.subject.slice(0, 240), body: parsed.body.slice(0, 8000) };
}

app.get('/api/health', async (_req, res, next) => {
  try {
    const { connected } = getAuthenticatedOAuthClient();
    const resumeCount = await Resume.countDocuments();
    res.json({
      ok: true,
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      gmailConnected: connected,
      resumeUploaded: resumeCount > 0 || fs.existsSync(path.join(uploadDir, 'resume.pdf')),
      resumeCount,
      defaultResumeUploaded: Boolean(await Resume.exists({ isDefault: true })),
      dryRun: DRY_RUN,
      aiConfigured: Boolean(process.env.AI_API_KEY)
    });
  } catch (error) { next(error); }
});

app.get('/api/auth/google', (_req, res) => {
  const oauth = getOAuthClient();
  if (!oauth) return res.status(503).json({ error: 'Gmail OAuth is not configured. Add the Google OAuth values to your local .env file.' });
  const state = randomBytes(24).toString('hex');
  oauthStateSet.add(state);
  setTimeout(() => oauthStateSet.delete(state), 10 * 60 * 1000).unref();
  const url = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
    state
  });
  res.json({ url });
});

app.get('/api/auth/google/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send('Google authorization was cancelled or denied. Return to the app and try again.');
    if (typeof state !== 'string' || !oauthStateSet.has(state)) return res.status(400).send('Invalid or expired OAuth state. Return to the app and reconnect Gmail.');
    oauthStateSet.delete(state);
    const oauth = getOAuthClient();
    if (!oauth || typeof code !== 'string') return res.status(400).send('OAuth configuration or authorization code is missing.');
    const { tokens } = await oauth.getToken(code);
    const previous = readTokens() || {};
    writeTokens({ ...previous, ...tokens, refresh_token: tokens.refresh_token || previous.refresh_token });
    res.redirect(`${CLIENT_ORIGIN}/?gmail=connected`);
  } catch (error) { next(error); }
});

app.post('/api/auth/disconnect', (_req, res) => {
  try { if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath); } catch { /* ignore local token cleanup failure */ }
  res.json({ ok: true });
});

app.get('/api/contacts', async (_req, res, next) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 }).limit(1000).lean();
    res.json({ contacts });
  } catch (error) { next(error); }
});

app.post('/api/contacts', async (req, res, next) => {
  try {
    const { email, company = '', contactName = '', role = '', notes = '' } = req.body || {};
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const contact = await Contact.findOneAndUpdate(
      { email: email.trim().toLowerCase() },
      { $set: { company, contactName, role, notes } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ contact });
  } catch (error) { next(error); }
});

app.post('/api/contacts/import', csvUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a CSV file first.' });
    const rows = parse(req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, trim: true, bom: true });
    let imported = 0, skipped = 0;
    for (const row of rows) {
      const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ''), value]));
      const email = normalized.email || normalized.emailaddress;
      if (!validEmail(email)) { skipped++; continue; }
      await Contact.findOneAndUpdate(
        { email: email.trim().toLowerCase() },
        { $set: {
          company: normalized.company || normalized.companyname || '',
          contactName: normalized.contactname || normalized.name || normalized.hrname || '',
          role: normalized.role || normalized.jobrole || '',
          notes: normalized.notes || ''
        } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      imported++;
    }
    res.json({ imported, skipped, totalRows: rows.length });
  } catch (error) { next(error); }
});

app.patch('/api/contacts/:id', async (req, res, next) => {
  try {
    const allowed = ['company', 'contactName', 'role', 'notes', 'status'];
    const update = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    const contact = await Contact.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    res.json({ contact });
  } catch (error) { next(error); }
});

app.delete('/api/contacts/:id', async (req, res, next) => {
  try {
    await Contact.findByIdAndDelete(req.params.id);
    await Draft.deleteMany({ contact: req.params.id, status: { $ne: 'sent' } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/resumes', async (_req, res, next) => {
  try {
    const resumes = await Resume.find().sort({ isDefault: -1, updatedAt: -1 }).lean();
    res.json({ resumes: resumes.map(({ fileName, ...resume }) => ({ ...resume, uploaded: fs.existsSync(path.join(uploadDir, fileName)) })) });
  } catch (error) { next(error); }
});

app.post('/api/resumes', libraryResumeUpload.single('resume'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a PDF resume first.' });
    const currentCount = await Resume.countDocuments();
    const hasDefault = Boolean(await Resume.exists({ isDefault: true }));
    const name = String(req.body.name || req.file.originalname.replace(/\.pdf$/i, '')).trim().slice(0, 100);
    const isDefault = String(req.body.isDefault || 'false') === 'true' || currentCount === 0 || !hasDefault;
    const targetRoles = splitKeywords(req.body.targetRoles).slice(0, 30);
    const skills = splitKeywords(req.body.skills).slice(0, 100);
    if (isDefault) await Resume.updateMany({}, { $set: { isDefault: false } });
    const resume = await Resume.create({
      name: name || 'Resume',
      originalName: req.file.originalname.slice(0, 250),
      fileName: req.file.filename,
      size: req.file.size,
      targetRoles,
      skills,
      description: String(req.body.description || '').slice(0, 1000),
      isDefault
    });
    const { fileName, ...publicResume } = resume.toObject();
    res.status(201).json({ resume: { ...publicResume, uploaded: true } });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(error);
  }
});

app.put('/api/resumes/:id', libraryResumeUpload.single('resume'), async (req, res, next) => {
  try {
    const resume = await Resume.findById(req.params.id);
    if (!resume) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Resume not found.' });
    }
    const nextDefault = String(req.body.isDefault || 'false') === 'true';
    if (nextDefault) {
      await Resume.updateMany({ _id: { $ne: resume._id } }, { $set: { isDefault: false } });
    } else if (resume.isDefault) {
      const alternate = await Resume.findOne({ _id: { $ne: resume._id } }).sort({ createdAt: -1 });
      if (!alternate) return res.status(400).json({ error: 'Keep one common fallback resume in the library. Add another resume before changing this one.' });
      alternate.isDefault = true;
      await alternate.save();
    }
    if (typeof req.body.name === 'string') resume.name = req.body.name.trim().slice(0, 100) || resume.name;
    if (typeof req.body.targetRoles === 'string') resume.targetRoles = splitKeywords(req.body.targetRoles).slice(0, 30);
    if (typeof req.body.skills === 'string') resume.skills = splitKeywords(req.body.skills).slice(0, 100);
    if (typeof req.body.description === 'string') resume.description = req.body.description.slice(0, 1000);
    if (req.body.isDefault !== undefined) resume.isDefault = nextDefault;
    if (req.file) {
      const oldPath = path.join(uploadDir, resume.fileName);
      resume.fileName = req.file.filename;
      resume.originalName = req.file.originalname.slice(0, 250);
      resume.size = req.file.size;
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    await resume.save();
    const { fileName, ...publicResume } = resume.toObject();
    res.json({ resume: { ...publicResume, uploaded: true } });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(error);
  }
});

app.delete('/api/resumes/:id', async (req, res, next) => {
  try {
    const resume = await Resume.findById(req.params.id);
    if (!resume) return res.status(404).json({ error: 'Resume not found.' });
    const others = await Resume.find({ _id: { $ne: resume._id } }).sort({ createdAt: -1 });
    const nextDefault = others.find(r => r.isDefault) || others[0] || null;
    if (nextDefault && !nextDefault.isDefault) nextDefault.isDefault = true;
    if (nextDefault) await nextDefault.save();
    await Draft.updateMany({ resume: resume._id, status: { $ne: 'sent' } }, {
      $set: {
        resume: nextDefault?._id || null,
        resumeName: nextDefault?.name || '',
        fallbackUsed: true,
        resumeMatchReason: 'Previously selected resume was deleted; using the available default resume instead.'
      }
    });
    await resume.deleteOne();
    const filePath = path.join(uploadDir, resume.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true, defaultResumeId: nextDefault?._id || null });
  } catch (error) { next(error); }
});

app.get('/api/drafts', async (_req, res, next) => {
  try {
    const drafts = await Draft.find().sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ drafts });
  } catch (error) { next(error); }
});

app.post('/api/drafts/generate', async (req, res, next) => {
  try {
    const { contactId, applicant = {} } = req.body || {};
    const contact = await Contact.findById(contactId);
    if (!contact) return res.status(404).json({ error: 'Choose a contact first.' });
    if (contact.status === 'do_not_contact') return res.status(400).json({ error: 'This contact is marked Do Not Contact.' });
    const targetProfile = { ...applicant, targetRole: contact.role?.trim() || applicant.targetRole || 'Entry-Level Software Developer' };
    const generated = await generateWithAI(contact, targetProfile);
    const selection = await selectResumeForDraft(contact, targetProfile, req.body.resumeId || '');
    const draft = await Draft.create({
      contact: contact._id,
      recipient: contact.email,
      resume: selection.resume?._id || null,
      resumeName: selection.resume?.name || '',
      resumeMatchScore: selection.score,
      resumeMatchReason: selection.reason,
      fallbackUsed: selection.fallbackUsed,
      resumeAutoSelected: selection.auto,
      company: contact.company,
      roleTarget: targetProfile.targetRole,
      subject: generated.subject,
      body: generated.body
    });
    res.status(201).json({ draft });
  } catch (error) { next(error); }
});

app.patch('/api/drafts/:id', async (req, res, next) => {
  try {
    const draft = await Draft.findById(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    if (draft.status === 'sent') return res.status(409).json({ error: 'Sent drafts cannot be edited.' });
    const { subject, body, resumeId } = req.body || {};
    if (typeof subject === 'string') draft.subject = subject.trim().slice(0, 240);
    if (typeof body === 'string') draft.body = body.slice(0, 8000);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'resumeId')) {
      const selectedResume = resumeId ? await Resume.findById(resumeId) : null;
      if (resumeId && !selectedResume) return res.status(400).json({ error: 'Selected resume not found.' });
      draft.resume = selectedResume?._id || null;
      draft.resumeName = selectedResume?.name || '';
      draft.resumeMatchScore = selectedResume ? 100 : 0;
      draft.resumeMatchReason = selectedResume ? 'Manually selected by you.' : 'No resume selected.';
      draft.fallbackUsed = false;
      draft.resumeAutoSelected = false;
    }
    draft.status = 'pending';
    draft.lastError = '';
    await draft.save();
    res.json({ draft });
  } catch (error) { next(error); }
});

app.post('/api/drafts/:id/skip', async (req, res, next) => {
  try {
    const draft = await Draft.findById(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    if (draft.status === 'sent') return res.status(409).json({ error: 'A sent email cannot be skipped.' });
    draft.status = 'skipped';
    await draft.save();
    res.json({ draft });
  } catch (error) { next(error); }
});

app.post('/api/drafts/:id/send', async (req, res, next) => {
  try {
    const { approved } = req.body || {};
    if (approved !== true) return res.status(400).json({ error: 'Explicit approval is required before sending.' });
    const draft = await Draft.findById(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    if (draft.status === 'sent') return res.status(409).json({ error: 'This draft has already been sent.' });
    if (draft.status === 'skipped') return res.status(409).json({ error: 'This draft was skipped. Generate a new draft to send.' });
    if (!validEmail(draft.recipient)) return res.status(400).json({ error: 'Recipient email is invalid.' });
    const attachedResume = draft.resume ? await Resume.findById(draft.resume) : null;
    const resumePath = attachedResume ? path.join(uploadDir, attachedResume.fileName) : path.join(uploadDir, 'resume.pdf');
    if (!fs.existsSync(resumePath)) return res.status(400).json({ error: 'The selected resume file is missing. Open Resume Library and upload or select a valid PDF.' });

    if (DRY_RUN) return res.json({ dryRun: true, message: 'Dry-run is enabled. No email was sent. Set DRY_RUN=false in your local .env after testing to enable Gmail sends.' });

    const { client, connected } = getAuthenticatedOAuthClient();
    if (!connected || !client) return res.status(400).json({ error: 'Connect Gmail before sending.' });
    const gmail = google.gmail({ version: 'v1', auth: client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const fromEmail = profile.data.emailAddress;
    const pdf = fs.readFileSync(resumePath).toString('base64');
    const boundary = `hr-outreach-${randomBytes(12).toString('hex')}`;
    const subject = draft.subject.replace(/[\r\n]/g, ' ').trim();
    const body = draft.body.replace(/\r?\n/g, '\r\n');
    const rawMessage = [
      `From: ${fromEmail}`,
      `To: ${draft.recipient}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
      '',
      `--${boundary}`,
      'Content-Type: application/pdf; name="Resume.pdf"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="Resume.pdf"',
      '',
      pdf.match(/.{1,76}/g).join('\r\n'),
      '',
      `--${boundary}--`
    ].join('\r\n');
    const encoded = Buffer.from(rawMessage).toString('base64url');
    try {
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
      draft.status = 'sent';
      draft.sentAt = new Date();
      draft.lastError = '';
      await draft.save();
      await Contact.findByIdAndUpdate(draft.contact, { status: 'contacted' });
      res.json({ sent: true, message: 'Email sent successfully.', draft });
    } catch (error) {
      draft.status = 'failed';
      draft.lastError = String(error.message || 'Gmail send failed').slice(0, 500);
      await draft.save();
      next(error);
    }
  } catch (error) { next(error); }
});

app.post('/api/resume', resumeUpload.single('resume'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose one PDF resume.' });
  res.json({ uploaded: true, filename: 'resume.pdf', size: req.file.size });
});

app.delete('/api/resume', (_req, res) => {
  try {
    const resumePath = path.join(uploadDir, 'resume.pdf');
    if (fs.existsSync(resumePath)) fs.unlinkSync(resumePath);
  } catch { /* ignored */ }
  res.json({ uploaded: false });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || (error.name === 'ValidationError' ? 400 : 500);
  res.status(status).json({ error: error.message || 'Unexpected server error.' });
});

async function start() {
  if (process.env.MONGODB_URI) {
    try { await mongoose.connect(process.env.MONGODB_URI); console.log('MongoDB connected'); }
    catch (error) { console.error('MongoDB connection failed:', error.message); }
  }
  app.listen(PORT, () => console.log(`HR Outreach API listening on http://localhost:${PORT} (DRY_RUN=${DRY_RUN})`));
}
start();
