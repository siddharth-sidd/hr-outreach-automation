import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowRight, ArrowUpRight, BadgeCheck, BriefcaseBusiness, Check, CheckCheck,
  ChevronDown, CircleAlert, ClipboardList, FileText, FileUp, Github, LoaderCircle,
  Mail, MailCheck, Menu, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck,
  Sparkles, Trash2, Upload, Users, X
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const blankProfile = {
  name: 'Siddharth Dubey',
  targetRole: 'Entry-Level Software Developer',
  skills: 'JavaScript, React.js, Node.js, Express.js, MongoDB, REST APIs, Git/GitHub',
  experience: 'Entry-level web development candidate with hands-on project experience',
  context: 'Ask whether relevant current or upcoming job opportunities are available.'
};
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || data || `Request failed (${response.status})`);
  return data;
}
const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const dateShort = value => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const initials = value => String(value || 'HR').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const splitText = value => (value || []).join(', ');
const asForm = fields => { const form = new FormData(); Object.entries(fields).forEach(([k,v]) => form.append(k, String(v ?? ''))); return form; };

function Pill({ status }) {
  const config = {
    new: ['blue','New'], pending: ['amber','Needs review'], sent: ['green','Sent'],
    failed: ['red','Failed'], skipped: ['gray','Skipped'], contacted: ['green','Contacted'],
    replied: ['purple','Replied'], do_not_contact: ['red','Do not contact']
  };
  const [tone,label] = config[status] || config.new;
  return <span className={`pill pill-${tone}`}><i />{label}</span>;
}
function Empty({ icon: Icon = Mail, title, text, action }) {
  return <div className="empty"><div className="empty-icon"><Icon size={22}/></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function Spinner(){ return <LoaderCircle size={16} className="spin"/>; }

export default function App() {
  const [page,setPage] = useState('Overview');
  const [health,setHealth] = useState({ database:'disconnected', gmailConnected:false, resumeUploaded:false, resumeCount:0, defaultResumeUploaded:false, dryRun:true, aiConfigured:false });
  const [contacts,setContacts] = useState([]);
  const [resumes,setResumes] = useState([]);
  const [drafts,setDrafts] = useState([]);
  const [notice,setNotice] = useState(null);
  const [busy,setBusy] = useState('');
  const [query,setQuery] = useState('');
  const [contactStatus,setContactStatus] = useState('all');
  const [addOpen,setAddOpen] = useState(false);
  const [contactForm,setContactForm] = useState({ email:'', company:'', contactName:'', role:'' });
  const [profile,setProfile] = useState(()=>{try{return {...blankProfile,...JSON.parse(localStorage.getItem('hr-outreach-profile')||'{}')}}catch{return blankProfile}});
  const [draftId,setDraftId] = useState('');
  const [contactId,setContactId] = useState('');
  const [resumeForm,setResumeForm] = useState({name:'',targetRoles:'',skills:'',description:'',isDefault:true});
  const [editResumeId,setEditResumeId] = useState('');
  const [editResumeForm,setEditResumeForm] = useState({});
  const csvInput = useRef(null);
  const resumeInput = useRef(null);
  const replaceInput = useRef(null);
  const replaceResumeId = useRef('');

  const refresh = useCallback(async () => {
    try {
      const [h,c,r,d] = await Promise.all([api('/api/health'),api('/api/contacts'),api('/api/resumes'),api('/api/drafts')]);
      setHealth(h); setContacts(c.contacts||[]); setResumes(r.resumes||[]); setDrafts(d.drafts||[]);
    } catch (error) { setNotice({type:'error',message:`${error.message}. Start the API server and verify MongoDB configuration.`}); }
  },[]);
  useEffect(()=>{ refresh(); },[refresh]);
  useEffect(()=>{localStorage.setItem('hr-outreach-profile',JSON.stringify(profile));},[profile]);
  useEffect(()=>{if(new URLSearchParams(location.search).get('gmail')==='connected'){setNotice({type:'success',message:'Gmail connected. Review every email before sending.'});history.replaceState({},'',location.pathname);refresh();}},[refresh]);
  const pending = drafts.filter(d=>d.status==='pending');
  const sent = drafts.filter(d=>d.status==='sent');
  const replies = contacts.filter(c=>c.status==='replied');
  const chosenDraft = drafts.find(d=>d._id===draftId) || null;
  const visibleContacts = useMemo(()=>contacts.filter(c=>{
    const txt=[c.email,c.company,c.contactName,c.role].join(' ').toLowerCase();
    return txt.includes(query.toLowerCase()) && (contactStatus==='all'||c.status===contactStatus);
  }),[contacts,query,contactStatus]);
  const noticeError = err=>setNotice({type:'error',message:err?.message||'Something went wrong.'});
  const task = async(key,fn,success) => {
    setBusy(key);
    try { await fn(); if(success) setNotice({type:'success',message:success}); }
    catch(err){noticeError(err);}
    finally{setBusy('');}
  };

  async function addContact(e){
    e.preventDefault();
    await task('add-contact',async()=>{await api('/api/contacts',json(contactForm));setContactForm({email:'',company:'',contactName:'',role:''});setAddOpen(false);await refresh();},'Contact saved.');
  }
  async function importCsv(e){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    await task('import',async()=>{const f=new FormData();f.append('file',file);const result=await api('/api/contacts/import',{method:'POST',body:f});await refresh();setNotice({type:'success',message:`Imported/updated ${result.imported} contacts; skipped ${result.skipped} invalid rows.`});});
  }
  async function uploadResume(e){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    if(!file.name.toLowerCase().endsWith('.pdf'))return setNotice({type:'error',message:'Please choose a PDF resume.'});
    const fields={...resumeForm,name:resumeForm.name.trim()||file.name.replace(/\.pdf$/i,'')};
    await task('upload-resume',async()=>{const f=asForm({...fields,isDefault:fields.isDefault?'true':'false'});f.append('resume',file);await api('/api/resumes',{method:'POST',body:f});setResumeForm({name:'',targetRoles:'',skills:'',description:'',isDefault:resumes.length===0});await refresh();setNotice({type:'success',message:'Resume added to your library. The matcher can now select it for suitable roles.'});});
  }
  async function replaceResume(e){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    if(!file.name.toLowerCase().endsWith('.pdf'))return setNotice({type:'error',message:'Please choose a PDF resume.'});
    const id=replaceResumeId.current; const resume=resumes.find(r=>r._id===id); if(!resume)return;
    const form=asForm({name:resume.name,targetRoles:splitText(resume.targetRoles),skills:splitText(resume.skills),description:resume.description,isDefault:resume.isDefault?'true':'false'});form.append('resume',file);
    await task('replace-'+id,async()=>{await api('/api/resumes/'+id,{method:'PUT',body:form});await refresh();},'Resume PDF replaced successfully.');
  }
  async function saveResumeMetadata(id,fields){
    await task('save-resume-'+id,async()=>{await api('/api/resumes/'+id,{method:'PUT',body:asForm({...fields,isDefault:fields.isDefault?'true':'false'})});setEditResumeId('');await refresh();},'Resume details updated.');
  }
  async function deleteResume(resume){
    if(!confirm(`Delete “${resume.name}”? Drafts using it will switch to the remaining default resume, if available.`))return;
    await task('delete-resume-'+resume._id,async()=>{await api('/api/resumes/'+resume._id,{method:'DELETE'});await refresh();},'Resume deleted.');
  }
  async function setDefaultResume(resume){
    await task('default-'+resume._id,async()=>{await api('/api/resumes/'+resume._id,{method:'PUT',body:asForm({name:resume.name,targetRoles:splitText(resume.targetRoles),skills:splitText(resume.skills),description:resume.description,isDefault:'true'})});await refresh();},'Common fallback resume updated.');
  }
  async function connectGmail(){
    await task('gmail',async()=>{const result=await api('/api/auth/google');location.href=result.url;});
  }
  async function createDraft(id){
    const target=id||contactId;if(!target)return setNotice({type:'error',message:'Choose an HR contact first.'});
    await task('draft',async()=>{const result=await api('/api/drafts/generate',json({contactId:target,applicant:profile}));await refresh();setDraftId(result.draft._id);setPage('Drafts');setNotice({type:'success',message:result.draft.resumeName?`Draft created with “${result.draft.resumeName}” selected for attachment.`:'Draft created. Add a resume in Resume Library before sending.'});});
  }
  async function saveDraft(){
    if(!chosenDraft)return;
    await task('save-draft',async()=>{const result=await api('/api/drafts/'+chosenDraft._id,json({subject:chosenDraft.subject,body:chosenDraft.body,resumeId:chosenDraft.resume||null},'PATCH'));setDrafts(ds=>ds.map(d=>d._id===result.draft._id?result.draft:d));},'Draft changes saved.');
  }
  async function chooseDraftResume(resumeId){
    if(!chosenDraft)return;
    await task('choose-resume',async()=>{const result=await api('/api/drafts/'+chosenDraft._id,json({resumeId},'PATCH'));setDrafts(ds=>ds.map(d=>d._id===result.draft._id?result.draft:d));},'Attachment selection updated.');
  }
  async function skipDraft(){
    if(!chosenDraft||!confirm('Skip this email draft? It will not be sent.'))return;
    await task('skip',async()=>{await api('/api/drafts/'+chosenDraft._id,json({}));await refresh();setDraftId('');},'Draft skipped.');
  }
  async function sendDraft(){
    if(!chosenDraft)return;
    const prompt=health.dryRun?'Dry-run is on. This test will not send an email. Continue with the approval-flow test?':`Send this individual email to ${chosenDraft.recipient} with “${chosenDraft.resumeName}” attached? Verify the subject, content, and attachment first.`;
    if(!confirm(prompt))return;
    await task('send',async()=>{const result=await api('/api/drafts/'+chosenDraft._id+'/send',json({approved:true}));if(result.dryRun)setNotice({type:'success',message:result.message});else{await refresh();setNotice({type:'success',message:result.message||'Email sent successfully.'});}},'');
  }
  async function updateContactStatus(contact,status){
    await task('status-'+contact._id,async()=>{await api('/api/contacts/'+contact._id,json({status},'PATCH'));await refresh();},'Contact status updated.');
  }
  async function deleteContact(contact){
    if(!confirm(`Delete ${contact.email} and its unsent drafts?`))return;
    await task('delete-contact',async()=>{await api('/api/contacts/'+contact._id,{method:'DELETE'});await refresh();},'Contact deleted.');
  }
  const changeDraft=(field,value)=>setDrafts(ds=>ds.map(d=>d._id===draftId?{...d,[field]:value}:d));
  const startEditResume=r=>{setEditResumeId(r._id);setEditResumeForm({name:r.name,targetRoles:splitText(r.targetRoles),skills:splitText(r.skills),description:r.description||'',isDefault:Boolean(r.isDefault)});};
  const nav=[['Overview',Activity],['Contacts',Users],['Drafts',Mail],['Resume Library',FileText],['Settings',Settings2]];
  
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e=>{e.preventDefault();setPage('Overview')}}><div className="brand-icon"><MailCheck size={21}/></div><div><strong>outreach<span>desk</span></strong><small>HR OUTREACH WORKSPACE</small></div></a>
      <div className="workspace-chip"><div className="workspace-avatar">SD</div><div><b>Personal workspace</b><span>Job search campaign</span></div><ChevronDown size={15}/></div>
      <div className="side-label">WORKSPACE</div>
      <nav>{nav.map(([name,Icon])=><button key={name} className={page===name?'active':''} onClick={()=>setPage(name)}><Icon size={17}/><span>{name}</span>{name==='Drafts'&&pending.length>0&&<i>{pending.length}</i>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="side-note"><ShieldCheck size={17}/><div><b>Review-first sending</b><span>You approve every email.</span></div></div>
        <a href="https://github.com/siddharth-sidd/hr-outreach-automation" target="_blank" rel="noreferrer" className="github-link"><Github size={16}/> Source on GitHub <ArrowUpRight size={13}/></a>
        <div className="user-chip"><div className="user-avatar">SD</div><div><b>{profile.name||'Your profile'}</b><span>Candidate profile</span></div></div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb"><span>Workspace</span><b>/</b><strong>{page}</strong></div><div className="topbar-actions"><span className={health.gmailConnected?'connection on':'connection'}><i/>{health.gmailConnected?'Gmail connected':'Gmail not connected'}</span><button className="btn primary small" onClick={connectGmail} disabled={busy==='gmail'||health.gmailConnected}>{busy==='gmail'?<Spinner/>:<Mail size={15}/>} {health.gmailConnected?'Connected':'Connect Gmail'}</button></div></header>
      <div className="content">
        {notice&&<div className={'notice '+notice.type}><span>{notice.type==='error'?<CircleAlert size={17}/>:<BadgeCheck size={17}/>}</span><p>{notice.message}</p><button onClick={()=>setNotice(null)} aria-label="Dismiss"><X size={16}/></button></div>}
        {health.dryRun&&<div className="dry-banner"><ShieldCheck size={17}/><p><b>Safe test mode is on.</b> Real emails are disabled while <code>DRY_RUN=true</code>. Each live send will still require an explicit confirmation.</p><span>DRY RUN</span></div>}

        {page==='Overview'&&<section>
          <div className="hero-row"><div><div className="eyebrow"><i/> YOUR PERSONAL OUTREACH WORKSPACE</div><h1>Good to see you, Siddharth <span>✦</span></h1><p>Make each application count. Keep contacts organized, match the right resume, and review every email before sending.</p></div><div className="hero-actions"><button className="btn secondary" onClick={()=>csvInput.current?.click()}><Upload size={15}/> Import list</button><button className="btn primary" onClick={()=>setPage('Drafts')}><Mail size={15}/> Review drafts</button></div></div>
          <div className="stats">
            <Stat icon={Users} label="HR CONTACTS" value={contacts.length} sub="In your outreach list" color="blue"/>
            <Stat icon={Mail} label="DRAFTS TO REVIEW" value={pending.length} sub="Awaiting your approval" color="violet"/>
            <Stat icon={MailCheck} label="EMAILS SENT" value={sent.length} sub="Successfully sent" color="green"/>
            <Stat icon={Activity} label="REPLIES LOGGED" value={replies.length} sub="Updated by you" color="amber"/>
          </div>
          <div className="overview-grid">
            <div className="panel setup"><div className="panel-heading"><div><div className="eyebrow">QUICK START</div><h2>Finish setting up</h2><p>Complete the steps to prepare your first campaign.</p></div><span className="count-big">{[health.database==='connected',contacts.length>0,resumes.length>0,health.gmailConnected].filter(Boolean).length}<small> / 4</small></span></div><div className="progress"><span style={{width:`${[health.database==='connected',contacts.length>0,resumes.length>0,health.gmailConnected].filter(Boolean).length*25}%`}}/></div>
              <Checklist done={health.database==='connected'} title="Connect database" text={health.database==='connected'?'MongoDB is connected.':'Start MongoDB and set MONGODB_URI in your local .env.'}/>
              <Checklist done={contacts.length>0} title="Import HR contacts" text={contacts.length?`${contacts.length} contacts in your workspace.`:'Import your spreadsheet of HR/company email IDs.'}/>
              <Checklist done={resumes.length>0} title="Build your resume library" text={resumes.length?`${resumes.length} PDFs ready for matching.`:'Upload multiple targeted resumes and one common fallback.'}/>
              <Checklist done={health.gmailConnected} title="Connect Gmail" text={health.gmailConnected?'Gmail OAuth is connected.':'Authorize Gmail to send approved messages.'}/>
              <div className="panel-footer"><button className="link-button" onClick={()=>setPage('Settings')}>Open settings <ArrowUpRight size={14}/></button><span><ShieldCheck size={14}/> Approval required before every send</span></div>
            </div>
            <div className="panel blue-feature"><div className="feature-icon"><Sparkles size={21}/></div><div className="eyebrow">SMART RESUME MATCHING</div><h2>Right email.<br/>Right resume.</h2><p>Add separate resumes for React, MERN, JavaScript, support, or other roles. The matcher picks the most relevant resume for each draft.</p><div className="feature-line"><Check size={14}/> Compare target roles and skills</div><div className="feature-line"><Check size={14}/> Fall back to your common resume</div><div className="feature-line"><Check size={14}/> Change attachment before approval</div><button className="btn light" onClick={()=>setPage('Resume Library')}>Manage resume library <ArrowRight size={15}/></button></div>
          </div>
          <div className="bottom-grid">
            <div className="panel"><PanelHead title="New contacts" sub="Start a personalized draft"/><div className="compact-list">{contacts.filter(c=>c.status==='new').slice(0,4).map(c=><div className="contact-row" key={c._id}><Avatar value={c.contactName||c.company||c.email}/><div className="grow"><b>{c.company||'Company not specified'}</b><span>{c.email}</span></div><button className="icon-btn" onClick={()=>createDraft(c._id)} title="Create draft"><Mail size={15}/></button></div>)}{!contacts.some(c=>c.status==='new')&&<Empty icon={Users} title="No new contacts yet" text="Import your HR list or add a contact to begin." action={<button className="btn secondary" onClick={()=>setAddOpen(true)}>Add contact</button>}/>}</div><div className="panel-bottom"><button className="link-button" onClick={()=>setPage('Contacts')}>View all contacts <ArrowRight size={14}/></button></div></div>
            <div className="panel"><PanelHead title="Recent drafts" sub="Latest email activity"/><div className="compact-list">{[...drafts].slice(0,4).map(d=><button className="activity-row" key={d._id} onClick={()=>{setDraftId(d._id);setPage('Drafts')}}><div className="activity-mark"><Mail size={15}/></div><div className="grow"><b>{d.company||d.recipient}</b><span>{d.subject}</span></div><Pill status={d.status}/></button>)}{!drafts.length&&<Empty icon={Mail} title="No drafts yet" text="Create a draft from a contact to see it here."/>}</div><div className="panel-bottom"><button className="link-button" onClick={()=>setPage('Drafts')}>Open draft queue <ArrowRight size={14}/></button></div></div>
          </div>
        </section>}

        {page==='Contacts'&&<section>
          <PageTitle eyebrow="YOUR TARGET COMPANIES" title="HR contacts" text="Import, organize, and track every hiring contact." action={<><button className="btn secondary" onClick={()=>csvInput.current?.click()}><Upload size={15}/> Import CSV</button><button className="btn primary" onClick={()=>setAddOpen(true)}><Plus size={16}/> Add contact</button></>}/>
          <div className="toolbar"><div className="search"><Search size={16}/><input placeholder="Search company, name, or email…" value={query} onChange={e=>setQuery(e.target.value)}/></div><select value={contactStatus} onChange={e=>setContactStatus(e.target.value)}><option value="all">All statuses</option><option value="new">New</option><option value="contacted">Contacted</option><option value="replied">Replied</option><option value="do_not_contact">Do not contact</option></select><span>{visibleContacts.length} contacts</span></div>
          <div className="panel table-panel">{visibleContacts.length?<div className="table-wrap"><table><thead><tr><th>CONTACT</th><th>COMPANY / ROLE</th><th>STATUS</th><th>ADDED</th><th>ACTIONS</th></tr></thead><tbody>{visibleContacts.map(c=><tr key={c._id}><td><div className="table-contact"><Avatar value={c.contactName||c.company||c.email}/><div><b>{c.contactName||'Hiring team'}</b><span>{c.email}</span></div></div></td><td><div className="table-company"><b>{c.company||'—'}</b><span>{c.role||'Role not specified'}</span></div></td><td><Pill status={c.status}/></td><td>{dateShort(c.createdAt)}</td><td><div className="action-row"><button className="icon-btn" title="Create personalized draft" onClick={()=>createDraft(c._id)}><Mail size={15}/></button><select title="Change status" value={c.status} onChange={e=>updateContactStatus(c,e.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="replied">Replied</option><option value="do_not_contact">Do not contact</option></select><button className="icon-btn danger" title="Delete contact" onClick={()=>deleteContact(c)}><Trash2 size={14}/></button></div></td></tr>)}</tbody></table></div>:<Empty icon={Users} title="No contacts found" text={query?'Try another search.':'Import your HR email list or add a first contact.'} action={<button className="btn primary" onClick={()=>csvInput.current?.click()}><Upload size={15}/> Import contacts</button>}/>}</div>
          <p className="help-text">CSV columns: <code>email</code> (required), plus <code>company</code>, <code>contactName</code>, <code>role</code>, and <code>notes</code>.</p>
        </section>}

        {page==='Resume Library'&&<section>
          <PageTitle eyebrow="MULTIPLE RESUMES · SMART ATTACHMENT" title="Resume library" text="Keep different resumes for different roles. The best match is selected for each draft, with a common resume as fallback."/>
          <div className="resume-guidance"><div className="guidance-icon"><Sparkles size={19}/></div><div><b>How matching works</b><p>Set target roles and skill keywords for each PDF. The matcher compares these with the contact’s role and your candidate profile. If no resume reaches the match threshold, it selects the marked <b>Common fallback</b> resume. You can always change the attachment in the draft review screen.</p></div></div>
          <div className="panel upload-panel"><div className="panel-heading"><div><div className="eyebrow">ADD A RESUME</div><h2>Add or update your resume collection</h2><p>PDF only · Files are stored on your server, not in the GitHub repository.</p></div><div className="big-file-icon"><FileUp size={22}/></div></div>
            <form onSubmit={e=>{e.preventDefault();resumeInput.current?.click()}} className="resume-form">
              <div className="form-grid"><label>Resume name<input value={resumeForm.name} onChange={e=>setResumeForm({...resumeForm,name:e.target.value})} placeholder="e.g. MERN Stack Developer"/></label><label>Target roles<input value={resumeForm.targetRoles} onChange={e=>setResumeForm({...resumeForm,targetRoles:e.target.value})} placeholder="MERN Developer, React Developer"/></label><label className="wide">Skills / matching keywords<input value={resumeForm.skills} onChange={e=>setResumeForm({...resumeForm,skills:e.target.value})} placeholder="React, JavaScript, Node.js, MongoDB, REST API"/></label><label className="wide">Notes (optional)<textarea rows="2" value={resumeForm.description} onChange={e=>setResumeForm({...resumeForm,description:e.target.value})} placeholder="What makes this resume suitable?"/></label></div>
              <div className="form-foot"><label className="check-label"><input type="checkbox" checked={resumeForm.isDefault} onChange={e=>setResumeForm({...resumeForm,isDefault:e.target.checked})}/> Use as common fallback when no resume matches</label><button className="btn primary" type="submit" disabled={busy==='upload-resume'}>{busy==='upload-resume'?<Spinner/>:<Upload size={15}/>} Choose PDF & upload</button></div>
              <span className="form-hint">After you click upload, select your PDF from the laptop. You can add more resumes or replace them later.</span>
            </form>
          </div>
          <div className="resume-library-head"><div><h2>Your saved resumes <span>{resumes.length}</span></h2><p>Review the metadata used to match resumes to roles.</p></div><button className="btn secondary" onClick={refresh}><RefreshCw size={15}/> Refresh</button></div>
          {resumes.length?<div className="resume-grid">{resumes.map(r=><ResumeCard key={r._id} resume={r} editing={editResumeId===r._id} editForm={editResumeForm} setEditForm={setEditResumeForm} startEdit={()=>startEditResume(r)} cancelEdit={()=>setEditResumeId('')} saveEdit={()=>saveResumeMetadata(r._id,editResumeForm)} makeDefault={()=>setDefaultResume(r)} deleteResume={()=>deleteResume(r)} replaceResume={()=>{replaceResumeId.current=r._id;replaceInput.current?.click()}} busy={busy}/>)}</div>:<div className="panel"><Empty icon={FileText} title="Your resume library is empty" text="Upload two or three role-specific resumes and mark one common resume as the fallback." /></div>}
          <div className="help-text"><ShieldCheck size={14}/> Resume metadata can be edited later. Replace a PDF without needing to change your HR contact list or drafts.</div>
        </section>}

        {page==='Drafts'&&<section>
          <PageTitle eyebrow="PERSONALIZED EMAILS" title="Review email drafts" text="The selected resume and message remain editable. Nothing is sent until you approve the individual email." action={<button className="btn secondary" onClick={refresh}><RefreshCw size={15}/> Refresh</button>}/>
          <div className="draft-layout"><div className="panel queue"><div className="queue-heading"><div><b>Draft queue</b><span>{drafts.length} total</span></div><strong>{pending.length} to review</strong></div>
            {drafts.length?drafts.map(d=><button className={'queue-item '+(draftId===d._id?'selected':'')} key={d._id} onClick={()=>setDraftId(d._id)}><div className="queue-top"><Avatar value={d.company||d.recipient}/><Pill status={d.status}/></div><b>{d.company||d.recipient}</b><span className="queue-email">{d.recipient}</span><p>{d.subject}</p><div className="queue-foot"><span>{dateShort(d.updatedAt)}</span><span>{d.resumeName?d.resumeName:'No resume selected'}</span></div></button>):<Empty icon={Mail} title="No drafts in the queue" text="Create a draft from any contact, and the app will suggest a matching resume." action={<button className="btn primary" onClick={()=>setPage('Contacts')}>Choose contact</button>}/>}
          </div>
          <div className="panel composer">{chosenDraft?<><div className="composer-heading"><div><div className="eyebrow">EMAIL PREVIEW & EDITOR</div><h2>{chosenDraft.status==='sent'?'Sent email':'Review before sending'}</h2></div><Pill status={chosenDraft.status}/></div>
            <div className="field"><label>To</label><div className="recipient-field"><span>{chosenDraft.recipient}</span><small>Individual email</small></div></div>
            <div className="field"><label>Subject</label><input maxLength="240" value={chosenDraft.subject} onChange={e=>changeDraft('subject',e.target.value)} disabled={chosenDraft.status==='sent'}/></div>
            <div className="field"><div className="field-label"><label>Message</label><small>Plain text · Editable</small></div><textarea rows="11" value={chosenDraft.body} onChange={e=>changeDraft('body',e.target.value)} disabled={chosenDraft.status==='sent'}/></div>
            <div className="selected-resume"><div className="pdf-icon"><FileText size={20}/></div><div className="selected-resume-copy"><b>Attachment</b><span>{chosenDraft.resumeName||'No resume selected'}</span><small>{chosenDraft.resumeMatchReason||'Select the best resume for this email.'}</small></div>{chosenDraft.fallbackUsed&&<span className="fallback-flag">FALLBACK</span>}</div>
            <div className="field"><label>Choose another resume</label><select value={chosenDraft.resume?String(chosenDraft.resume):''} onChange={e=>chooseDraftResume(e.target.value)} disabled={chosenDraft.status==='sent'||!resumes.length}><option value="">— Select a PDF —</option>{resumes.map(r=><option key={r._id} value={r._id}>{r.name}{r.isDefault?' (common fallback)':''}</option>)}</select><small className="matching-note">Auto-match score: {chosenDraft.resumeMatchScore||0}% · You can override the recommendation at any time.</small></div>
            <div className="attach-reminder"><ShieldCheck size={16}/><span>Check the recipient, message, and selected PDF before approval.</span></div>
            {chosenDraft.lastError&&<div className="inline-error"><CircleAlert size={15}/>{chosenDraft.lastError}</div>}
            {chosenDraft.status!=='sent'&&<div className="composer-actions"><button className="btn secondary" onClick={saveDraft} disabled={Boolean(busy)||chosenDraft.status==='skipped'}><CheckCheck size={15}/> Save draft</button><button className="btn ghost" onClick={skipDraft} disabled={Boolean(busy)||chosenDraft.status==='skipped'}><X size={15}/> Skip</button><button className="btn primary" onClick={sendDraft} disabled={Boolean(busy)||chosenDraft.status==='skipped'||!chosenDraft.resume||!health.resumeUploaded||(!health.dryRun&&!health.gmailConnected)}>{busy==='send'?<Spinner/>:<Send size={15}/>} {health.dryRun?'Test approval':'Approve & send'}</button></div>}
          </>:<Empty icon={ClipboardList} title="Select a draft to review" text="Choose a draft from the queue to edit and review the chosen resume before sending."/>}</div></div>
        </section>}

        {page==='Settings'&&<section>
          <PageTitle eyebrow="CANDIDATE PROFILE & CONNECTIONS" title="Settings" text="Update your candidate information. These details are used when generating future drafts."/>
          <div className="settings-grid"><div className="panel settings-panel"><div className="panel-heading"><div><h2>Candidate profile</h2><p>Used as context for personalized draft generation.</p></div><BriefcaseBusiness size={20}/></div><form onSubmit={e=>{e.preventDefault();setNotice({type:'success',message:'Candidate profile saved in this browser.'})}} className="settings-form">
            <label>Your name<input value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label><label>Default target role<input value={profile.targetRole} onChange={e=>setProfile({...profile,targetRole:e.target.value})}/></label><label>Skills<textarea rows="3" value={profile.skills} onChange={e=>setProfile({...profile,skills:e.target.value})}/></label><label>Experience summary<textarea rows="2" value={profile.experience} onChange={e=>setProfile({...profile,experience:e.target.value})}/></label><label>Additional context for AI<textarea rows="2" value={profile.context} onChange={e=>setProfile({...profile,context:e.target.value})}/></label><button className="btn primary" type="submit"><Check size={15}/> Save profile</button></form></div>
            <div className="settings-stack"><div className="panel setting-card"><div className="setting-symbol"><Mail size={19}/></div><div className="setting-main"><b>Gmail OAuth</b><p>Connect through Google's consent page using the send-only scope.</p><span className={health.gmailConnected?'good-text':'muted-text'}>{health.gmailConnected?'Connected':'Not connected'}</span></div><button className="btn secondary" onClick={connectGmail} disabled={Boolean(busy)||health.gmailConnected}>{health.gmailConnected?'Connected':'Connect'}</button></div>
            <div className="panel setting-card"><div className="setting-symbol purple"><Sparkles size={19}/></div><div className="setting-main"><b>AI draft generation</b><p>{health.aiConfigured?'AI provider configured.':'The app uses a template until AI_API_KEY is configured.'}</p><span className={health.aiConfigured?'good-text':'muted-text'}>{health.aiConfigured?'Enabled':'Optional'}</span></div></div>
            <div className="panel setting-card"><div className="setting-symbol green"><FileText size={19}/></div><div className="setting-main"><b>Resume library</b><p>{resumes.length} PDF(s), {resumes.filter(r=>r.isDefault).length} common fallback selected.</p><button className="link-button" onClick={()=>setPage('Resume Library')}>Manage resumes <ArrowRight size={14}/></button></div></div>
            <div className="panel setting-card"><div className="setting-symbol amber"><ShieldCheck size={19}/></div><div className="setting-main"><b>Sending safeguards</b><p>Live sending is controlled by server-side DRY_RUN. Each email requires explicit user approval.</p><span className="muted-text">{health.dryRun?'Dry-run enabled — no actual emails sent':'Live mode configured'}</span></div></div></div></div>
        </section>}
        <footer className="footer"><span>Outreach Desk <b>·</b> Make every application count.</span><span><ShieldCheck size={13}/> Keep private resumes and .env secrets out of GitHub.</span></footer>
      </div>
    </main>

    {addOpen&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)setAddOpen(false)}}><div className="modal"><div className="modal-title"><div><div className="eyebrow">CONTACT MANAGEMENT</div><h2>Add HR contact</h2></div><button className="icon-btn" onClick={()=>setAddOpen(false)}><X size={17}/></button></div><form className="settings-form" onSubmit={addContact}><label>Email address *<input required type="email" value={contactForm.email} onChange={e=>setContactForm({...contactForm,email:e.target.value})} placeholder="hr@company.com"/></label><label>Company<input value={contactForm.company} onChange={e=>setContactForm({...contactForm,company:e.target.value})} placeholder="Company name"/></label><label>HR / contact name<input value={contactForm.contactName} onChange={e=>setContactForm({...contactForm,contactName:e.target.value})} placeholder="Optional"/></label><label>Known target role or notes<input value={contactForm.role} onChange={e=>setContactForm({...contactForm,role:e.target.value})} placeholder="React Developer, MERN Stack…"/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setAddOpen(false)}>Cancel</button><button type="submit" className="btn primary" disabled={busy==='add-contact'}>{busy==='add-contact'?<Spinner/>:<Plus size={15}/>} Save contact</button></div></form></div></div>}
    <input ref={csvInput} className="hidden" type="file" accept=".csv,text/csv" onChange={importCsv}/>
    <input ref={resumeInput} className="hidden" type="file" accept=".pdf,application/pdf" onChange={uploadResume}/>
    <input ref={replaceInput} className="hidden" type="file" accept=".pdf,application/pdf" onChange={replaceResume}/>
  </div>;
}

function Stat({icon:Icon,label,value,sub,color}){return <div className="stat"><div className={'stat-icon '+color}><Icon size={18}/></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div>}
function Checklist({done,title,text}){return <div className="check-row"><div className={done?'checked':'unchecked'}>{done?<Check size={14}/>:<span/>}</div><div><b>{title}</b><p>{text}</p></div><Pill status={done?'contacted':'new'}/></div>}
function PageTitle({eyebrow,title,text,action}){return <div className="page-title-row"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{text}</p></div>{action&&<div className="page-actions">{action}</div>}</div>}
function PanelHead({title,sub}){return <div className="simple-panel-head"><div><h2>{title}</h2><p>{sub}</p></div></div>}
function Avatar({value}){return <div className="avatar">{initials(value)}</div>}

function ResumeCard({resume,editing,editForm,setEditForm,startEdit,cancelEdit,saveEdit,makeDefault,deleteResume,replaceResume,busy}){
  return <article className="resume-card"><div className="resume-card-top"><div className="resume-big-icon"><FileText size={21}/></div><div className="resume-card-title"><h3>{resume.name}</h3><span>{resume.originalName}</span></div><button className="icon-btn danger" title="Delete resume" onClick={deleteResume}><Trash2 size={15}/></button></div>
    <div className="resume-badges">{resume.isDefault&&<span className="fallback-tag"><ShieldCheck size={12}/> Common fallback</span>}<span className="file-type">PDF · {Math.max(1,Math.round((resume.size||0)/1024))} KB</span></div>
    {editing?<div className="edit-resume"><label>Resume name<input value={editForm.name||''} onChange={e=>setEditForm({...editForm,name:e.target.value})}/></label><label>Target roles<input value={editForm.targetRoles||''} onChange={e=>setEditForm({...editForm,targetRoles:e.target.value})}/></label><label>Skill keywords<input value={editForm.skills||''} onChange={e=>setEditForm({...editForm,skills:e.target.value})}/></label><label>Notes<textarea rows="2" value={editForm.description||''} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></label><label className="check-label"><input type="checkbox" checked={Boolean(editForm.isDefault)} onChange={e=>setEditForm({...editForm,isDefault:e.target.checked})}/> Set as common fallback</label><div className="edit-actions"><button className="btn secondary small" onClick={cancelEdit}>Cancel</button><button className="btn primary small" onClick={saveEdit} disabled={busy==='save-resume-'+resume._id}>{busy==='save-resume-'+resume._id?<Spinner/>:<Check size={14}/>} Save details</button></div></div>
    :<><div className="resume-meta"><label>Target roles</label><div className="chip-wrap">{(resume.targetRoles||[]).length?resume.targetRoles.map(r=><span className="keyword" key={r}>{r}</span>):<span className="muted-text">No target roles set</span>}</div></div><div className="resume-meta"><label>Skills / keywords</label><div className="chip-wrap">{(resume.skills||[]).length?resume.skills.slice(0,8).map(s=><span className="keyword subtle" key={s}>{s}</span>):<span className="muted-text">No keywords set</span>}{(resume.skills||[]).length>8&&<span className="keyword subtle">+{resume.skills.length-8}</span>}</div></div>{resume.description&&<p className="resume-description">{resume.description}</p>}<div className="resume-card-actions"><button className="btn secondary small" onClick={startEdit}><Settings2 size={14}/> Edit details</button><button className="btn secondary small" onClick={replaceResume}><RefreshCw size={14}/> Replace PDF</button>{!resume.isDefault&&<button className="btn light-outline small" onClick={makeDefault} disabled={Boolean(busy)} title="Use this when no targeted resume matches">Set fallback</button>}</div></>}
    <div className="resume-card-footer"><span>Updated {dateShort(resume.updatedAt)}</span><span className={resume.uploaded?'good-text':'muted-text'}>{resume.uploaded?'File available':'File missing'}</span></div>
  </article>;
}
