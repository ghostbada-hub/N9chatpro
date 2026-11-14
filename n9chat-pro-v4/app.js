'use strict';

// ── Service Worker ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e));
  });
}

const { useState, useEffect, useRef, useCallback, createElement: h } = React;

const VISION_MODEL  = "meta-llama/llama-4-scout-17b-16e-instruct";
const TEXT_MODEL    = "llama-3.3-70b-versatile";
const WHISPER_MODEL = "whisper-large-v3";

const LANGUAGES = [
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'ar', label: '🇸🇦 العربية' },
  { code: 'es', label: '🇪🇸 Español' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'pt', label: '🇧🇷 Português' },
];

const THEMES = [
  { id: 'blue',    label: 'Saphir',   accent: '#2563eb', bg: '#f0f4ff', bgDark: '#0d1b3e' },
  { id: 'violet',  label: 'Violet',   accent: '#7c3aed', bg: '#f5f3ff', bgDark: '#1a0e3a' },
  { id: 'emerald', label: 'Émeraude', accent: '#059669', bg: '#f0fdf4', bgDark: '#082316' },
  { id: 'rose',    label: 'Rose',     accent: '#e11d48', bg: '#fff1f2', bgDark: '#2a0812' },
  { id: 'amber',   label: 'Ambre',    accent: '#d97706', bg: '#fffbeb', bgDark: '#221700' },
  { id: 'slate',   label: 'Ardoise',  accent: '#475569', bg: '#f8fafc', bgDark: '#0f172a' },
];

const AI_PERSONAS = [
  { id: 'expert',   label: '🔬 Expert',     desc: 'Analytique, précis, structuré' },
  { id: 'coach',    label: '💪 Coach',       desc: 'Motivant, bienveillant, proactif' },
  { id: 'creative', label: '🎨 Créatif',     desc: 'Imaginatif, original, inspirant' },
  { id: 'concise',  label: '⚡ Concis',      desc: 'Réponses courtes et directes' },
  { id: 'socratic', label: '🧠 Socratique',  desc: 'Guide par des questions ciblées' },
];

const QUICK_SUGGESTIONS = [
  "Résume notre conversation",
  "Explique différemment",
  "Donne des exemples concrets",
  "Quels sont les points clés ?",
  "Approfondis ce sujet",
  "Quelles sont les alternatives ?",
];

// ── Sounds ──────────────────────────────────────────────────────
let _ctx = null;
function getAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!_ctx && AC) { try { _ctx = new AC(); } catch(e){} }
  return _ctx;
}
function playTone(freq, dur, type, vol) {
  const ctx = getAudioCtx(); if (!ctx) return;
  try {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = type||'sine'; o.frequency.value = freq||880;
    g.gain.setValueAtTime(vol||0.1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur||0.08));
    o.start(); o.stop(ctx.currentTime + (dur||0.08));
  } catch(e) {}
}
function playReceiveSound() { playTone(660,0.06,'sine',0.1); setTimeout(()=>playTone(880,0.08,'sine',0.08),70); }
function playSendSound()    { playTone(440,0.05,'sine',0.07); }
function vibrateDevice(p)   { try { if (navigator.vibrate) navigator.vibrate(p||[30]); } catch(e) {} }

// ── Storage helpers ──────────────────────────────────────────────
const DEFAULT_PROFILE = {
  name:'', pseudo:'', bio:'', language:'fr', theme:'blue', avatar:null,
  persona:'expert', darkMode:false, soundEnabled:true, vibrateEnabled:true,
};
function loadProfile()  { try { const r=localStorage.getItem('n9_profile'); return r?{...DEFAULT_PROFILE,...JSON.parse(r)}:null; } catch{return null;} }
function saveProfile(p) { localStorage.setItem('n9_profile', JSON.stringify(p)); }
function loadThreads()  { try { const r=localStorage.getItem('n9_threads'); return r?JSON.parse(r):null; } catch{return null;} }
function saveThreads(threads) {
  const clean = threads.map(t=>({...t, messages:t.messages.map(m=>({...m, attachments:m.attachments?m.attachments.map(a=>({...a,file:undefined})):undefined}))}));
  try { localStorage.setItem('n9_threads', JSON.stringify(clean)); } catch(e) {}
}

function applyTheme(themeId, dark) {
  const t = THEMES.find(x=>x.id===themeId)||THEMES[0];
  const r = document.documentElement;
  r.style.setProperty('--accent', t.accent);
  r.style.setProperty('--accent-hover', t.accent+'cc');
  r.style.setProperty('--accent-light', t.accent+(dark?'28':'18'));
  r.style.setProperty('--accent-glow', t.accent+'28');
  r.style.setProperty('--msg-user-bg', t.accent);
  r.style.setProperty('--thread-active-txt', t.accent);
  r.style.setProperty('--thread-active-border', t.accent+'60');
  r.style.setProperty('--thread-active-bg', t.accent+'18');
  r.style.setProperty('--border-focus', t.accent+'90');
  if (dark) {
    r.style.setProperty('--bg', t.bgDark);
    r.style.setProperty('--surface', '#1a2035');
    r.style.setProperty('--surface-2', '#131929');
    r.style.setProperty('--border', '#2a3555');
    r.style.setProperty('--text-primary', '#e8edf8');
    r.style.setProperty('--text-secondary', '#8fa3c8');
    r.style.setProperty('--text-muted', '#4a5f8a');
    r.style.setProperty('--input-bg', '#1a2035');
    r.style.setProperty('--input-border', '#2a3555');
    r.style.setProperty('--msg-ai-bg', '#1e2a45');
    r.style.setProperty('--msg-ai-txt', '#e8edf8');
    r.style.setProperty('--msg-ai-border', '#2a3555');
    document.body.classList.add('dark');
  } else {
    r.style.setProperty('--bg', t.bg);
    r.style.setProperty('--surface', '#ffffff');
    r.style.setProperty('--surface-2', '#f7f9fe');
    r.style.setProperty('--border', '#dde5f5');
    r.style.setProperty('--text-primary', '#0f1c3f');
    r.style.setProperty('--text-secondary', '#4a5f8a');
    r.style.setProperty('--text-muted', '#8fa3c8');
    r.style.setProperty('--input-bg', '#ffffff');
    r.style.setProperty('--input-border', '#dde5f5');
    r.style.setProperty('--msg-ai-bg', '#ffffff');
    r.style.setProperty('--msg-ai-txt', '#0f1c3f');
    r.style.setProperty('--msg-ai-border', '#dde5f5');
    document.body.classList.remove('dark');
  }
}

async function requestPushPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}
function sendPushNotification(title, body) {
  if (Notification.permission==='granted' && document.hidden) new Notification(title, { body });
}
function exportTxt(thread) {
  const blob = new Blob([thread.messages.map(m=>`[${m.sender}]\n${m.text||''}\n`).join('\n')], {type:'text/plain'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${thread.title}.txt`; a.click(); URL.revokeObjectURL(a.href);
}
function exportPdf(thread) {
  const win = window.open('','_blank'); if (!win) return;
  const rows = thread.messages.map(m=>`<div style="margin-bottom:16px"><strong style="color:#2563eb;font-size:.75rem;text-transform:uppercase">${m.sender}</strong><p style="margin:4px 0;white-space:pre-wrap;color:#1a1a2e">${(m.text||'').replace(/</g,'&lt;')}</p></div>`).join('');
  win.document.write(`<!DOCTYPE html><html><head><title>${thread.title}</title><style>body{font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px}h1{font-size:1.2rem;border-bottom:2px solid #2563eb;padding-bottom:8px;color:#0f1c3f}</style></head><body><h1>${thread.title}</h1>${rows}</body></html>`);
  win.document.close(); win.print();
}

// ── ICONS ────────────────────────────────────────────────────────
const N9Logo = ({size=40}) => h("svg",{width:size,height:size,viewBox:"0 0 100 100",style:{flexShrink:0,borderRadius:'22%'}},
  h("defs",null,h("linearGradient",{id:"n9g",x1:"0%",y1:"0%",x2:"100%",y2:"100%"},h("stop",{offset:"0%",stopColor:"var(--accent)"}),h("stop",{offset:"100%",stopColor:"#6d28d9"}))),
  h("rect",{width:100,height:100,rx:26,fill:"url(#n9g)"}),
  h("path",{d:"M32 68V32L50 50L68 32V68",stroke:"white",strokeWidth:9,strokeLinecap:"round",strokeLinejoin:"round",fill:"none"}));
const Ico = (d,extra={}) => h("svg",{width:18,height:18,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round",...extra},
  Array.isArray(d)?d.map((p,i)=>h(p[0],{key:i,...p[1]})):h(d[0],d[1]));
const SendIcon    = ()=>h("svg",{width:18,height:18,viewBox:"0 0 24 24",fill:"none",stroke:"white",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round"},h("line",{x1:"22",y1:"2",x2:"11",y2:"13"}),h("polygon",{points:"22 2 15 22 11 13 2 9 22 2",fill:"white",stroke:"none"}));
const UploadIcon  = ()=>h("svg",{width:18,height:18,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}),h("polyline",{points:"17 8 12 3 7 8"}),h("line",{x1:"12",y1:"3",x2:"12",y2:"15"}));
const AudioIcon   = ()=>h("svg",{width:18,height:18,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M9 18V5l12-2v13"}),h("circle",{cx:"6",cy:"18",r:"3"}),h("circle",{cx:"18",cy:"16",r:"3"}));
const MicIcon     = ({active})=>h("svg",{width:18,height:18,viewBox:"0 0 24 24",fill:"none",stroke:active?"#ef4444":"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("rect",{x:"9",y:"2",width:"6",height:"11",rx:"3"}),h("path",{d:"M19 10v2a7 7 0 0 1-14 0v-2"}),h("line",{x1:"12",y1:"19",x2:"12",y2:"22"}),h("line",{x1:"8",y1:"22",x2:"16",y2:"22"}));
const CloseIcon   = ()=>h("svg",{width:13,height:13,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2.5,strokeLinecap:"round"},h("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),h("line",{x1:"6",y1:"6",x2:"18",y2:"18"}));
const LogOutIcon  = ()=>h("svg",{width:14,height:14,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}),h("polyline",{points:"16 17 21 12 16 7"}),h("line",{x1:"21",y1:"12",x2:"9",y2:"12"}));
const FileDocIcon = ()=>h("svg",{width:22,height:22,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"}),h("polyline",{points:"14 2 14 8 20 8"}));
const UserIcon    = ()=>h("svg",{width:16,height:16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"}),h("circle",{cx:"12",cy:"7",r:"4"}));
const CameraIcon  = ()=>h("svg",{width:18,height:18,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"}),h("circle",{cx:"12",cy:"13",r:"4"}));
const TrashIcon   = ()=>h("svg",{width:15,height:15,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("polyline",{points:"3 6 5 6 21 6"}),h("path",{d:"M19 6l-1 14H6L5 6"}),h("path",{d:"M10 11v6"}),h("path",{d:"M14 11v6"}),h("path",{d:"M9 6V4h6v2"}));
const CheckIcon   = ()=>h("svg",{width:15,height:15,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round"},h("polyline",{points:"20 6 9 17 4 12"}));
const ArrowLeft   = ()=>h("svg",{width:18,height:18,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("line",{x1:"19",y1:"12",x2:"5",y2:"12"}),h("polyline",{points:"12 19 5 12 12 5"}));
const MoonIcon    = ()=>h("svg",{width:16,height:16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"}));
const SunIcon     = ()=>h("svg",{width:16,height:16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("circle",{cx:"12",cy:"12",r:"5"}),h("line",{x1:"12",y1:"1",x2:"12",y2:"3"}),h("line",{x1:"12",y1:"21",x2:"12",y2:"23"}),h("line",{x1:"4.22",y1:"4.22",x2:"5.64",y2:"5.64"}),h("line",{x1:"18.36",y1:"18.36",x2:"19.78",y2:"19.78"}),h("line",{x1:"1",y1:"12",x2:"3",y2:"12"}),h("line",{x1:"21",y1:"12",x2:"23",y2:"12"}),h("line",{x1:"4.22",y1:"19.78",x2:"5.64",y2:"18.36"}),h("line",{x1:"18.36",y1:"5.64",x2:"19.78",y2:"4.22"}));
const BellIcon    = ()=>h("svg",{width:16,height:16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"}),h("path",{d:"M13.73 21a2 2 0 0 1-3.46 0"}));
const DownloadIcon= ()=>h("svg",{width:14,height:14,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}),h("polyline",{points:"7 10 12 15 17 10"}),h("line",{x1:"12",y1:"15",x2:"12",y2:"3"}));
const EditIcon    = ()=>h("svg",{width:13,height:13,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}),h("path",{d:"M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"}));
const ChatIcon    = ()=>h("svg",{width:20,height:20,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"}));
const SparkIcon   = ()=>h("svg",{width:16,height:16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("polygon",{points:"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"}));
const MoreIcon    = ()=>h("svg",{width:14,height:14,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("circle",{cx:"12",cy:"5",r:"1"}),h("circle",{cx:"12",cy:"12",r:"1"}),h("circle",{cx:"12",cy:"19",r:"1"}));
const ListIcon    = ()=>h("svg",{width:20,height:20,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},h("line",{x1:"8",y1:"6",x2:"21",y2:"6"}),h("line",{x1:"8",y1:"12",x2:"21",y2:"12"}),h("line",{x1:"8",y1:"18",x2:"21",y2:"18"}),h("line",{x1:"3",y1:"6",x2:"3.01",y2:"6"}),h("line",{x1:"3",y1:"12",x2:"3.01",y2:"12"}),h("line",{x1:"3",y1:"18",x2:"3.01",y2:"18"}));

// ─────────────────────────────────────────────────────────────────
// SPLASH SCREEN
// ─────────────────────────────────────────────────────────────────
const SplashScreen = ({ onDone }) => {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t1=setTimeout(()=>setPhase(1),300);
    const t2=setTimeout(()=>setPhase(2),1100);
    const t3=setTimeout(()=>{setPhase(3);setTimeout(onDone,500);},2100);
    return ()=>{clearTimeout(t1);clearTimeout(t2);clearTimeout(t3);};
  }, []);
  return h("div",{className:`splash${phase>=3?' splash-out':''}`},
    h("div",{className:`splash-logo${phase>=1?' visible':''}`},
      h(N9Logo,{size:80}),
      h("div",{className:`splash-text${phase>=2?' visible':''}`},
        h("h1",null,"N9chat Pro"),
        h("p",null,"Intelligence Analytique")
      )
    ),
    h("div",{className:`splash-dots${phase>=2?' visible':''}`},
      h("div",{className:"splash-dot"}),h("div",{className:"splash-dot"}),h("div",{className:"splash-dot"})
    )
  );
};

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
const fileToBase64 = f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f);});
const fmtSize = b=>b<1024?b+' o':b<1048576?(b/1024).toFixed(1)+' Ko':(b/1048576).toFixed(1)+' Mo';
const ACCEPT_IMAGES="image/jpeg,image/png,image/gif,image/webp,image/svg+xml";
const ACCEPT_AUDIO ="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,audio/flac,audio/x-m4a,audio/*";
const ACCEPT_DOCS  =".pdf,.txt,.md,.csv,.json,.py,.js,.ts,.html,.css,.xml";

// ─────────────────────────────────────────────────────────────────
// ATTACHMENT BAR
// ─────────────────────────────────────────────────────────────────
const AttachmentBar = ({attachments,onRemove})=>{
  if(!attachments.length)return null;
  return h("div",{className:"attachment-bar"},
    attachments.map((att,i)=>h("div",{key:i,className:"att-chip"},
      att.type==='image'?h("img",{src:att.dataUrl,className:"att-thumb",alt:att.name}):h("div",{className:`att-icon-box ${att.type}`},att.type==='audio'?h(AudioIcon):h(FileDocIcon)),
      h("div",{className:"att-meta"},h("span",{className:"att-name"},att.name),h("span",{className:"att-size"},fmtSize(att.size))),
      h("button",{className:"att-remove",onClick:()=>onRemove(i)},h(CloseIcon))
    ))
  );
};

// ─────────────────────────────────────────────────────────────────
// MSG ATTACHMENTS
// ─────────────────────────────────────────────────────────────────
const MsgAttachments = ({atts})=>{
  if(!atts||!atts.length)return null;
  return h("div",{className:"msg-atts"},
    atts.map((a,i)=>a.type==='image'&&a.dataUrl
      ?h("img",{key:i,src:a.dataUrl,className:"msg-img",alt:a.name})
      :h("div",{key:i,className:`msg-file-chip ${a.type}`},a.type==='audio'?h(AudioIcon):h(FileDocIcon),h("span",null,a.name))
    )
  );
};

// ─────────────────────────────────────────────────────────────────
// MESSAGE BUBBLE
// ─────────────────────────────────────────────────────────────────
const MessageBubble = ({msg})=>{
  const isSent=msg.type==="sent";
  const ref=useRef(null);
  useEffect(()=>{
    if(!isSent&&ref.current&&window.renderMathInElement)
      renderMathInElement(ref.current,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false});
  },[msg.text]);
  return h("div",{className:`message-row ${isSent?'sent':'received'}`},
    h("div",{className:"message-inner"},
      h("div",{className:`msg-avatar ${isSent?'user':'ai'}`},msg.sender[0].toUpperCase()),
      h("div",{className:"message-content-wrap"},
        h("span",{className:"msg-sender"},msg.sender),
        h("div",{className:`msg-bubble ${isSent?'sent':'received'}`},
          h(MsgAttachments,{atts:msg.attachments}),
          msg.text&&(isSent?h("span",null,msg.text):h("div",{ref,className:"prose-content",dangerouslySetInnerHTML:{__html:marked.parse(msg.text)}}))
        )
      )
    )
  );
};

// ─────────────────────────────────────────────────────────────────
// TYPING INDICATOR
// ─────────────────────────────────────────────────────────────────
const TypingIndicator = ({label})=>h("div",{className:"typing-row"},
  h("div",{className:"typing-dots"},h("div",{className:"typing-dot"}),h("div",{className:"typing-dot"}),h("div",{className:"typing-dot"})),
  label&&h("span",{className:"typing-label"},label)
);

// ─────────────────────────────────────────────────────────────────
// SUGGESTIONS BAR
// ─────────────────────────────────────────────────────────────────
const SuggestionsBar = ({onSelect,hasMessages})=>{
  if(!hasMessages)return null;
  return h("div",{className:"suggestions-bar"},
    QUICK_SUGGESTIONS.map((s,i)=>h("button",{key:i,className:"suggestion-chip",onClick:()=>onSelect(s)},s))
  );
};

// ─────────────────────────────────────────────────────────────────
// THREAD CONTEXT MENU
// ─────────────────────────────────────────────────────────────────
const ThreadMenu = ({onRename,onDelete,onExportTxt,onExportPdf,onClose})=>{
  const ref=useRef(null);
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))onClose();};
    setTimeout(()=>document.addEventListener('click',h),0);
    return ()=>document.removeEventListener('click',h);
  },[]);
  return h("div",{ref,className:"thread-menu"},
    h("button",{className:"tmenu-item",onClick:onRename},h(EditIcon),"Renommer"),
    h("button",{className:"tmenu-item",onClick:onExportTxt},h(DownloadIcon),"Exporter TXT"),
    h("button",{className:"tmenu-item",onClick:onExportPdf},h(DownloadIcon),"Exporter PDF"),
    h("div",{className:"tmenu-sep"}),
    h("button",{className:"tmenu-item danger",onClick:onDelete},h(TrashIcon),"Supprimer")
  );
};

// ─────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────
const LoginScreen = ({onLogin})=>{
  const [name,setName]=useState("");
  const submit=e=>{e.preventDefault();if(name.trim())onLogin(name.trim());};
  return h("div",{className:"login-screen"},
    h("form",{onSubmit:submit,className:"login-card"},
      h(N9Logo,{size:72}),
      h("h1",null,"N9 Intelligence"),
      h("p",{className:"login-subtitle"},"PWA · Android & iOS"),
      h("input",{className:"login-input",type:"text",placeholder:"Identifiant Opérateur",value:name,onChange:e=>setName(e.target.value),required:true,autoFocus:true}),
      h("button",{type:"submit",className:"login-btn"},"Ouvrir la session")
    )
  );
};

// ─────────────────────────────────────────────────────────────────
// PROFILE SCREEN
// ─────────────────────────────────────────────────────────────────
const ProfileScreen = ({profile,onSave,onBack,groqApiKey,onGroqApiKeyChange})=>{
  const [form,setForm]=useState({...profile});
  const [saved,setSaved]=useState(false);
  const avatarRef=useRef(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const pickAvatar=async e=>{const f=e.target.files[0];if(!f)return;set('avatar',await fileToBase64(f));e.target.value='';};
  const handleSave=()=>{onSave(form);setSaved(true);setTimeout(()=>setSaved(false),2000);};
  const deleteWhisper=()=>{const ks=Object.keys(localStorage).filter(k=>k.startsWith('n9_whisper_'));ks.forEach(k=>localStorage.removeItem(k));alert(`${ks.length} transcription(s) Whisper supprimée(s).`);};
  const requestNotif=async()=>{const ok=await requestPushPermission();alert(ok?'✅ Notifications activées !':'❌ Permission refusée.');};
  const initials=(form.pseudo||form.name||'?')[0].toUpperCase();

  return h("div",{className:"profile-screen"},
    h("div",{className:"profile-header"},
      h("button",{className:"profile-back-btn",onClick:onBack},h(ArrowLeft),h("span",null,"Retour")),
      h("h2",{className:"profile-title"},"Mon Profil"),
      h("button",{className:`profile-save-btn ${saved?'saved':''}`,onClick:handleSave},saved?h(CheckIcon):null,saved?"Enregistré":"Sauvegarder")
    ),
    h("div",{className:"profile-body custom-scrollbar"},

      // Avatar
      h("section",{className:"profile-section"},
        h("div",{className:"profile-avatar-wrapper"},
          h("div",{className:"profile-avatar-ring"},
            form.avatar?h("img",{src:form.avatar,className:"profile-avatar-img",alt:"avatar"}):h("div",{className:"profile-avatar-placeholder"},initials)
          ),
          h("div",{className:"profile-avatar-actions"},
            h("button",{className:"profile-avatar-btn",onClick:()=>avatarRef.current?.click()},h(CameraIcon),"Photo"),
            form.avatar&&h("button",{className:"profile-avatar-btn danger",onClick:()=>set('avatar',null)},h(TrashIcon),"Suppr.")
          ),
          h("input",{ref:avatarRef,type:"file",accept:"image/*",style:{display:'none'},onChange:pickAvatar})
        )
      ),

      // Identity
      h("section",{className:"profile-section"},
        h("h3",{className:"profile-section-title"},"Identité"),
        h("div",{className:"profile-field"},h("label",{className:"profile-label"},"Nom complet"),h("input",{className:"profile-input",type:"text",placeholder:"Ex: Jean Dupont",value:form.name,onChange:e=>set('name',e.target.value),maxLength:60})),
        h("div",{className:"profile-field"},h("label",{className:"profile-label"},"Pseudo / Alias"),h("input",{className:"profile-input",type:"text",placeholder:"Ex: JD_Pro",value:form.pseudo,onChange:e=>set('pseudo',e.target.value),maxLength:30}),h("span",{className:"profile-hint"},"Affiché dans les messages")),
        h("div",{className:"profile-field"},h("label",{className:"profile-label"},"Bio / Description"),h("textarea",{className:"profile-textarea",placeholder:"Quelques mots sur vous…",value:form.bio,onChange:e=>set('bio',e.target.value),rows:3,maxLength:200}),h("span",{className:"profile-hint"},`${form.bio.length}/200`))
      ),

      // AI Persona
      h("section",{className:"profile-section"},
        h("h3",{className:"profile-section-title"},"Mode assistant IA"),
        h("div",{className:"persona-grid"},
          AI_PERSONAS.map(p=>h("button",{key:p.id,className:`persona-btn ${form.persona===p.id?'active':''}`,onClick:()=>set('persona',p.id)},
            h("span",{className:"persona-label"},p.label),h("span",{className:"persona-desc"},p.desc)
          ))
        )
      ),

      // Language
      h("section",{className:"profile-section"},
        h("h3",{className:"profile-section-title"},"Langue préférée"),
        h("div",{className:"profile-lang-grid"},
          LANGUAGES.map(lang=>h("button",{key:lang.code,className:`profile-lang-btn ${form.language===lang.code?'active':''}`,onClick:()=>set('language',lang.code)},lang.label))
        )
      ),

      h("section",{className:"profile-section"},
        h("h3",{className:"profile-section-title"},"Intelligence artificielle"),
        h("div",{className:"profile-field"},
          h("label",{className:"profile-label",htmlFor:"groq-api-key"},"Clé API Groq"),
          h("input",{id:"groq-api-key",className:"profile-input",type:"password",autoComplete:"off",spellCheck:false,placeholder:"gsk_…",value:groqApiKey,onChange:e=>onGroqApiKeyChange(e.target.value)}),
          h("span",{className:"profile-hint"},"Votre clé reste en mémoire sur cet appareil jusqu’au rechargement. Elle n’est pas enregistrée dans votre profil. Utilisez uniquement une clé personnelle."),
          h("a",{className:"profile-hint",href:"https://console.groq.com/keys",target:"_blank",rel:"noopener noreferrer"},"Gérer les clés Groq")
        )
      ),

      // Appearance
      h("section",{className:"profile-section"},
        h("h3",{className:"profile-section-title"},"Apparence"),
        h("div",{className:"profile-field toggle-field"},
          h("div",null,h("label",{className:"profile-label"},"Mode sombre"),h("span",{className:"profile-hint"},"Thème nuit")),
          h("button",{className:`toggle-btn ${form.darkMode?'on':''}`,onClick:()=>set('darkMode',!form.darkMode)},h("span",{className:"toggle-knob"},form.darkMode?h(MoonIcon):h(SunIcon)))
        ),
        h("div",{className:"profile-theme-grid",style:{marginTop:'1rem'}},
          THEMES.map(t=>h("button",{key:t.id,className:`profile-theme-swatch ${form.theme===t.id?'active':''}`,onClick:()=>set('theme',t.id),style:{'--swatch-color':t.accent},title:t.label},h("div",{className:"profile-swatch-dot"}),h("span",null,t.label)))
        )
      ),

      // Sounds & Notifs
      h("section",{className:"profile-section"},
        h("h3",{className:"profile-section-title"},"Sons & Notifications"),
        h("div",{className:"profile-field toggle-field"},
          h("div",null,h("label",{className:"profile-label"},"Sons sur réponse"),h("span",{className:"profile-hint"},"Bip doux quand l'IA répond")),
          h("button",{className:`toggle-btn ${form.soundEnabled?'on':''}`,onClick:()=>set('soundEnabled',!form.soundEnabled)},h("span",{className:"toggle-knob"}))
        ),
        h("div",{className:"profile-field toggle-field"},
          h("div",null,h("label",{className:"profile-label"},"Vibration"),h("span",{className:"profile-hint"},"Retour haptique sur mobile")),
          h("button",{className:`toggle-btn ${form.vibrateEnabled?'on':''}`,onClick:()=>set('vibrateEnabled',!form.vibrateEnabled)},h("span",{className:"toggle-knob"}))
        ),
        h("button",{className:"profile-notif-btn",onClick:requestNotif},h(BellIcon),"Activer les notifications push")
      ),

      // Danger
      h("section",{className:"profile-section danger-zone"},
        h("h3",{className:"profile-section-title danger"},"Zone de gestion"),
        h("div",{className:"profile-danger-card"},
          h("div",{className:"profile-danger-info"},h("p",{className:"profile-danger-title"},"Transcriptions Whisper"),h("p",{className:"profile-danger-desc"},"Supprime les transcriptions audio mémorisées localement")),
          h("button",{className:"profile-danger-btn",onClick:deleteWhisper},h(TrashIcon),"Supprimer")
        )
      )
    )
  );
};

// ─────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────
const DEFAULT_THREAD = {
  id:'1', title:'Analyse Principale',
  messages:[{id:0,sender:"N9chat",type:"received",text:
    "Système **N9-PRO Intelligence** opérationnel.\n\n"+
    "📎 **Image / Fichier** → analyse visuelle et documentaire\n"+
    "🎙️ **Micro live** → dictée en temps réel\n"+
    "🎵 **Audio Whisper** → transcription automatique\n"+
    "⚡ **Suggestions** → tap ⭐ pour des questions rapides\n"+
    "🌙 **Mode sombre** → toggle haut à droite\n"+
    "👤 **Profil** → personnalise ton assistant IA, thème et sons"
  }]
};

const App = () => {
  const [showSplash,setShowSplash]     = useState(true);
  const [isLoggedIn,setIsLoggedIn]     = useState(false);
  const [username,setUsername]         = useState("");
  const [profile,setProfile]           = useState(DEFAULT_PROFILE);
  const [groqApiKey,setGroqApiKey]       = useState("");
  const [view,setView]                 = useState('chat');
  const [inputValue,setInputValue]     = useState("");
  const [isTyping,setIsTyping]         = useState(false);
  const [typingLabel,setTypingLabel]   = useState("");
  const [attachments,setAttachments]   = useState([]);
  const [isRecording,setIsRecording]   = useState(false);
  const [micOk,setMicOk]               = useState(false);
  const [showSuggestions,setShowSuggestions] = useState(false);
  const [menuThreadId,setMenuThreadId] = useState(null);
  const [renamingId,setRenamingId]     = useState(null);
  const [renameVal,setRenameVal]       = useState("");
  const [isMobile,setIsMobile]         = useState(window.innerWidth<768);
  const [mobileTab,setMobileTab]       = useState('chat');
  const [threads,setThreads]           = useState([DEFAULT_THREAD]);
  const [currentThreadId,setCurrentThreadId] = useState('1');
  const [isOnline,setIsOnline]         = useState(navigator.onLine);

  const scrollRef=useRef(null), textareaRef=useRef(null), fileInputRef=useRef(null);
  const audioInputRef=useRef(null), recognRef=useRef(null), renameRef=useRef(null);

  const currentThread = threads.find(t=>t.id===currentThreadId)||threads[0];

  // ── Init ──
  useEffect(()=>{
    const savedUser=localStorage.getItem('n9_pro_user');
    const savedProfile=loadProfile();
    const savedThreads=loadThreads();
    if(savedUser){setUsername(savedUser);setIsLoggedIn(true);}
    if(savedProfile){setProfile(savedProfile);applyTheme(savedProfile.theme,savedProfile.darkMode);}
    if(savedThreads&&savedThreads.length){setThreads(savedThreads);setCurrentThreadId(savedThreads[savedThreads.length-1].id);}
    setMicOk(!!(window.SpeechRecognition||window.webkitSpeechRecognition));
    const onResize=()=>setIsMobile(window.innerWidth<768);
    window.addEventListener('resize',onResize);
    const goOnline=()=>setIsOnline(true);
    const goOffline=()=>setIsOnline(false);
    window.addEventListener('online',goOnline);
    window.addEventListener('offline',goOffline);
    return ()=>{window.removeEventListener('resize',onResize);window.removeEventListener('online',goOnline);window.removeEventListener('offline',goOffline);};
  },[]);

  useEffect(()=>{saveThreads(threads);},[threads]);
  useEffect(()=>{if(scrollRef.current)scrollRef.current.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'});},[currentThread.messages,isTyping]);
  useEffect(()=>{if(renamingId&&renameRef.current)renameRef.current.focus();},[renamingId]);

  const addMsg=useCallback((tid,msg)=>{
    setThreads(prev=>prev.map(t=>t.id===tid?{...t,messages:[...t.messages,msg]}:t));
  },[]);

  const handleInputChange=e=>{
    setInputValue(e.target.value);
    const el=e.target;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,140)+'px';
  };
  const resetInput=()=>{setInputValue("");if(textareaRef.current)textareaRef.current.style.height='auto';};

  const processFiles=async(files,forceType=null)=>{
    const items=await Promise.all(Array.from(files).map(async file=>{
      const dataUrl=await fileToBase64(file);
      const type=forceType||(file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':'doc');
      return{name:file.name,size:file.size,type,mimeType:file.type,dataUrl,file};
    }));
    setAttachments(prev=>[...prev,...items]);
  };
  const onFileChange =async e=>{await processFiles(e.target.files);e.target.value='';};
  const onAudioChange=async e=>{await processFiles(e.target.files,'audio');e.target.value='';};
  const removeAtt=i=>setAttachments(prev=>prev.filter((_,idx)=>idx!==i));

  const toggleMic=()=>{
    if(isRecording){recognRef.current?.stop();setIsRecording(false);return;}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR)return alert("Microphone non supporté sur ce navigateur.");
    const rec=new SR();rec.lang=profile.language||'fr-FR';rec.continuous=true;rec.interimResults=true;
    let final=inputValue;
    rec.onresult=e=>{
      let interim='';
      for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)final+=t+' ';else interim=t;}
      setInputValue(final+interim);
      if(textareaRef.current){textareaRef.current.style.height='auto';textareaRef.current.style.height=Math.min(textareaRef.current.scrollHeight,140)+'px';}
    };
    rec.onerror=()=>setIsRecording(false);rec.onend=()=>setIsRecording(false);
    recognRef.current=rec;rec.start();setIsRecording(true);
  };

  const transcribeAudio=async att=>{
    if(!groqApiKey)throw new Error("Ajoutez votre clé Groq dans Mon Profil avant d’utiliser la transcription.");
    const fd=new FormData();
    fd.append('file',att.file,att.name);fd.append('model',WHISPER_MODEL);fd.append('response_format','text');fd.append('language',profile.language||'fr');
    const res=await fetch("https://api.groq.com/openai/v1/audio/transcriptions",{method:"POST",headers:{"Authorization":`Bearer ${groqApiKey}`},body:fd});
    return(await res.text()).trim();
  };

  const buildSysPrompt=name=>{
    const pmap={expert:"Analytique, précis, structuré. Utilise titres, listes et tableaux.",coach:"Motivant et bienveillant. Propose des étapes concrètes.",creative:"Imaginatif et original. Métaphores et exemples vivants.",concise:"Ultra-concis. Maximum 3 phrases. Va à l'essentiel.",socratic:"Guide par des questions ciblées."};
    const persona=AI_PERSONAS.find(p=>p.id===profile.persona)||AI_PERSONAS[0];
    const base=profile.bio?`Tu es N9chat Pro (${persona.label}). Utilisateur: ${name}. Bio: ${profile.bio}. Langue: ${profile.language}.`:`Tu es N9chat Pro (${persona.label}). Utilisateur: ${name}. Langue: ${profile.language}.`;
    return`${base} ${pmap[profile.persona]||''} Utilise Markdown et LaTeX ($...$).`;
  };

  const autoSummarize=async(tid,msgs)=>{
    if(!groqApiKey)return;
    const thread=threads.find(t=>t.id===tid);
    if(!thread||thread.summarized||msgs.length<8)return;
    try{
      const res=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${groqApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:TEXT_MODEL,messages:[{role:"system",content:"Génère un résumé court (2-3 phrases max) de cette conversation."},{role:"user",content:msgs.map(m=>`${m.sender}: ${m.text||''}`).join('\n')}],max_tokens:150})});
      const data=await res.json();
      const summary=data.choices?.[0]?.message?.content;
      if(summary)setThreads(prev=>prev.map(t=>t.id===tid?{...t,summarized:true,summary}:t));
    }catch(e){}
  };

  const handleSend=async(overrideText=null)=>{
    const text=(overrideText!==null?overrideText:inputValue).trim();
    const atts=[...attachments];
    if(!text&&!atts.length)return;
    if(isTyping)return;
    setShowSuggestions(false);
    const tid=currentThreadId;
    const audioAtts=atts.filter(a=>a.type==='audio'),imgAtts=atts.filter(a=>a.type==='image'),docAtts=atts.filter(a=>a.type==='doc');
    const displayName=profile.pseudo||profile.name||username;
    if(profile.soundEnabled)playSendSound();
    addMsg(tid,{id:Date.now(),sender:displayName,type:"sent",text,attachments:atts.map(a=>({name:a.name,size:a.size,type:a.type,dataUrl:a.type==='image'?a.dataUrl:null}))});
    resetInput();setAttachments([]);setIsTyping(true);
    try{
      let fullText=text;
      if(audioAtts.length){setTypingLabel("Transcription audio Whisper…");for(const a of audioAtts){const t=await transcribeAudio(a);fullText+=`\n\n[Transcription – ${a.name}]:\n${t}`;}}
      if(docAtts.length){setTypingLabel("Lecture des fichiers…");for(const d of docAtts){try{const t=await d.file.text();fullText+=`\n\n**Fichier : ${d.name}**\n\`\`\`\n${t.slice(0,8000)}\n\`\`\``;}catch{fullText+=`\n\n[Fichier binaire : ${d.name}]`;}}}
      const useVision=imgAtts.length>0;
      setTypingLabel(useVision?"Analyse visuelle…":"");
      const userContent=[];
      imgAtts.forEach(img=>userContent.push({type:"image_url",image_url:{url:img.dataUrl}}));
      if(fullText)userContent.push({type:"text",text:fullText});
      const history=currentThread.messages.slice(-8).map(m=>({role:m.type==='sent'?'user':'assistant',content:m.text||''}));
      const finalContent=userContent.length===1&&userContent[0].type==='text'?userContent[0].text:userContent;
      // Vérifie la connexion avant l'appel API
      if(!navigator.onLine){
        addMsg(tid,{id:Date.now()+1,sender:"N9chat",type:"received",text:"📵 **Mode hors ligne**\n\nL'application fonctionne sans connexion, mais les réponses IA nécessitent internet.\n\nVos conversations et messages sont conservés localement. Reconnectez-vous pour continuer à chatter."});
        return;
      }
      if(!groqApiKey)throw new Error("Ajoutez votre clé Groq dans Mon Profil avant d’utiliser l’IA.");
      const res=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${groqApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:useVision?VISION_MODEL:TEXT_MODEL,messages:[{role:"system",content:buildSysPrompt(displayName)},...history,{role:"user",content:finalContent}],temperature:0.6,max_tokens:2048})});
      const data=await res.json();
      // Le SW renvoie un JSON d'erreur si hors ligne
      if(data.error){
        addMsg(tid,{id:Date.now()+1,sender:"N9chat",type:"received",text:`📵 **Mode hors ligne**\n\n${data.message||"Connexion requise pour les réponses IA."}\n\nVos conversations sont sauvegardées localement.`});
        return;
      }
      const reply=data.choices?.[0]?.message?.content||"Aucune réponse reçue.";
      addMsg(tid,{id:Date.now()+1,sender:"N9chat",type:"received",text:reply});
      if(profile.soundEnabled)playReceiveSound();
      if(profile.vibrateEnabled)vibrateDevice([20,10,20]);
      sendPushNotification("N9chat Pro",reply.slice(0,80)+(reply.length>80?'…':''));
      const updMsgs=[...currentThread.messages,{type:'sent',text},{type:'received',text:reply}];
      autoSummarize(tid,updMsgs);
    }catch(err){
      const offline=!navigator.onLine||err.message==='Failed to fetch';
      addMsg(tid,{id:Date.now(),sender:"N9chat",type:"received",text:offline?"📵 **Mode hors ligne**\n\nL'application est installée et fonctionne localement.\nVos conversations sont sauvegardées. Reconnectez-vous pour les réponses IA.":`⚠️ Erreur : ${err.message||"connexion impossible."}`});
    }finally{setIsTyping(false);setTypingLabel("");}
  };

  const handleKeyDown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}};

  // Thread ops
  const newThread=()=>{
    const id=Date.now().toString();
    setThreads(prev=>[...prev,{id,title:`Session ${prev.length+1}`,messages:[{id:0,sender:"N9chat",type:"received",text:"Nouvelle session. Envoyez un message, une image, un fichier ou un audio."}]}]);
    setCurrentThreadId(id);
    if(isMobile)setMobileTab('chat');
  };
  const deleteThread=id=>{
    setThreads(prev=>{const next=prev.filter(t=>t.id!==id);return next.length?next:[DEFAULT_THREAD];});
    setCurrentThreadId(prev=>prev===id?threads.find(t=>t.id!==id)?.id||'1':prev);
    setMenuThreadId(null);
  };
  const startRename=t=>{setRenamingId(t.id);setRenameVal(t.title);setMenuThreadId(null);};
  const commitRename=()=>{
    if(renameVal.trim())setThreads(prev=>prev.map(t=>t.id===renamingId?{...t,title:renameVal.trim()}:t));
    setRenamingId(null);
  };

  const handleLogin=name=>{
    localStorage.setItem('n9_pro_user',name);setUsername(name);
    const existing=loadProfile();
    if(!existing||!existing.pseudo){const p={...DEFAULT_PROFILE,pseudo:name};saveProfile(p);setProfile(p);}
    else{applyTheme(existing.theme,existing.darkMode);}
    setIsLoggedIn(true);
  };
  const handleLogout=()=>{localStorage.clear();location.reload();};
  const handleProfileSave=np=>{saveProfile(np);setProfile(np);applyTheme(np.theme,np.darkMode);};

  const canSend=!isTyping&&(inputValue.trim().length>0||attachments.length>0);
  const displayName=profile.pseudo||profile.name||username;
  const avatarSrc=profile.avatar;

  if(showSplash)return h(SplashScreen,{onDone:()=>setShowSplash(false)});
  if(!isLoggedIn)return h(LoginScreen,{onLogin:handleLogin});
  if(view==='profile')return h(ProfileScreen,{profile,onSave:handleProfileSave,onBack:()=>setView('chat'),groqApiKey,onGroqApiKeyChange:setGroqApiKey});

  // ── Inline thread list (not a sub-component to avoid remount) ──
  const threadListJSX = h("div",{className:"threads-list custom-scrollbar"},
    h("button",{className:"new-thread-btn",onClick:newThread},"+ Nouvelle session"),
    currentThread.summary&&h("div",{className:"thread-summary-card"},
      h("div",{className:"tsummary-label"},h(SparkIcon)," Résumé IA"),
      h("p",{className:"tsummary-text"},currentThread.summary)
    ),
    threads.map(t=>h("div",{key:t.id,className:`thread-item ${t.id===currentThreadId?'active':''}`,style:{position:'relative'}},
      renamingId===t.id
        ?h("input",{ref:renameRef,className:"thread-rename-input",value:renameVal,onChange:e=>setRenameVal(e.target.value),onKeyDown:e=>{if(e.key==='Enter')commitRename();if(e.key==='Escape')setRenamingId(null);},onBlur:commitRename})
        :h("span",{className:"thread-title",onClick:()=>{setCurrentThreadId(t.id);if(isMobile)setMobileTab('chat');}},h("span",{className:"thread-dot"}),t.title),
      h("button",{className:"thread-more-btn",onClick:e=>{e.stopPropagation();setMenuThreadId(menuThreadId===t.id?null:t.id);}},h(MoreIcon)),
      menuThreadId===t.id&&h(ThreadMenu,{onRename:()=>startRename(t),onDelete:()=>deleteThread(t.id),onExportTxt:()=>{exportTxt(t);setMenuThreadId(null);},onExportPdf:()=>{exportPdf(t);setMenuThreadId(null);},onClose:()=>setMenuThreadId(null)})
    ))
  );

  // ── Inline input zone (not a sub-component — prevents focus loss on every keystroke) ──
  const inputZoneJSX = h("div",{className:"input-bar-wrapper"},
    h(AttachmentBar,{attachments,onRemove:removeAtt}),
    showSuggestions&&h(SuggestionsBar,{hasMessages:currentThread.messages.length>1,onSelect:s=>{setShowSuggestions(false);handleSend(s);}}),
    h("div",{className:"input-bar"},
      h("div",{className:"input-toolbar"},
        h("button",{className:"toolbar-btn",title:"Image ou fichier",onClick:()=>fileInputRef.current?.click()},h(UploadIcon)),
        h("input",{ref:fileInputRef,type:"file",style:{display:'none'},accept:`${ACCEPT_IMAGES},${ACCEPT_DOCS}`,multiple:true,onChange:onFileChange}),
        h("button",{className:"toolbar-btn",title:"Fichier audio (Whisper)",onClick:()=>audioInputRef.current?.click()},h(AudioIcon)),
        h("input",{ref:audioInputRef,type:"file",style:{display:'none'},accept:ACCEPT_AUDIO,multiple:true,onChange:onAudioChange}),
        h("button",{className:`toolbar-btn ${showSuggestions?'active':''}`,title:"Suggestions rapides",onClick:()=>setShowSuggestions(s=>!s)},h(SparkIcon)),
        h("div",{className:"toolbar-sep"}),
        micOk&&h("button",{className:`toolbar-btn${isRecording?' mic-active':''}`,title:isRecording?"Arrêter":"Micro live",onClick:toggleMic},h(MicIcon,{active:isRecording}),isRecording&&h("span",{className:"rec-dot"}))
      ),
      h("textarea",{ref:textareaRef,className:"main-textarea",rows:1,placeholder:attachments.length?"Ajoutez un message ou envoyez…":"Message, image, fichier ou audio…",value:inputValue,onChange:handleInputChange,onKeyDown:handleKeyDown}),
      h("button",{className:"send-btn",onClick:()=>handleSend(),disabled:!canSend},h(SendIcon))
    ),
    h("div",{className:"input-hint"},
      h("span",null,"📎 Fichiers"),h("span",null,"🎵 Whisper"),
      micOk&&h("span",null,"🎙️ Live"),
      h("span",null,"⭐ Suggestions"),h("span",null,"⏎ Envoyer")
    )
  );

  // ── Inline header right (not a sub-component) ──
  const headerRightJSX = h("div",{style:{display:'flex',alignItems:'center',gap:'0.5rem'}},
    !isOnline&&h("span",{className:"offline-badge"},"📵 Hors ligne"),
    h("button",{className:"header-icon-btn",title:profile.darkMode?"Mode clair":"Mode sombre",onClick:()=>{const np={...profile,darkMode:!profile.darkMode};handleProfileSave(np);}},profile.darkMode?h(SunIcon):h(MoonIcon)),
    h("span",{style:{fontSize:'0.72rem',fontWeight:700,color:'var(--text-secondary)'},className:"desktop-only"},displayName),
    h("button",{className:"avatar avatar-btn",onClick:()=>setView('profile'),title:"Mon profil"},avatarSrc?h("img",{src:avatarSrc,className:"avatar-img",alt:"avatar"}):displayName[0]?.toUpperCase())
  );

  // ── MOBILE ────────────────────────────────────────────────────
  if(isMobile){
    return h("div",{className:"app-layout mobile"},
      h("header",{className:"app-header"},
        h("div",{className:"header-status"},
          h("div",{className:`status-dot${isOnline?'':' offline'}`}),
          h("span",{style:{color:isOnline?'var(--mint)':'#f59e0b'}},isOnline?currentThread.title:"Hors ligne")
        ),
        headerRightJSX
      ),
      h("div",{className:"mobile-content"},
        mobileTab==='chat'&&h("div",{className:"main-content"},
          h("div",{ref:scrollRef,className:"messages-area custom-scrollbar"},
            currentThread.messages.map(m=>h(MessageBubble,{key:m.id,msg:m})),
            isTyping&&h(TypingIndicator,{label:typingLabel})
          ),
          inputZoneJSX
        ),
        mobileTab==='sessions'&&h("div",{className:"mobile-sessions"},threadListJSX)
      ),
      h("nav",{className:"bottom-nav"},
        h("button",{className:`bottom-nav-item ${mobileTab==='chat'?'active':''}`,onClick:()=>setMobileTab('chat')},h(ChatIcon),h("span",null,"Chat")),
        h("button",{className:`bottom-nav-item ${mobileTab==='sessions'?'active':''}`,onClick:()=>setMobileTab('sessions')},h(ListIcon),h("span",null,"Sessions")),
        h("button",{className:"bottom-nav-item",onClick:()=>setView('profile')},avatarSrc?h("img",{src:avatarSrc,style:{width:22,height:22,borderRadius:'50%',objectFit:'cover'},alt:"p"}):h(UserIcon),h("span",null,"Profil")),
        h("button",{className:"bottom-nav-item",onClick:handleLogout},h(LogOutIcon),h("span",null,"Quitter"))
      )
    );
  }

  // ── DESKTOP ───────────────────────────────────────────────────
  return h("div",{className:"app-layout"},
    h("aside",{className:"sidebar"},
      h("div",{className:"sidebar-logo"},h(N9Logo,{size:36}),h("div",{className:"sidebar-logo-text"},h("p",null,"N9chat Pro"),h("p",null,"Android / iOS"))),
      threadListJSX,
      h("button",{className:"sidebar-profile-btn",onClick:()=>setView('profile')},
        avatarSrc?h("img",{src:avatarSrc,className:"sidebar-profile-avatar",alt:"avatar"}):h("div",{className:"sidebar-profile-initials"},displayName[0]?.toUpperCase()),
        h("div",{className:"sidebar-profile-info"},h("span",{className:"sidebar-profile-name"},displayName),h("span",{className:"sidebar-profile-sub"},"Voir le profil")),
        h(UserIcon)
      ),
      h("button",{className:"sidebar-logout",onClick:handleLogout},h(LogOutIcon),"Quitter")
    ),
    h("main",{className:"main-content"},
      h("header",{className:"app-header"},
        h("div",{className:"header-status"},
          h("div",{className:`status-dot${isOnline?'':' offline'}`}),
          h("span",{style:{color:isOnline?'var(--mint)':'#f59e0b'}},isOnline?"Système synchronisé":"Hors ligne — conversations locales")
        ),
        headerRightJSX
      ),
      h("div",{ref:scrollRef,className:"messages-area custom-scrollbar"},
        currentThread.messages.map(m=>h(MessageBubble,{key:m.id,msg:m})),
        isTyping&&h(TypingIndicator,{label:typingLabel})
      ),
      inputZoneJSX
    )
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
