import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './storage.js'; // Expose window.storage → fonction Netlify
import {
  Search, ExternalLink, RefreshCw, Loader2, X,
  ChevronLeft, ChevronRight, ChevronDown, Upload, Download, Trash2,
  Settings as SettingsIcon, AlertCircle, Sparkles, ImageIcon
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar
} from 'recharts';

// ============================================================
//  CONFIG
// ============================================================
const STATUSES = {
  rien:                 { label: 'À faire',            color: '#52525b' },
  tourne:               { label: 'Tourné',             color: '#00D4FF' },
  en_attente_montage:   { label: 'Attente montage',    color: '#FF8C42' },
  monte:                { label: 'Monté',              color: '#FFD700' },
  en_attente_miniature: { label: 'Attente miniature',  color: '#FFA500' },
  publie:               { label: 'Publié',             color: '#4ADE80' },
};
const RELEASE_DAYS = [1, 3, 5];
const DAY_SHORT = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const DAY_FULL = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const START_DATE = new Date(2026, 4, 1);
const DEFAULT_END = new Date(2027, 0, 31);

const C = {
  bg:      '#09090b',
  bg2:     '#0e0e11',
  line:    '#1f1f22',
  lineH:   '#2a2a2e',
  text:    '#f4f4f5',
  muted:   '#a1a1aa',
  muted2:  '#52525b',
  muted3:  '#3f3f46',
  yellow:  '#FFD700',
  cyan:    '#00D4FF',
};

// ============================================================
//  UTILS
// ============================================================
const toISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fromISO = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };

function generateSlots(start, end) {
  const slots = [];
  const d = new Date(start); d.setHours(0,0,0,0);
  while (d <= end) {
    if (RELEASE_DAYS.includes(d.getDay())) {
      const iso = toISO(d);
      slots.push({
        id: `vid_${iso}`, date: iso, title: '', status: 'rien',
        rushLink: '', finalLink: '', notes: '',
        views: 0, likes: 0, comments: 0, duration: '',
        youtubeTitle: '', publishedAt: null,
        youtubeId: '', lastViewUpdate: null,
        hasThumbnail: false,
        telegramPosted: false,
      });
    }
    d.setDate(d.getDate() + 1);
  }
  return slots;
}

const extractYoutubeId = url => {
  if (!url) return '';
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : '';
};

function formatNumber(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return (n/1e6).toFixed(1).replace('.0','')+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace('.0','')+'k';
  return String(n);
}

function formatDate(iso) {
  const d = fromISO(iso);
  return `${DAY_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()].slice(0,3).toLowerCase()}`;
}

// Parse ISO 8601 duration (PT1H2M3S -> "1:02:03", PT2M5S -> "2:05")
function parseDuration(iso) {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = parseInt(m[1]||'0', 10);
  const mm = parseInt(m[2]||'0', 10);
  const ss = parseInt(m[3]||'0', 10);
  if (h > 0) return `${h}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${mm}:${String(ss).padStart(2,'0')}`;
}

async function fetchYoutubeData(ids, apiKey) {
  if (!ids.length || !apiKey) return { results:{}, error:null };
  const results = {};
  try {
    for (let i=0; i<ids.length; i+=50) {
      const chunk = ids.slice(i, i+50);
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=${chunk.join(',')}&key=${apiKey}`);
      const data = await res.json();
      if (data.error) return { results, error: data.error.message };
      for (const it of (data.items || [])) {
        const st = it.statistics || {};
        const sn = it.snippet || {};
        const cd = it.contentDetails || {};
        const thumbs = sn.thumbnails || {};
        const thumbUrl = (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {}).url || '';
        results[it.id] = {
          views: parseInt(st.viewCount||'0', 10),
          likes: parseInt(st.likeCount||'0', 10),
          comments: parseInt(st.commentCount||'0', 10),
          duration: parseDuration(cd.duration),
          youtubeTitle: sn.title || '',
          publishedAt: sn.publishedAt || null,
          thumbUrl,
        };
      }
    }
    return { results, error:null };
  } catch (e) { return { results, error: e.message }; }
}

// Fetch a YouTube thumbnail and convert to dataURL
async function fetchYoutubeThumbAsDataURL(videoId, preferredUrl) {
  const urls = preferredUrl
    ? [preferredUrl, `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`]
    : [`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size < 1000) continue; // empty placeholder
      // Compress
      const dataURL = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            const maxW = 1280;
            if (width > maxW) { height = Math.round(height * maxW / width); width = maxW; }
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return dataURL;
    } catch {}
  }
  return null;
}

// Compress image to reasonable size for storage
async function compressImage(file, maxWidth = 1280) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error("Impossible de lire l'image"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Lecture fichier échouée'));
    reader.readAsDataURL(file);
  });
}

const thumbKey = id => `binova:thumb:${id}`;

// ============================================================
//  LOGO
// ============================================================
function BinovaLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display:'block' }}>
      <defs>
        <linearGradient id="bl-cyan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#00D4FF" />
        </linearGradient>
        <linearGradient id="bl-yellow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <filter id="bl-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* Cyan candle — outline with light interior */}
      <g>
        <rect x="11.5" y="1.5" width="1" height="6" rx="0.5" fill="#00D4FF" opacity="0.7" />
        <rect x="11.5" y="32.5" width="1" height="6" rx="0.5" fill="#00D4FF" opacity="0.7" />
        <rect x="7" y="8" width="10" height="24" rx="3.5" fill="#00D4FF" filter="url(#bl-glow)" opacity="0.35" />
        <rect x="7.5" y="8.5" width="9" height="23" rx="3" fill="#e0f7ff" opacity="0.15" />
        <rect x="7.5" y="8.5" width="9" height="23" rx="3" stroke="url(#bl-cyan)" strokeWidth="1.3" fill="none" />
      </g>

      {/* Yellow candle — solid */}
      <g>
        <rect x="26.5" y="3.5" width="1" height="5" rx="0.5" fill="#FFD700" opacity="0.7" />
        <rect x="26.5" y="30.5" width="1" height="5" rx="0.5" fill="#FFD700" opacity="0.7" />
        <rect x="22" y="9" width="10" height="22" rx="3.5" fill="#FFD700" filter="url(#bl-glow)" opacity="0.35" />
        <rect x="22.5" y="9.5" width="9" height="21" rx="3" fill="url(#bl-yellow)" />
      </g>
    </svg>
  );
}

// ============================================================
//  APP
// ============================================================
export default function BinovaPlanner() {
  const [videos, setVideos] = useState([]);
  const [view, setView] = useState('planning');
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({ ytApiKey:'', autoRefresh:false });
  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [thumbs, setThumbs] = useState({}); // { videoId: dataURL }
  const [shorts, setShorts] = useState({}); // { '2026-07': [...30 shorts] }

  // Fonts
  useEffect(() => {
    if (document.getElementById('binova-fonts')) return;
    const link = document.createElement('link');
    link.id = 'binova-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }, []);

  // Load videos + settings + shorts
  useEffect(() => {
    (async () => {
      try {
        let v = null, s = null, sh = null;
        try { v = await window.storage.get('binova:videos'); } catch {}
        try { s = await window.storage.get('binova:settings'); } catch {}
        try { sh = await window.storage.get('binova:shorts'); } catch {}
        if (v?.value) setVideos(JSON.parse(v.value));
        else setVideos(generateSlots(START_DATE, DEFAULT_END));
        if (s?.value) setSettings(JSON.parse(s.value));
        if (sh?.value) setShorts(JSON.parse(sh.value));
      } catch (e) {
        setVideos(generateSlots(START_DATE, DEFAULT_END));
      }
      setLoading(false);
    })();
  }, []);

  // Persist shorts (debounced)
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      try { window.storage.set('binova:shorts', JSON.stringify(shorts)); } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [shorts, loading]);

  // Load thumbnails (once, lazy)
  useEffect(() => {
    if (loading) return;
    const toLoad = videos.filter(v => v.hasThumbnail && !thumbs[v.id]);
    if (!toLoad.length) return;
    let cancelled = false;
    (async () => {
      const batch = {};
      for (const v of toLoad) {
        try {
          const r = await window.storage.get(thumbKey(v.id));
          if (r?.value) batch[v.id] = r.value;
        } catch {}
      }
      if (!cancelled && Object.keys(batch).length) {
        setThumbs(t => ({ ...t, ...batch }));
      }
    })();
    return () => { cancelled = true; };
  }, [loading, videos]);

  // Persist videos (debounced)
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      try { window.storage.set('binova:videos', JSON.stringify(videos)); } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [videos, loading]);

  useEffect(() => {
    if (loading) return;
    try { window.storage.set('binova:settings', JSON.stringify(settings)); } catch {}
  }, [settings, loading]);

  const updateVideo = useCallback((id, patch) => {
    setVideos(prev => prev.map(v => {
      if (v.id !== id) return v;
      const next = { ...v, ...patch };
      if ('finalLink' in patch) next.youtubeId = extractYoutubeId(patch.finalLink);
      return next;
    }));
  }, []);

  const updateShort = useCallback((monthKey, index, patch) => {
    setShorts(prev => {
      const monthShorts = prev[monthKey] || generateMonthShorts(monthKey);
      const next = monthShorts.map((s, i) => i === index ? { ...s, ...patch } : s);
      return { ...prev, [monthKey]: next };
    });
  }, []);

  const setVideoThumbnail = useCallback(async (videoId, dataURL) => {
    try {
      if (dataURL) {
        await window.storage.set(thumbKey(videoId), dataURL);
        setThumbs(t => ({ ...t, [videoId]: dataURL }));
        setVideos(prev => prev.map(v => v.id === videoId ? { ...v, hasThumbnail: true } : v));
      } else {
        try { await window.storage.delete(thumbKey(videoId)); } catch {}
        setThumbs(t => { const n = { ...t }; delete n[videoId]; return n; });
        setVideos(prev => prev.map(v => v.id === videoId ? { ...v, hasThumbnail: false } : v));
      }
    } catch (e) {
      setToast({ type:'err', text:'Miniature trop lourde (max ~5MB)' });
      setTimeout(() => setToast(null), 3500);
    }
  }, []);

  const syncViews = useCallback(async () => {
    if (!settings.ytApiKey) {
      setToast({ type:'err', text:'Ajoute ta clé API YouTube dans les paramètres' });
      setTimeout(() => setToast(null), 3500);
      return;
    }
    const toSync = videos.filter(v => v.status === 'publie' && v.youtubeId);
    if (!toSync.length) {
      setToast({ type:'info', text:'Aucune vidéo publiée avec un lien YouTube valide' });
      setTimeout(() => setToast(null), 3500);
      return;
    }
    setSyncing(true);
    const { results, error } = await fetchYoutubeData(toSync.map(v => v.youtubeId), settings.ytApiKey);
    if (error) {
      setSyncing(false);
      setToast({ type:'err', text:`Erreur YouTube : ${error}` });
      setTimeout(() => setToast(null), 5000);
      return;
    }
    const now = new Date().toISOString();
    setVideos(prev => prev.map(v => {
      if (v.youtubeId && results[v.youtubeId]) {
        const r = results[v.youtubeId];
        return {
          ...v,
          views: r.views, likes: r.likes, comments: r.comments,
          duration: r.duration, youtubeTitle: r.youtubeTitle,
          publishedAt: r.publishedAt, lastViewUpdate: now,
        };
      }
      return v;
    }));
    // Auto-import thumbnails for videos that don't have one
    const toFetchThumbs = toSync.filter(v => !v.hasThumbnail && results[v.youtubeId]);
    if (toFetchThumbs.length) {
      setToast({ type:'info', text:`Récupération des miniatures (${toFetchThumbs.length})…` });
      for (const v of toFetchThumbs) {
        const thumbUrl = results[v.youtubeId].thumbUrl;
        const dataURL = await fetchYoutubeThumbAsDataURL(v.youtubeId, thumbUrl);
        if (dataURL) {
          try {
            await window.storage.set(thumbKey(v.id), dataURL);
            setThumbs(t => ({ ...t, [v.id]: dataURL }));
            setVideos(prev => prev.map(x => x.id === v.id ? { ...x, hasThumbnail: true } : x));
          } catch {}
        }
      }
    }
    setSyncing(false);
    setLastSync(new Date());
    setToast({ type:'ok', text:`${Object.keys(results).length} vidéos synchronisées` });
    setTimeout(() => setToast(null), 3000);
  }, [settings.ytApiKey, videos]);

  useEffect(() => {
    if (!settings.autoRefresh || !settings.ytApiKey) return;
    const i = setInterval(syncViews, 5*60*1000);
    return () => clearInterval(i);
  }, [settings.autoRefresh, settings.ytApiKey, syncViews]);

  if (loading) return (
    <div style={{ background:C.bg, minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:C.yellow }}>
      <Loader2 size={22} className="animate-spin" />
    </div>
  );

  return (
    <div style={{
      background:C.bg, minHeight:'100vh', color:C.text,
      fontFamily:"'Archivo', system-ui, sans-serif",
      backgroundImage: `
        radial-gradient(ellipse 600px 400px at 0% 0%, rgba(255, 215, 0, 0.018) 0%, transparent 100%),
        radial-gradient(ellipse 600px 400px at 100% 100%, rgba(0, 212, 255, 0.015) 0%, transparent 100%)
      `,
    }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin:0; }
        .mono { font-family:'JetBrains Mono', monospace; font-feature-settings:'tnum'; }
        input, textarea, select, button { outline:none; font-family:inherit; }
        input:focus, textarea:focus, select:focus { border-color:${C.muted3} !important; }
        ::selection { background:${C.yellow}; color:#000; }
        .scroll::-webkit-scrollbar { width:6px; height:6px; }
        .scroll::-webkit-scrollbar-track { background:transparent; }
        .scroll::-webkit-scrollbar-thumb { background:${C.line}; border-radius:3px; }
        .scroll::-webkit-scrollbar-thumb:hover { background:${C.lineH}; }
        .row { transition: background 0.1s ease; }
        .row:hover { background:#111113; }
        .btn-primary { transition: all 0.15s ease; box-shadow: 0 1px 0 rgba(255,255,255,0.1) inset, 0 1px 6px rgba(255,215,0,0.2); }
        .btn-primary:hover:not(:disabled) { background:#ffdf1a !important; box-shadow: 0 1px 0 rgba(255,255,255,0.15) inset, 0 2px 12px rgba(255,215,0,0.35); transform: translateY(-0.5px); }
        .btn-ghost { transition: all 0.12s ease; }
        .btn-ghost:hover:not(:disabled) { border-color:${C.lineH} !important; color:${C.text} !important; }
        .tab-active::after { content:''; position:absolute; left:0; right:0; bottom:-19px; height:1.5px; background:${C.yellow}; border-radius:1px; }
        @keyframes fade-in { from { opacity:0; transform:translateY(2px); } to { opacity:1; transform:none; } }
        .fade-in { animation: fade-in 0.25s ease; }
      `}</style>

      <Header view={view} setView={setView} onSync={syncViews} syncing={syncing}
              lastSync={lastSync} onSettings={() => setShowSettings(true)}
              hasKey={!!settings.ytApiKey} />

      {toast && (
        <div className="fade-in" style={{
          position:'fixed', bottom:20, right:20, zIndex:80,
          padding:'10px 14px', borderRadius:8, fontSize:13,
          background:C.bg2,
          border:`1px solid ${toast.type==='err' ? '#7f1d1d' : toast.type==='ok' ? '#166534' : C.line}`,
          color: toast.type==='err' ? '#fca5a5' : toast.type==='ok' ? '#86efac' : C.text,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {toast.text}
        </div>
      )}

      <main style={{ maxWidth:1400, margin:'0 auto', padding:'48px 40px 80px' }}>
        {view === 'planning' && <PlanningView videos={videos} updateVideo={updateVideo} thumbs={thumbs} setVideoThumbnail={setVideoThumbnail} />}
        {view === 'shorts' && <ShortsView shorts={shorts} updateShort={updateShort} />}
        {view === 'calendar' && <CalendarView videos={videos} updateVideo={updateVideo} thumbs={thumbs} setVideoThumbnail={setVideoThumbnail} />}
        {view === 'analytics' && <AnalyticsView videos={videos} />}
      </main>

      {showSettings && (
        <Settings settings={settings} setSettings={setSettings}
                  onClose={() => setShowSettings(false)}
                  videos={videos} setVideos={setVideos} />
      )}
    </div>
  );
}

// ============================================================
//  HEADER
// ============================================================
function Header({ view, setView, onSync, syncing, lastSync, onSettings, hasKey }) {
  const tabs = [
    { id:'planning',  label:'Planning' },
    { id:'shorts',    label:'Shorts' },
    { id:'calendar',  label:'Calendrier' },
    { id:'analytics', label:'Analytics' },
  ];

  return (
    <header style={{
      borderBottom:`1px solid ${C.line}`,
      background:`${C.bg}dd`,
      backdropFilter:'blur(8px)',
      position:'sticky', top:0, zIndex:40,
    }}>
      <div style={{
        maxWidth:1400, margin:'0 auto', padding:'16px 40px',
        display:'flex', alignItems:'center', gap:40,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:11 }}>
          <BinovaLogo size={30} />
          <div style={{ lineHeight:1 }}>
            <div style={{ fontSize:16, fontWeight:700, letterSpacing:'-0.015em' }}>
              Binova<span style={{ color:C.yellow }}>.</span>
            </div>
            <div style={{ fontSize:9.5, color:C.muted2, letterSpacing:'0.18em', textTransform:'uppercase', marginTop:3 }}>
              Studio
            </div>
          </div>
        </div>

        <nav style={{ display:'flex', gap:28 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={view===t.id ? 'tab-active' : ''}
              style={{
                padding:'4px 0', background:'none', border:'none',
                color: view===t.id ? C.text : C.muted,
                fontSize:14, fontWeight: view===t.id ? 500 : 400,
                cursor:'pointer', position:'relative',
                transition: 'color 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
          <button
            className="btn-ghost"
            onClick={onSync}
            disabled={syncing || !hasKey}
            title={hasKey ? 'Synchroniser les vues' : 'Configure ta clé API YouTube'}
            style={{
              display:'flex', alignItems:'center', gap:7,
              padding:'7px 11px', background:'transparent',
              border:`1px solid ${C.line}`, borderRadius:7,
              color: hasKey ? C.text : C.muted2,
              fontSize:12, fontWeight:500, cursor: hasKey ? 'pointer' : 'not-allowed',
              opacity: syncing ? 0.5 : 1,
            }}
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Sync
            {lastSync && !syncing && (
              <span className="mono" style={{ fontSize:10, color:C.muted2 }}>
                {new Date(lastSync).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })}
              </span>
            )}
          </button>
          <button className="btn-ghost" onClick={onSettings} style={{
            padding:7, background:'transparent', border:`1px solid ${C.line}`,
            borderRadius:7, color:C.muted, cursor:'pointer', display:'flex',
          }}>
            <SettingsIcon size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}

// ============================================================
//  THUMBNAIL COMPONENTS
// ============================================================
function ThumbnailMini({ src, size = 'sm' }) {
  const dims = size === 'sm' ? { w:48, h:27 } : { w:64, h:36 };
  if (!src) {
    return (
      <div style={{
        width:dims.w, height:dims.h, borderRadius:4,
        border:`1px dashed ${C.line}`, background:C.bg2,
        display:'flex', alignItems:'center', justifyContent:'center',
        color:C.muted3,
      }}>
        <ImageIcon size={11} />
      </div>
    );
  }
  return (
    <img src={src} alt="" style={{
      width:dims.w, height:dims.h, borderRadius:4, objectFit:'cover',
      border:`1px solid ${C.line}`, display:'block',
    }} />
  );
}

function ThumbnailDropZone({ videoId, src, onChange, videoTitle, youtubeId }) {
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const dragCounter = useRef(0);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError("Ce fichier n'est pas une image");
      setTimeout(() => setError(null), 3000);
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      await onChange(compressed);
    } catch (e) {
      setError(e.message || 'Erreur');
      setTimeout(() => setError(null), 3000);
    }
    setProcessing(false);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer?.items?.length > 0) setDragOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    dragCounter.current = 0;
    const file = e.dataTransfer?.files?.[0];
    handleFile(file);
  };

  const onDownload = () => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    const safeName = (videoTitle || videoId).replace(/[^a-z0-9àâäéèêëïîôöùûüç_-]/gi, '_').slice(0, 40);
    a.download = `${safeName}_miniature.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const onRemove = async () => { await onChange(null); };

  const importFromYouTube = async () => {
    if (!youtubeId) return;
    setProcessing(true);
    setError(null);
    try {
      const dataURL = await fetchYoutubeThumbAsDataURL(youtubeId);
      if (dataURL) await onChange(dataURL);
      else setError('Miniature introuvable sur YouTube');
    } catch (e) {
      setError('Échec de la récupération');
    }
    setProcessing(false);
  };

  if (src) {
    return (
      <div>
        <div style={{
          position:'relative', width:'100%', aspectRatio:'16/9',
          borderRadius:8, overflow:'hidden',
          border:`1px solid ${C.line}`,
          background:C.bg2,
        }}>
          <img src={src} alt="Miniature" style={{
            width:'100%', height:'100%', objectFit:'cover', display:'block',
          }} />
          <div style={{
            position:'absolute', inset:0,
            background:'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.7) 100%)',
            display:'flex', alignItems:'flex-end', justifyContent:'flex-end',
            padding:8, gap:6, opacity:0, transition:'opacity 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = 1}
          onMouseLeave={e => e.currentTarget.style.opacity = 0}>
            <button onClick={onDownload} title="Télécharger" style={thumbActionBtn()}>
              <Download size={13} />
            </button>
            <button onClick={onRemove} title="Supprimer" style={{ ...thumbActionBtn(), color:'#fca5a5' }}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          style={{
            marginTop:8, fontSize:11, color:C.muted, background:'none', border:'none',
            cursor:'pointer', padding:0, textDecoration:'underline',
          }}>
          Remplacer
        </button>
        <input ref={inputRef} type="file" accept="image/*" style={{ display:'none' }}
               onChange={e => handleFile(e.target.files?.[0])} />
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => !processing && inputRef.current?.click()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        style={{
          width:'100%', aspectRatio:'16/9',
          border:`1.5px dashed ${dragOver ? C.yellow : C.line}`,
          background: dragOver ? 'rgba(255,215,0,0.06)' : 'transparent',
          borderRadius:8, cursor: processing ? 'wait' : 'pointer',
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6,
          color: dragOver ? C.yellow : C.muted,
          transition:'all 0.15s',
          userSelect:'none',
        }}>
        <div style={{ pointerEvents:'none', display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
          {processing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={16} />}
          <span style={{ fontSize:12 }}>
            {processing ? 'Traitement…' : dragOver ? 'Déposer ici' : 'Déposer ou cliquer'}
          </span>
          {!processing && !dragOver && (
            <span style={{ fontSize:10, color:C.muted2 }}>JPG, PNG, WebP · 16:9 recommandé</span>
          )}
        </div>
      </div>
      {youtubeId && !processing && (
        <button
          onClick={importFromYouTube}
          style={{
            marginTop:8, width:'100%', padding:'7px 10px',
            background:'transparent', border:`1px solid ${C.line}`, borderRadius:6,
            color:C.muted, fontSize:12, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>
          <Download size={11} /> Importer depuis YouTube
        </button>
      )}
      {error && (
        <div style={{ marginTop:6, fontSize:11, color:'#fca5a5' }}>{error}</div>
      )}
      <input ref={inputRef} type="file" accept="image/*" style={{ display:'none' }}
             onChange={e => handleFile(e.target.files?.[0])} />
    </div>
  );
}

function thumbActionBtn() {
  return {
    width:26, height:26, borderRadius:6,
    background:'rgba(0,0,0,0.7)', border:`1px solid rgba(255,255,255,0.15)`,
    color:C.text, cursor:'pointer',
    display:'flex', alignItems:'center', justifyContent:'center',
    backdropFilter:'blur(4px)',
  };
}

// ============================================================
//  PLANNING
// ============================================================
function PlanningView({ videos, updateVideo, thumbs, setVideoThumbnail }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const months = useMemo(() => {
    const set = new Set(videos.map(v => v.date.slice(0,7)));
    return Array.from(set).sort();
  }, [videos]);

  const filtered = useMemo(() => videos.filter(v => {
    if (statusFilter !== 'all' && v.status !== statusFilter) return false;
    if (monthFilter !== 'all' && !v.date.startsWith(monthFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(v.title||'').toLowerCase().includes(q) && !v.date.includes(q)) return false;
    }
    return true;
  }), [videos, search, statusFilter, monthFilter]);

  return (
    <div>
      <h1 style={{ fontSize:34, fontWeight:700, margin:0, letterSpacing:'-0.025em' }}>Planning</h1>
      <p style={{ fontSize:13, color:C.muted, margin:'8px 0 36px' }}>
        <span className="mono">{videos.length}</span> créneaux · Lundi · Mercredi · Vendredi
      </p>

      <div style={{ display:'flex', gap:8, marginBottom:20, alignItems:'center' }}>
        <div style={{ flex:1, position:'relative' }}>
          <Search size={13} style={{ position:'absolute', left:12, top:10, color:C.muted2 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un titre ou une date…"
            style={{
              width:'100%', padding:'9px 12px 9px 32px',
              background:C.bg2, border:`1px solid ${C.line}`,
              borderRadius:7, color:C.text, fontSize:13,
              transition:'border-color 0.15s',
            }}
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle()}>
          <option value="all">Tous les statuts</option>
          {Object.entries(STATUSES).map(([k,s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
        <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={selectStyle()}>
          <option value="all">Tous les mois</option>
          {months.map(m => {
            const [y, mo] = m.split('-');
            return <option key={m} value={m}>{MONTHS[Number(mo)-1]} {y}</option>;
          })}
        </select>
        <span className="mono" style={{ fontSize:12, color:C.muted2, marginLeft:4 }}>
          {filtered.length}/{videos.length}
        </span>
      </div>

      <div style={{
        borderTop:`1px solid ${C.line}`,
        borderRadius:'10px 10px 0 0',
        overflow:'hidden',
      }}>
        <div style={{
          display:'grid', gridTemplateColumns:'120px 1fr 150px 64px 110px 110px 60px 70px 24px',
          padding:'10px 14px', borderBottom:`1px solid ${C.line}`,
          fontSize:10, letterSpacing:'0.1em', textTransform:'uppercase',
          color:C.muted2, gap:14,
          background: C.bg2,
        }}>
          <div>Date</div>
          <div>Titre</div>
          <div>Statut</div>
          <div>Miniature</div>
          <div>Rushes</div>
          <div>Vidéo finale</div>
          <div style={{ textAlign:'center' }}>TG</div>
          <div style={{ textAlign:'right' }}>Vues</div>
          <div />
        </div>
        <div className="scroll" style={{ maxHeight:'65vh', overflowY:'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding:'48px 0', textAlign:'center', color:C.muted2, fontSize:13 }}>
              Aucun résultat
            </div>
          ) : filtered.map(v => (
            <Row key={v.id} video={v}
                 expanded={expandedId === v.id}
                 onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
                 onUpdate={patch => updateVideo(v.id, patch)}
                 thumb={thumbs[v.id]}
                 setThumbnail={dataURL => setVideoThumbnail(v.id, dataURL)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function selectStyle() {
  return {
    padding:'9px 12px', background:C.bg2, border:`1px solid ${C.line}`,
    borderRadius:7, color:C.text, fontSize:13, cursor:'pointer',
  };
}

function Row({ video, expanded, onToggle, onUpdate, thumb, setThumbnail }) {
  const s = STATUSES[video.status];

  return (
    <div className="row" style={{ borderBottom:`1px solid ${C.line}` }}>
      <div style={{
        display:'grid', gridTemplateColumns:'120px 1fr 150px 64px 110px 110px 60px 70px 24px',
        padding:'10px 14px', alignItems:'center', gap:14,
      }}>
        <div className="mono" style={{ fontSize:12 }}>{formatDate(video.date)}</div>

        <InlineInput value={video.title} onChange={v => onUpdate({ title:v })} placeholder="Titre…" />

        <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
          <Dot color={s.color} withGlow />
          <select
            value={video.status}
            onChange={e => onUpdate({ status: e.target.value })}
            style={{
              background:'transparent', border:'none',
              color: video.status === 'rien' ? C.muted : C.text,
              fontSize:13, cursor:'pointer', padding:0, flex:1, minWidth:0,
            }}
          >
            {Object.entries(STATUSES).map(([k,st]) => (
              <option key={k} value={k} style={{ background:C.bg, color:C.text }}>{st.label}</option>
            ))}
          </select>
        </div>

        <ThumbnailMini src={thumb} size="sm" />

        <LinkCell value={video.rushLink} onChange={v => onUpdate({ rushLink:v })} />
        <LinkCell value={video.finalLink} onChange={v => onUpdate({ finalLink:v })} />

        <div style={{ display:'flex', justifyContent:'center' }}>
          <TelegramCheck
            checked={!!video.telegramPosted}
            onChange={val => onUpdate({ telegramPosted: val })}
          />
        </div>

        <div className="mono" style={{
          textAlign:'right', fontSize:12,
          color: video.views > 0 ? C.text : C.muted2,
        }}>
          {video.views > 0 ? formatNumber(video.views) : '—'}
        </div>

        <button onClick={onToggle} style={{
          background:'none', border:'none', color:C.muted2, cursor:'pointer',
          padding:2, display:'flex', alignItems:'center', justifyContent:'center',
          transform: expanded ? 'rotate(180deg)' : 'none', transition:'transform 0.15s',
        }}>
          <ChevronDown size={13} />
        </button>
      </div>

      {expanded && (
        <div className="fade-in" style={{ padding:'4px 14px 20px', background:'#0b0b0e', borderTop:`1px solid ${C.line}` }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:20, paddingTop:16 }}>
            <div>
              {(video.likes > 0 || video.comments > 0 || video.duration) && (
                <div style={{
                  display:'flex', gap:20, padding:'10px 14px', marginBottom:14,
                  background:C.bg, border:`1px solid ${C.line}`, borderRadius:8,
                }}>
                  {video.duration && <YTStat label="Durée" value={video.duration} />}
                  {video.views > 0 && <YTStat label="Vues" value={formatNumber(video.views)} />}
                  {video.likes > 0 && <YTStat label="Likes" value={formatNumber(video.likes)} />}
                  {video.comments > 0 && <YTStat label="Commentaires" value={formatNumber(video.comments)} />}
                  {video.likes > 0 && video.views > 0 && (
                    <YTStat label="Ratio like" value={`${(video.likes / video.views * 100).toFixed(1)}%`} />
                  )}
                </div>
              )}
              <Field label="Notes & brief">
                <textarea
                  value={video.notes || ''}
                  onChange={e => onUpdate({ notes: e.target.value })}
                  placeholder="Concept, angle, chapitres, invités…"
                  rows={4}
                  style={{ ...fieldInput(), resize:'vertical' }}
                />
              </Field>
              {video.youtubeTitle && video.youtubeTitle !== video.title && (
                <div style={{ fontSize:11, color:C.muted2, marginTop:10 }}>
                  Titre YouTube : <span style={{ color:C.muted }}>{video.youtubeTitle}</span>
                </div>
              )}
              {video.publishedAt && (
                <div className="mono" style={{ fontSize:10, color:C.muted2, marginTop:6 }}>
                  Publiée le {new Date(video.publishedAt).toLocaleString('fr-FR')}
                </div>
              )}
              {video.lastViewUpdate && (
                <div className="mono" style={{ fontSize:10, color:C.muted2, marginTop:6 }}>
                  Dernière sync : {new Date(video.lastViewUpdate).toLocaleString('fr-FR')}
                </div>
              )}
            </div>
            <div>
              <Field label="Miniature">
                <ThumbnailDropZone
                  videoId={video.id}
                  src={thumb}
                  videoTitle={video.title}
                  youtubeId={video.youtubeId}
                  onChange={setThumbnail}
                />
              </Field>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function YTStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize:9, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2, marginBottom:3 }}>{label}</div>
      <div className="mono" style={{ fontSize:13, fontWeight:500, color:C.text }}>{value}</div>
    </div>
  );
}

function Dot({ color, size=7, withGlow }) {
  return <span style={{
    display:'inline-block', width:size, height:size, borderRadius:'50%',
    background:color, flexShrink:0,
    boxShadow: withGlow ? `0 0 6px ${color}66` : 'none',
  }} />;
}

function InlineInput({ value, onChange, placeholder, muted }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding:'4px 0', background:'transparent', border:'none',
        color: muted ? C.muted : C.text, fontSize:13, width:'100%',
      }}
    />
  );
}

function TelegramCheck({ checked, onChange, label }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange(!checked); }}
      title={checked ? 'Post Telegram publié' : 'Pas encore posté sur Telegram'}
      style={{
        display:'inline-flex', alignItems:'center', justifyContent:'center',
        gap: label ? 8 : 0,
        padding: label ? '6px 10px' : 0,
        width: label ? 'auto' : 22, height: label ? 'auto' : 22,
        background: checked ? 'rgba(0, 212, 255, 0.12)' : 'transparent',
        border: `1.5px solid ${checked ? C.cyan : C.line}`,
        borderRadius: 6, cursor:'pointer',
        color: checked ? C.cyan : C.muted2,
        transition: 'all 0.12s',
      }}>
      {checked ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <span style={{ width:11, height:11 }} />
      )}
      {label && <span style={{ fontSize:13, fontWeight:500 }}>{label}</span>}
    </button>
  );
}

function LinkCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        placeholder="URL"
        style={{
          padding:'4px 6px', background:C.bg2,
          border:`1px solid ${C.line}`, borderRadius:4,
          color:C.text, fontSize:12, width:'100%',
        }}
      />
    );
  }
  if (!value) {
    return (
      <button onClick={() => setEditing(true)} style={{
        padding:'4px 0', background:'none', border:'none',
        color:C.muted2, fontSize:12, cursor:'pointer', textAlign:'left',
      }}>+ ajouter</button>
    );
  }
  return (
    <div style={{ display:'flex', gap:4, alignItems:'center', minWidth:0 }}>
      <button onClick={() => setEditing(true)} style={{
        flex:1, padding:'4px 0', background:'none', border:'none',
        color:C.text, fontSize:12, cursor:'pointer', textAlign:'left',
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0,
      }} title={value}>
        {value.replace(/^https?:\/\/(www\.)?/, '')}
      </button>
      <a href={value} target="_blank" rel="noopener noreferrer"
         style={{ color:C.muted, display:'flex' }}>
        <ExternalLink size={11} />
      </a>
    </div>
  );
}

// ============================================================
//  CALENDAR
// ============================================================
function CalendarView({ videos, updateVideo, thumbs, setVideoThumbnail }) {
  const today = new Date();
  const [cur, setCur] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState(null);

  const byDate = useMemo(() => Object.fromEntries(videos.map(v => [v.date, v])), [videos]);

  const firstDay = new Date(cur.year, cur.month, 1);
  const lastDay = new Date(cur.year, cur.month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > lastDay.getDate()) cells.push(null);
    else {
      const d = new Date(cur.year, cur.month, dayNum);
      cells.push({ iso: toISO(d), day: dayNum, dow: d.getDay() });
    }
  }

  const prev = () => setCur(c => c.month === 0 ? { year:c.year-1, month:11 } : { year:c.year, month:c.month-1 });
  const next = () => setCur(c => c.month === 11 ? { year:c.year+1, month:0 } : { year:c.year, month:c.month+1 });
  const todayISO = toISO(today);

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:40 }}>
      <div>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:28 }}>
          <h1 style={{ fontSize:34, fontWeight:700, margin:0, letterSpacing:'-0.025em' }}>
            {MONTHS[cur.month]} <span className="mono" style={{ color:C.muted, fontWeight:400 }}>{cur.year}</span>
          </h1>
          <div style={{ display:'flex', gap:2 }}>
            <button className="btn-ghost" onClick={prev} style={navBtn()}><ChevronLeft size={14} /></button>
            <button className="btn-ghost" onClick={() => setCur({ year:today.getFullYear(), month:today.getMonth() })}
                    style={{ ...navBtn(), width:'auto', padding:'0 12px', fontSize:12 }}>
              Aujourd'hui
            </button>
            <button className="btn-ghost" onClick={next} style={navBtn()}><ChevronRight size={14} /></button>
          </div>
        </div>

        <div style={{
          display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:1,
          borderTop:`1px solid ${C.line}`, borderLeft:`1px solid ${C.line}`,
          borderRadius:'10px 10px 0 0', overflow:'hidden',
        }}>
          {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d => (
            <div key={d} style={{
              padding:'9px 10px', fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase',
              color:C.muted2, borderRight:`1px solid ${C.line}`, borderBottom:`1px solid ${C.line}`,
              background:C.bg2,
            }}>{d}</div>
          ))}
          {cells.map((cell, i) => {
            if (!cell) return <div key={i} style={{ minHeight:78, borderRight:`1px solid ${C.line}`, borderBottom:`1px solid ${C.line}`, background:'#06060780' }} />;
            const video = byDate[cell.iso];
            const isRelease = RELEASE_DAYS.includes(cell.dow);
            const isToday = cell.iso === todayISO;
            const isSelected = selected === cell.iso;
            const s = video ? STATUSES[video.status] : null;

            return (
              <button key={i}
                onClick={() => video && setSelected(isSelected ? null : cell.iso)}
                disabled={!video}
                style={{
                  minHeight:78, padding:10,
                  background: isSelected ? `${s.color}0e` : 'transparent',
                  border:'none',
                  borderRight:`1px solid ${C.line}`, borderBottom:`1px solid ${C.line}`,
                  color:C.text, textAlign:'left', cursor: video ? 'pointer' : 'default',
                  display:'flex', flexDirection:'column', gap:6, position:'relative',
                  transition:'background 0.12s',
                }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span className="mono" style={{
                    fontSize:12,
                    color: isToday ? C.yellow : isRelease ? C.text : C.muted2,
                    fontWeight: isToday ? 600 : 400,
                  }}>
                    {String(cell.day).padStart(2,'0')}
                  </span>
                  {video && <Dot color={s.color} size={5} withGlow />}
                </div>
                {video && video.title && (
                  <div style={{
                    fontSize:10, color:C.muted, lineHeight:1.3,
                    overflow:'hidden', display:'-webkit-box',
                    WebkitLineClamp:2, WebkitBoxOrient:'vertical',
                  }}>{video.title}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ position:'sticky', top:100 }}>
          {selected && byDate[selected] ? (
            <Detail video={byDate[selected]}
                    onUpdate={patch => updateVideo(byDate[selected].id, patch)}
                    onClose={() => setSelected(null)}
                    thumb={thumbs[byDate[selected].id]}
                    setThumbnail={dataURL => setVideoThumbnail(byDate[selected].id, dataURL)} />
          ) : (
            <Legend videos={videos} year={cur.year} month={cur.month} />
          )}
        </div>
      </div>
    </div>
  );
}

function navBtn() {
  return {
    width:32, height:32, background:'transparent', border:`1px solid ${C.line}`,
    borderRadius:7, color:C.text, cursor:'pointer',
    display:'inline-flex', alignItems:'center', justifyContent:'center',
  };
}

function Legend({ videos, year, month }) {
  const mStr = `${year}-${String(month+1).padStart(2,'0')}`;
  return (
    <div style={{ padding:'20px 22px', background:C.bg2, border:`1px solid ${C.line}`, borderRadius:10 }}>
      <div style={{ fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2, marginBottom:16 }}>
        Ce mois-ci
      </div>
      {Object.entries(STATUSES).map(([k, s]) => {
        const count = videos.filter(v => v.status === k && v.date.startsWith(mStr)).length;
        return (
          <div key={k} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0' }}>
            <Dot color={s.color} withGlow />
            <span style={{ fontSize:13, color:C.text, flex:1 }}>{s.label}</span>
            <span className="mono" style={{ fontSize:12, color:C.muted }}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function Detail({ video, onUpdate, onClose, thumb, setThumbnail }) {
  const s = STATUSES[video.status];
  const d = fromISO(video.date);
  return (
    <div className="fade-in" style={{ padding:'22px 22px 26px', background:C.bg2, border:`1px solid ${C.line}`, borderRadius:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'start', marginBottom:20 }}>
        <div>
          <div className="mono" style={{ fontSize:11, color:C.muted, letterSpacing:'0.05em' }}>
            {DAY_FULL[d.getDay()]} {d.getDate()} {MONTHS[d.getMonth()]} {d.getFullYear()}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
            <Dot color={s.color} withGlow />
            <span style={{ fontSize:13 }}>{s.label}</span>
          </div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', padding:4 }}>
          <X size={15} />
        </button>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
        <Field label="Miniature">
          <ThumbnailDropZone videoId={video.id} src={thumb} onChange={setThumbnail} videoTitle={video.title} youtubeId={video.youtubeId} />
        </Field>
        <Field label="Titre"><input value={video.title} onChange={e => onUpdate({ title:e.target.value })} style={fieldInput()} /></Field>
        <Field label="Statut">
          <select value={video.status} onChange={e => onUpdate({ status:e.target.value })} style={fieldInput()}>
            {Object.entries(STATUSES).map(([k,s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Rushes"><input value={video.rushLink} onChange={e => onUpdate({ rushLink:e.target.value })} placeholder="URL" style={fieldInput()} /></Field>
        <Field label="Vidéo finale"><input value={video.finalLink} onChange={e => onUpdate({ finalLink:e.target.value })} placeholder="URL YouTube" style={fieldInput()} /></Field>
        <Field label="Notes"><textarea value={video.notes||''} onChange={e => onUpdate({ notes:e.target.value })} rows={3} style={{ ...fieldInput(), resize:'vertical' }} /></Field>
        <Field label="Post Telegram">
          <TelegramCheck
            checked={!!video.telegramPosted}
            onChange={val => onUpdate({ telegramPosted: val })}
            label={video.telegramPosted ? 'Publié sur Telegram' : 'Pas encore publié'}
          />
        </Field>
        {(video.views > 0 || video.likes > 0 || video.duration) && (
          <div style={{ paddingTop:14, borderTop:`1px solid ${C.line}` }}>
            <div style={{ fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2, marginBottom:10 }}>Stats YouTube</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12 }}>
              {video.views > 0 && (
                <div>
                  <div className="mono" style={{ fontSize:20, fontWeight:500, color:C.yellow, letterSpacing:'-0.01em' }}>{formatNumber(video.views)}</div>
                  <div style={{ fontSize:10, color:C.muted2, letterSpacing:'0.08em', textTransform:'uppercase', marginTop:2 }}>Vues</div>
                </div>
              )}
              {video.likes > 0 && (
                <div>
                  <div className="mono" style={{ fontSize:20, fontWeight:500, color:C.text, letterSpacing:'-0.01em' }}>{formatNumber(video.likes)}</div>
                  <div style={{ fontSize:10, color:C.muted2, letterSpacing:'0.08em', textTransform:'uppercase', marginTop:2 }}>Likes</div>
                </div>
              )}
              {video.comments > 0 && (
                <div>
                  <div className="mono" style={{ fontSize:20, fontWeight:500, color:C.text, letterSpacing:'-0.01em' }}>{formatNumber(video.comments)}</div>
                  <div style={{ fontSize:10, color:C.muted2, letterSpacing:'0.08em', textTransform:'uppercase', marginTop:2 }}>Commentaires</div>
                </div>
              )}
              {video.duration && (
                <div>
                  <div className="mono" style={{ fontSize:20, fontWeight:500, color:C.text, letterSpacing:'-0.01em' }}>{video.duration}</div>
                  <div style={{ fontSize:10, color:C.muted2, letterSpacing:'0.08em', textTransform:'uppercase', marginTop:2 }}>Durée</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2, marginBottom:6 }}>{label}</div>
      {children}
    </div>
  );
}
function fieldInput() {
  return {
    width:'100%', padding:'8px 10px', background:C.bg,
    border:`1px solid ${C.line}`, borderRadius:7,
    color:C.text, fontSize:13,
  };
}

// ============================================================
//  ANALYTICS
// ============================================================
function AnalyticsView({ videos }) {
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  const published = useMemo(() => videos.filter(v => v.status==='publie' && v.views > 0).sort((a,b) => a.date.localeCompare(b.date)), [videos]);

  const stats = useMemo(() => {
    if (!published.length) return null;
    const total = published.reduce((s,v) => s+v.views, 0);
    const avg = Math.round(total / published.length);
    const sorted = [...published].sort((a,b) => b.views-a.views);
    const byDay = { 1:[], 3:[], 5:[] };
    for (const v of published) {
      const dow = fromISO(v.date).getDay();
      if (byDay[dow]) byDay[dow].push(v.views);
    }
    const dayAvg = Object.entries(byDay).map(([d,arr]) => ({
      day: d==='1' ? 'Lundi' : d==='3' ? 'Mercredi' : 'Vendredi',
      avg: arr.length ? Math.round(arr.reduce((s,n) => s+n, 0) / arr.length) : 0,
      count: arr.length,
    }));
    const bestDay = [...dayAvg].sort((a,b) => b.avg - a.avg)[0];
    return { total, avg, best: sorted[0], dayAvg, bestDay };
  }, [published]);

  const chartData = useMemo(() => published.map(v => ({
    date: v.date.slice(5).replace('-', '/'),
    vues: v.views,
    titre: v.title || 'Sans titre',
  })), [published]);

  const analyze = async () => {
    if (!published.length) { setError('Aucune vidéo publiée avec des vues.'); return; }
    setAnalyzing(true); setError(null); setAnalysis('');
    try {
      const data = published.map(v => ({
        date: v.date,
        jour: DAY_FULL[fromISO(v.date).getDay()],
        titre: v.title || 'Sans titre',
        vues: v.views,
      }));
      const prompt = `Tu es l'analyste YouTube dédié à "Binova - PocketOption", chaîne française de trading d'options binaires. Données :

${JSON.stringify(data, null, 2)}

Analyse ${data.length<3 ? 'prudemment (peu de données)' : 'en détail'}. Structure :
1. **Vue d'ensemble** — tendance générale
2. **Meilleur jour** — Lundi vs Mercredi vs Vendredi
3. **Top 3 vidéos** — vues + hypothèse
4. **À améliorer** — vidéos sous-performantes
5. **3 recommandations concrètes**

Français, markdown, direct, 400 mots max.`;

      const res = await fetch("/.netlify/functions/claude", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-5", max_tokens:1200,
          messages:[{ role:"user", content:prompt }]
        })
      });
      const d = await res.json();
      const text = (d.content||[]).filter(c => c.type==='text').map(c => c.text).join('\n\n');
      setAnalysis(text || 'Aucune analyse retournée.');
    } catch (e) {
      setError('Erreur : ' + e.message);
    }
    setAnalyzing(false);
  };

  return (
    <div>
      <h1 style={{ fontSize:34, fontWeight:700, margin:0, letterSpacing:'-0.025em' }}>Analytics</h1>
      <p style={{ fontSize:13, color:C.muted, margin:'8px 0 36px' }}>
        <span className="mono">{published.length}</span> vidéo{published.length>1?'s':''} publiée{published.length>1?'s':''} avec données
      </p>

      {!published.length ? (
        <div style={{
          padding:'60px 24px', textAlign:'center',
          border:`1px dashed ${C.line}`, borderRadius:10, background:C.bg2,
          fontSize:13, color:C.muted,
        }}>
          Publie des vidéos, colle leur lien YouTube, configure ta clé API et clique sur <span style={{ color:C.text }}>Sync</span>.
        </div>
      ) : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:0, marginBottom:40, border:`1px solid ${C.line}`, borderRadius:10, overflow:'hidden', background:C.bg2 }}>
            <Stat label="Vues totales" value={formatNumber(stats.total)} />
            <Stat label="Moyenne" value={formatNumber(stats.avg)} />
            <Stat label="Meilleure vidéo" value={formatNumber(stats.best.views)} sub={stats.best.title || 'Sans titre'} />
            <Stat label="Meilleur jour" value={stats.bestDay.day} sub={`${formatNumber(stats.bestDay.avg)} vues/vidéo`} last />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:40, marginBottom:40 }}>
            <Chart title="Vues par vidéo">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top:8, right:8, bottom:0, left:-20 }}>
                  <defs>
                    <linearGradient id="line-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.yellow} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={C.yellow} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill:C.muted2, fontSize:10, fontFamily:'JetBrains Mono' }} stroke={C.line} />
                  <YAxis tick={{ fill:C.muted2, fontSize:10, fontFamily:'JetBrains Mono' }} stroke={C.line} tickFormatter={formatNumber} />
                  <Tooltip
                    contentStyle={{ background:C.bg2, border:`1px solid ${C.line}`, borderRadius:8, fontSize:12 }}
                    labelStyle={{ color:C.muted }}
                    formatter={(v,_,p) => [formatNumber(v)+' vues', p.payload.titre]}
                  />
                  <Line type="monotone" dataKey="vues" stroke={C.yellow} strokeWidth={1.75} dot={{ r:2.5, fill:C.yellow, strokeWidth:0 }} activeDot={{ r:5, fill:C.yellow }} />
                </LineChart>
              </ResponsiveContainer>
            </Chart>
            <Chart title="Par jour de sortie">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.dayAvg} margin={{ top:8, right:8, bottom:0, left:-20 }}>
                  <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill:C.muted, fontSize:10 }} stroke={C.line} />
                  <YAxis tick={{ fill:C.muted2, fontSize:10, fontFamily:'JetBrains Mono' }} stroke={C.line} tickFormatter={formatNumber} />
                  <Tooltip contentStyle={{ background:C.bg2, border:`1px solid ${C.line}`, borderRadius:8, fontSize:12 }} formatter={v => [formatNumber(v)+' vues', 'Moyenne']} />
                  <Bar dataKey="avg" fill={C.yellow} radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </Chart>
          </div>

          <div style={{ borderTop:`1px solid ${C.line}`, paddingTop:32 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: analysis ? 20 : 0 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:600, letterSpacing:'-0.01em' }}>Analyse par Claude</div>
                <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>
                  Diagnostic complet et recommandations concrètes
                </div>
              </div>
              <button onClick={analyze} disabled={analyzing} className="btn-primary" style={{
                padding:'9px 17px', background:C.yellow, color:'#000', border:'none',
                borderRadius:8, fontSize:13, fontWeight:600, cursor: analyzing ? 'wait' : 'pointer',
                display:'flex', alignItems:'center', gap:8,
              }}>
                {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {analyzing ? 'Analyse…' : 'Lancer l\'analyse'}
              </button>
            </div>

            {error && (
              <div style={{ padding:10, border:'1px solid #7f1d1d', borderRadius:7, color:'#fca5a5', fontSize:13, display:'flex', gap:8, alignItems:'center', marginTop:16 }}>
                <AlertCircle size={14} /> {error}
              </div>
            )}

            {analysis && (
              <div className="fade-in" style={{ fontSize:14, lineHeight:1.7, color:C.text, padding:'20px 24px', background:C.bg2, border:`1px solid ${C.line}`, borderRadius:10 }}>
                <Markdown text={analysis} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, last }) {
  return (
    <div style={{
      padding:'22px 24px',
      borderRight: last ? 'none' : `1px solid ${C.line}`,
    }}>
      <div style={{ fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2, marginBottom:10 }}>{label}</div>
      <div className="mono" style={{ fontSize:24, fontWeight:500, color:C.text, lineHeight:1, letterSpacing:'-0.01em' }}>{value}</div>
      {sub && (
        <div style={{ fontSize:11, color:C.muted, marginTop:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Chart({ title, children }) {
  return (
    <div>
      <div style={{ fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2, marginBottom:16 }}>{title}</div>
      {children}
    </div>
  );
}

function Markdown({ text }) {
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.yellow};font-weight:600">$1</strong>`)
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, `<code style="background:${C.line};padding:1px 5px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:12px">$1</code>`);

  return (
    <div>
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h4 key={i} style={{ fontSize:13, fontWeight:600, margin:'16px 0 6px', color:C.text }}>{line.slice(4)}</h4>;
        if (line.startsWith('## ')) return <h3 key={i} style={{ fontSize:14, fontWeight:600, margin:'16px 0 6px', color:C.text }}>{line.slice(3)}</h3>;
        if (line.startsWith('# ')) return <h2 key={i} style={{ fontSize:15, fontWeight:700, margin:'16px 0 8px' }}>{line.slice(2)}</h2>;
        if (line.match(/^\d+\.\s/)) {
          const [, num, rest] = line.match(/^(\d+)\.\s(.*)/);
          return <div key={i} style={{ display:'flex', gap:10, margin:'4px 0' }}><span className="mono" style={{ color:C.muted }}>{num}.</span><span dangerouslySetInnerHTML={{ __html: inline(rest) }} /></div>;
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return <div key={i} style={{ display:'flex', gap:10, margin:'3px 0' }}><span style={{ color:C.muted2 }}>—</span><span dangerouslySetInnerHTML={{ __html: inline(line.slice(2)) }} /></div>;
        }
        if (!line.trim()) return <div key={i} style={{ height:8 }} />;
        return <p key={i} style={{ margin:'4px 0' }} dangerouslySetInnerHTML={{ __html: inline(line) }} />;
      })}
    </div>
  );
}

// ============================================================
//  SHORTS
// ============================================================
const SHORT_STATUS_KEYS = ['rien', 'tourne', 'monte', 'publie'];
const SHORTS_START_YEAR = 2026;
const SHORTS_START_MONTH = 6; // Juillet (0-indexed)

function generateMonthShorts(monthKey) {
  return Array.from({ length: 30 }, (_, i) => ({
    id: `short_${monthKey}_${String(i + 1).padStart(2, '0')}`,
    number: i + 1,
    status: 'rien',
    title: '',
  }));
}

function ShortsView({ shorts, updateShort }) {
  const today = new Date();
  const isAfterStart =
    today.getFullYear() > SHORTS_START_YEAR ||
    (today.getFullYear() === SHORTS_START_YEAR && today.getMonth() >= SHORTS_START_MONTH);

  const [cur, setCur] = useState(
    isAfterStart
      ? { year: today.getFullYear(), month: today.getMonth() }
      : { year: SHORTS_START_YEAR, month: SHORTS_START_MONTH }
  );

  const monthKey = `${cur.year}-${String(cur.month + 1).padStart(2, '0')}`;
  const monthShorts = shorts[monthKey] || generateMonthShorts(monthKey);

  const counts = useMemo(() => {
    const c = { rien: 0, tourne: 0, monte: 0, publie: 0 };
    for (const s of monthShorts) c[s.status] = (c[s.status] || 0) + 1;
    return c;
  }, [monthShorts]);

  const isFirst = cur.year === SHORTS_START_YEAR && cur.month === SHORTS_START_MONTH;

  const prev = () => {
    if (isFirst) return;
    setCur(c => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  };
  const next = () =>
    setCur(c => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));

  const progress = (counts.publie / 30) * 100;

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28, gap:20 }}>
        <div>
          <h1 style={{ fontSize:34, fontWeight:700, margin:0, letterSpacing:'-0.025em' }}>
            Shorts
          </h1>
          <p style={{ fontSize:13, color:C.muted, margin:'8px 0 0' }}>
            Batch mensuel · 30 shorts par mois
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <button className="btn-ghost" onClick={prev} disabled={isFirst} style={{ ...navBtn(), opacity: isFirst ? 0.35 : 1, cursor: isFirst ? 'not-allowed' : 'pointer' }}>
            <ChevronLeft size={14} />
          </button>
          <div style={{ minWidth:170, textAlign:'center' }}>
            <div style={{ fontSize:18, fontWeight:600, letterSpacing:'-0.01em' }}>
              {MONTHS[cur.month]} <span className="mono" style={{ color:C.muted, fontWeight:400 }}>{cur.year}</span>
            </div>
          </div>
          <button className="btn-ghost" onClick={next} style={navBtn()}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Barre de progression */}
      <div style={{
        background:C.bg2, border:`1px solid ${C.line}`, borderRadius:10,
        padding:'18px 22px', marginBottom:24,
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:12 }}>
          <div style={{ fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2 }}>
            Avancement
          </div>
          <div className="mono" style={{ fontSize:13 }}>
            <span style={{ color:C.text, fontWeight:600 }}>{counts.publie}</span>
            <span style={{ color:C.muted2 }}>/30 publiés</span>
          </div>
        </div>
        <div style={{
          height:5, background:C.line, borderRadius:3, overflow:'hidden',
        }}>
          <div style={{
            width:`${progress}%`, height:'100%',
            background: progress === 100 ? STATUSES.publie.color : C.yellow,
            transition:'width 0.3s ease, background 0.3s ease',
            boxShadow: `0 0 8px ${progress === 100 ? STATUSES.publie.color : C.yellow}55`,
          }} />
        </div>
        <div style={{ display:'flex', gap:18, marginTop:14, flexWrap:'wrap' }}>
          {SHORT_STATUS_KEYS.map(k => (
            <div key={k} style={{ display:'flex', alignItems:'center', gap:7 }}>
              <Dot color={STATUSES[k].color} withGlow={k !== 'rien'} />
              <span style={{ fontSize:12, color:C.muted }}>{STATUSES[k].label}</span>
              <span className="mono" style={{ fontSize:12, fontWeight:500, color:C.text }}>{counts[k]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grille de 30 cartes */}
      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(auto-fill, minmax(190px, 1fr))',
        gap:10,
      }}>
        {monthShorts.map((short, i) => (
          <ShortCard
            key={short.id}
            short={short}
            onChange={patch => updateShort(monthKey, i, patch)}
          />
        ))}
      </div>
    </div>
  );
}

function ShortCard({ short, onChange }) {
  const status = STATUSES[short.status];
  const isEmpty = short.status === 'rien';
  const isPublished = short.status === 'publie';

  const cycleStatus = () => {
    const idx = SHORT_STATUS_KEYS.indexOf(short.status);
    const next = SHORT_STATUS_KEYS[(idx + 1) % SHORT_STATUS_KEYS.length];
    onChange({ status: next });
  };

  return (
    <div
      className="hover-card"
      style={{
        background: isPublished ? `${status.color}0c` : C.bg2,
        border:`1px solid ${isEmpty ? C.line : `${status.color}40`}`,
        borderRadius:9,
        padding:'12px 14px',
        display:'flex', flexDirection:'column', gap:10,
        transition:'all 0.15s',
      }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
        <span className="mono" style={{
          fontSize:13, fontWeight:600,
          color: isEmpty ? C.muted2 : C.text,
        }}>
          #{String(short.number).padStart(2, '0')}
        </span>
        <button
          onClick={cycleStatus}
          title="Cliquer pour changer le statut"
          style={{
            display:'inline-flex', alignItems:'center', gap:6,
            padding:'4px 9px', borderRadius:5, cursor:'pointer',
            background: isEmpty ? 'transparent' : `${status.color}14`,
            border:`1px solid ${isEmpty ? C.line : `${status.color}30`}`,
            color: status.color,
            fontSize:11, fontWeight:500,
            transition:'all 0.12s',
          }}>
          <Dot color={status.color} size={5} withGlow={!isEmpty} />
          {status.label}
        </button>
      </div>
      <input
        value={short.title || ''}
        onChange={e => onChange({ title: e.target.value })}
        placeholder="Concept du short…"
        style={{
          padding:'2px 0', background:'transparent', border:'none',
          color: isEmpty ? C.muted : C.text,
          fontSize:13, width:'100%',
        }}
      />
    </div>
  );
}

// ============================================================
//  SETTINGS
// ============================================================
function Settings({ settings, setSettings, onClose, videos, setVideos }) {
  const [localKey, setLocalKey] = useState(settings.ytApiKey);
  const [confirmReset, setConfirmReset] = useState(false);

  const save = () => {
    setSettings(s => ({ ...s, ytApiKey: localKey }));
    onClose();
  };

  const regenerate = () => {
    if (!confirmReset) { setConfirmReset(true); setTimeout(() => setConfirmReset(false), 4000); return; }
    const fresh = generateSlots(START_DATE, DEFAULT_END);
    const existing = Object.fromEntries(videos.map(v => [v.date, v]));
    setVideos(fresh.map(slot => existing[slot.date] ? { ...slot, ...existing[slot.date] } : slot));
    setConfirmReset(false);
  };

  const extendTo = year => {
    const end = new Date(year, 11, 31);
    const existing = Object.fromEntries(videos.map(v => [v.date, v]));
    const fresh = generateSlots(START_DATE, end);
    setVideos(fresh.map(slot => existing[slot.date] ? { ...slot, ...existing[slot.date] } : slot));
  };

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:90,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
      backdropFilter:'blur(4px)',
    }}>
      <div className="fade-in" onClick={e => e.stopPropagation()} style={{
        background:C.bg2, border:`1px solid ${C.line}`, borderRadius:12,
        width:'100%', maxWidth:500, padding:28,
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:28 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <BinovaLogo size={22} />
            <h2 style={{ fontSize:18, fontWeight:700, margin:0 }}>Paramètres</h2>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', padding:4 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2, marginBottom:8 }}>
            Clé API YouTube
          </div>
          <p style={{ fontSize:12, color:C.muted, margin:'0 0 10px', lineHeight:1.55 }}>
            Crée-la sur <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color:C.text, textDecoration:'underline' }}>console.cloud.google.com</a> (active "YouTube Data API v3"). Stockée uniquement dans ton navigateur.
          </p>
          <input
            value={localKey}
            onChange={e => setLocalKey(e.target.value)}
            placeholder="AIzaSy…"
            type="password"
            style={{ ...fieldInput(), fontFamily:'JetBrains Mono, monospace', fontSize:12 }}
          />
          <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:12, fontSize:12, color:C.muted, cursor:'pointer' }}>
            <input
              type="checkbox"
              checked={settings.autoRefresh}
              onChange={e => setSettings(s => ({ ...s, autoRefresh: e.target.checked }))}
              style={{ accentColor:C.yellow }}
            />
            Auto-refresh toutes les 5 minutes
          </label>
        </div>

        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase', color:C.muted2, marginBottom:8 }}>
            Étendre jusqu'à fin
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {[2027, 2028, 2029].map(y => (
              <button key={y} className="btn-ghost" onClick={() => extendTo(y)} style={{
                flex:1, padding:9, background:'transparent',
                border:`1px solid ${C.line}`, borderRadius:7, color:C.text,
                fontSize:12, cursor:'pointer',
              }}>{y}</button>
            ))}
          </div>
        </div>

        <div>
          <button onClick={regenerate} style={{
            width:'100%', padding:9,
            background: confirmReset ? '#450a0a' : 'transparent',
            border:`1px solid ${confirmReset ? '#7f1d1d' : C.line}`, borderRadius:7,
            color: confirmReset ? '#fca5a5' : C.muted,
            fontSize:12, cursor:'pointer',
          }}>
            {confirmReset ? 'Confirmer la régénération' : 'Régénérer les créneaux manquants'}
          </button>
        </div>

        <div style={{ display:'flex', gap:8, marginTop:24 }}>
          <button className="btn-ghost" onClick={onClose} style={{
            flex:1, padding:10, background:'transparent',
            border:`1px solid ${C.line}`, borderRadius:8,
            color:C.muted, fontSize:13, cursor:'pointer',
          }}>Annuler</button>
          <button onClick={save} className="btn-primary" style={{
            flex:1, padding:10, background:C.yellow, border:'none',
            borderRadius:8, color:'#000', fontSize:13, fontWeight:600, cursor:'pointer',
          }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}
