import { useState, useRef, useEffect, useCallback } from "react";

// ─── CLOUDFLARE WORKER URLS ───────────────────────────────────────────────────
const ANTHROPIC_URL = "YOUR_ANTHROPIC_WORKER_URL";
const SHEETS_URL    = "YOUR_SHEETS_WORKER_URL";
const DRIVE_URL     = "YOUR_DRIVE_WORKER_URL";

// ─── USERS ────────────────────────────────────────────────────────────────────
const DEFAULT_USERS = [
  { id:"jayraj",  name:"Jayraj Bhattbhatt",  isAdmin:false, avatar:"👨‍💼", pin:"0000" },
  { id:"rashmi",  name:"Rashmi Bhattbhatt",  isAdmin:false, avatar:"👩‍💼", pin:"0000" },
  { id:"dhwani",  name:"Dhwani Bhattbhatt",  isAdmin:true,  avatar:"👑",  pin:"0000" },
  { id:"pooja",   name:"Pooja Goyal",        isAdmin:false, avatar:"👩‍🦱", pin:"0000" },
  { id:"manju",   name:"Manju Jain",         isAdmin:false, avatar:"👩‍🦳", pin:"0000" },
];

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { id:"steel",      label:"Steel & Metal",        icon:"🔩", color:"#64748B", items:["TMT Rebar","MS Angle","GI Sheet","Steel Pipe","Iron Rod","MS Plate","Other"], units:["Tonnes","Kg","Nos","Rft"] },
  { id:"cement",     label:"Cement & Concrete",    icon:"🪨", color:"#78716C", items:["OPC Cement","PPC Cement","River Sand","M-Sand","20mm Aggregate","40mm Aggregate","RMC"], units:["Bags","Tonnes","Cu.m","Loads"] },
  { id:"rawmaterial",label:"Raw Material",         icon:"🧱", color:"#B45309", items:["Red Brick","Fly Ash Brick","Hollow Block","Stone","Granite","Wood","Glass","Tile","Other"], units:["Nos","Sq.ft","Sq.m","Cu.ft","Loads"] },
  { id:"contractor", label:"Contractor Payment",   icon:"👷", color:"#0369A1", items:["Civil Work","Foundation","Brick Masonry","Plastering","Flooring","Roofing","Other Work"], units:["LS","Running Bill","Advance","Final Payment"] },
  { id:"architect",  label:"Architect / Designer", icon:"📐", color:"#7C3AED", items:["Design Fee","Drawing Approval","Site Visit","Consultation","3D Rendering","Other"], units:["LS","Visit"] },
  { id:"lawyer",     label:"Legal / Lawyer",       icon:"⚖️",  color:"#DC2626", items:["Title Verification","Sale Deed","NOC Drafting","Court Fee","Registration","Other"], units:["LS"] },
  { id:"labour",     label:"Labour / Wages",       icon:"🦺", color:"#EA580C", items:["Mason","Carpenter","Electrician","Plumber","Helper","Supervisor","Other"], units:["Days","Hours","Nos"] },
  { id:"electrical", label:"Electrical",           icon:"⚡", color:"#CA8A04", items:["Wiring","Switchgear","DB Box","Cable","Light Fitting","Conduit","Other"], units:["LS","Metres","Nos","Rft"] },
  { id:"plumbing",   label:"Plumbing / Sanitation",icon:"🔧", color:"#0891B2", items:["PVC Pipe","CPVC Pipe","Fittings","Water Tank","Pump","Sanitary Ware","Other"], units:["LS","Metres","Nos","Rft"] },
  { id:"transport",  label:"Transport / Logistics",icon:"🚛", color:"#16A34A", items:["Material Delivery","Truck Hire","Loading/Unloading","Crane Hire","Other"], units:["Trips","Days","LS"] },
  { id:"government", label:"Govt. Fees / NOCs",    icon:"🏛️",  color:"#9333EA", items:["Building Permission","NOC Fee","Property Tax","Stamp Duty","Registration","Other"], units:["LS"] },
  { id:"equipment",  label:"Equipment / Machinery",icon:"⚙️",  color:"#334155", items:["JCB / Excavator","Concrete Mixer","Scaffolding","Welding Machine","Generator","Other"], units:["Days","Hours","LS"] },
  { id:"interior",   label:"Interior / Finishing", icon:"🪟", color:"#BE185D", items:["Tiles","Paint","False Ceiling","Doors","Windows","Hardware","Other"], units:["Sq.ft","Sq.m","Nos","Litres","LS"] },
  { id:"misc",       label:"Miscellaneous",        icon:"📦", color:"#6B7280", items:["Site Expense","Office Expense","Printing","Refreshment","Other"], units:["LS","Nos"] },
];

const PAYMENT_MODES = ["","Cash","UPI","Cheque","NEFT/RTGS","Card"];
const CAT_COLORS = ["#64748B","#0369A1","#7C3AED","#DC2626","#EA580C","#CA8A04","#0891B2","#16A34A","#9333EA","#BE185D","#B45309"];
const SESSION_KEY = "sbt_v7_session";
const MODEL = "claude-haiku-4-5-20251001";

const fmt = n => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n||0);
const todayStr = () => new Date().toISOString().split("T")[0];
const nowStr = () => new Date().toLocaleString("en-IN");
const BLANK = {date:todayStr(),category:"",item:"",qty:"",unit:"",amount:"",vendor:"",paymentMode:"",billNumber:"",notes:""};

// ─── SERIAL NUMBER ────────────────────────────────────────────────────────────
function generateSerial(existingExpenses) {
  const max = existingExpenses.reduce((m,e) => {
    // Handle both "SST-0001" format and plain numbers
    const serial = String(e.serial||"");
    const parts = serial.split("-");
    const n = parseInt(parts[parts.length-1]||"0");
    return !isNaN(n) && n > m ? n : m;
  }, 0);
  return `SST-${String(max+1).padStart(4,"0")}`;
}

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function callScript(payload) {
  try {
    const r = await fetch(SHEETS_URL, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const d = await r.json();
    return {ok:d.status==="success", data:d.data};
  } catch { return {ok:false}; }
}

async function callAI(messages, maxTokens=1200) {
  const r = await fetch(ANTHROPIC_URL, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:MODEL, max_tokens:maxTokens, messages})
  });
  const d = await r.json();
  if(d.error) throw new Error(d.error.message||"API error");
  return d.content?.find(b=>b.type==="text")?.text||"";
}

async function uploadToDrive(imageBase64, fileName, mimeType="image/jpeg") {
  try {
    const r = await fetch(DRIVE_URL, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({imageBase64, fileName, mimeType})
    });
    const d = await r.json();
    return d.success ? d.viewLink : null;
  } catch { return null; }
}

// ─── IMAGE COMPRESSION ────────────────────────────────────────────────────────
function compressImage(dataUrl, maxSize=1200, quality=0.75) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let {width:w, height:h} = img;
      if(w>h && w>maxSize){h=Math.round(h*maxSize/w);w=maxSize;}
      else if(h>maxSize){w=Math.round(w*maxSize/h);h=maxSize;}
      canvas.width=w; canvas.height=h;
      canvas.getContext("2d").drawImage(img,0,0,w,h);
      resolve(canvas.toDataURL("image/jpeg",quality));
    };
    img.src=dataUrl;
  });
}

// ─── UI ATOMS ─────────────────────────────────────────────────────────────────
const Av = ({u,s=32}) => (
  <div style={{width:s,height:s,borderRadius:"50%",background:"#1a2640",display:"flex",alignItems:"center",justifyContent:"center",fontSize:s*.42,border:"2px solid #263450",flexShrink:0}}>
    {u?.avatar||"👤"}
  </div>
);

const CatPill = ({id,categories}) => {
  const c = categories?.find(x=>x.id===id); if(!c) return null;
  return <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:c.color+"22",color:c.color,whiteSpace:"nowrap"}}>{c.icon} {c.label}</span>;
};

const StatusPill = ({s}) => {
  const m = {active:["#e6faf2","#0f7a4a","Active"],cancelled:["#fdecea","#c0392b","Cancelled"],modified:["#fff8e6","#9a6400","Modified"],imported:["#e8f0fe","#1a56cc","Imported"]};
  const [bg,cl,lb] = m[s]||m.active;
  return <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:bg,color:cl}}>{lb}</span>;
};

function Toast({t}) {
  if(!t) return null;
  const cols = {success:["#e6faf2","#0f7a4a","#a7f3d0"],error:["#fdecea","#c0392b","#fca5a5"],warn:["#fff8e6","#9a6400","#fde68a"],info:["#e8f0fe","#1a56cc","#bfdbfe"]};
  const [bg,cl,br] = cols[t.type]||cols.info;
  return <div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:9999,padding:"11px 20px",borderRadius:12,fontWeight:600,fontSize:13,background:bg,color:cl,boxShadow:"0 8px 24px rgba(0,0,0,.18)",border:`1.5px solid ${br}`,whiteSpace:"nowrap",animation:"fadeUp .2s ease",maxWidth:"90vw",textAlign:"center"}}>{t.msg}</div>;
}

const FieldWarn = ({show,onConfirm}) => show ? (
  <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
    <span style={{fontSize:10,color:"#d97706"}}>⚠ From bill — verify</span>
    <button onClick={onConfirm} style={{background:"none",border:"none",fontSize:10,color:"#059669",fontWeight:700,cursor:"pointer",padding:0}}>✓ Confirm</button>
  </div>
) : null;

const lbl = {fontSize:"10px",fontWeight:700,color:"#64748b",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".5px"};
const inp = {width:"100%",padding:"10px 12px",border:"1.5px solid #e2e8f0",borderRadius:10,fontSize:14,background:"white",fontFamily:"inherit",color:"#0f172a",WebkitAppearance:"none"};
const warnInp = {...inp,borderColor:"#f59e0b",background:"#fffbeb"};

// ─── FILE UPLOAD BUTTON ───────────────────────────────────────────────────────
function UploadButton({onFile, label="📎 Upload", style={}}) {
  const ref = useRef();
  return (
    <>
      <button onClick={()=>ref.current?.click()}
        style={{padding:"10px 20px",background:"#0369a1",color:"white",border:"none",borderRadius:10,fontWeight:700,fontSize:13,cursor:"pointer",...style}}>
        {label}
      </button>
      <input ref={ref} type="file" accept="image/*,application/pdf"
        style={{display:"none"}}
        onChange={e=>{const f=e.target.files[0];if(f)onFile(f);e.target.value="";}}/>
    </>
  );
}

// ─── PIN SCREEN ───────────────────────────────────────────────────────────────
function PinScreen({user,onSuccess,onBack}) {
  const [pin,setPin] = useState("");
  const [err,setErr] = useState(0);
  const [shake,setShake] = useState(false);

  const attempt = p => {
    if(p===user.pin){
      sessionStorage.setItem(SESSION_KEY,JSON.stringify({id:user.id,until:Date.now()+86400000}));
      onSuccess();
    } else {
      setShake(true); setTimeout(()=>setShake(false),500);
      setErr(e=>e+1); setPin("");
    }
  };
  const press = d => {
    const next=pin+d;
    if(next.length<=4){setPin(next);if(next.length===4)setTimeout(()=>attempt(next),150);}
  };

  return (
    <div style={{textAlign:"center",width:"100%",maxWidth:300,margin:"0 auto"}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#4a6080",fontSize:13,cursor:"pointer",marginBottom:24,display:"block"}}>← Back</button>
      <Av u={user} s={64}/>
      <div style={{color:"white",fontWeight:700,fontSize:18,marginTop:14,marginBottom:4}}>{user.name}</div>
      <div style={{color:"#4a6080",fontSize:12,marginBottom:28}}>{user.isAdmin?"Admin":"Member"}</div>
      <div style={{display:"flex",gap:16,justifyContent:"center",marginBottom:8,animation:shake?"shake .4s":"none"}}>
        {[0,1,2,3].map(i=><div key={i} style={{width:14,height:14,borderRadius:"50%",background:pin.length>i?"#6366f1":"#1a2640",border:`2px solid ${pin.length>i?"#6366f1":"#263450"}`,transition:"all .15s"}}/>)}
      </div>
      {err>0&&<div style={{color:"#f87171",fontSize:12,marginBottom:8}}>Wrong PIN · {err} attempt{err>1?"s":""}</div>}
      <div style={{height:err?0:20}}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,maxWidth:220,margin:"0 auto"}}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>{if(d==="⌫")setPin(p=>p.slice(0,-1));else if(d!=="")press(String(d));}}
            style={{padding:"16px 0",background:d===""?"transparent":"#0d1a2e",border:`1.5px solid ${d===""?"transparent":"#1a2a40"}`,borderRadius:12,color:"white",fontSize:18,fontWeight:700,cursor:d===""?"default":"pointer",fontFamily:"inherit"}}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── BILL SCANNER ─────────────────────────────────────────────────────────────
function BillScanner({imageB64,isTrust,onExtracted,onSkip}) {
  const [status,setStatus] = useState("ready");
  const [result,setResult] = useState(null);

  const scan = async () => {
    setStatus("scanning");
    try {
      const context = isTrust
        ? `This is a Payment Receipt from "Shree Sanskaar Public Education Trust". Fields: Receipt No., Date, Amount, Payment Method, Amount Paid To (vendor), Amount in Words, On Account Of (purpose).`
        : `This is a construction vendor bill. May be English, Hindi, or Gujarati — printed or handwritten.`;
      const text = await callAI([{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:"image/jpeg",data:imageB64}},
        {type:"text",text:`${context}\nReturn ONLY JSON (no markdown):\n{"amount":number or null,"vendor":"string","date":"YYYY-MM-DD or empty","billNumber":"string or empty","item":"main item or purpose","qty":"string or empty","unit":"string or empty","category":"steel|cement|rawmaterial|contractor|architect|lawyer|labour|electrical|plumbing|transport|government|equipment|interior|misc","paymentMode":"Cash|UPI|Cheque|NEFT/RTGS|Card or empty","confidence":"High|Medium|Low","confidenceNote":"brief reason","langNote":"if non-English, note it. Else empty."}`}
      ]}]);
      const p = JSON.parse(text.replace(/```json|```/g,"").trim());
      setResult(p); setStatus("done");
    } catch(e) {
      console.error("Scan error:",e);
      setStatus("error");
    }
  };

  const confColors = {"High":["#e6faf2","#0f7a4a"],"Medium":["#fff8e6","#9a6400"],"Low":["#fdecea","#c0392b"]};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:10001,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:560,maxHeight:"90vh",overflowY:"auto",padding:20}}>
        <div style={{width:36,height:4,background:"#e2e8f0",borderRadius:2,margin:"0 auto 16px"}}/>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,marginBottom:2}}>{isTrust?"📋 Trust Receipt":"🔍 Bill Scanner"}</div>
        <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>{isTrust?"Shree Sanskaar format":"Hindi · Gujarati · Handwritten supported"}</div>
        <img src={`data:image/jpeg;base64,${imageB64}`} alt="bill" style={{width:"100%",borderRadius:12,border:"1.5px solid #e2e8f0",objectFit:"contain",maxHeight:200,background:"#f8fafc",marginBottom:14}}/>
        {status==="ready"&&<>
          <button onClick={scan} style={{width:"100%",padding:"14px 0",background:"linear-gradient(135deg,#4f46e5,#7c3aed)",color:"white",border:"none",borderRadius:12,fontWeight:700,fontSize:15,cursor:"pointer",marginBottom:10}}>✨ Scan & Auto-fill Form</button>
          <button onClick={onSkip} style={{width:"100%",padding:"12px 0",background:"#f1f5f9",color:"#64748b",border:"none",borderRadius:12,fontWeight:600,fontSize:14,cursor:"pointer"}}>Skip — Fill Manually</button>
        </>}
        {status==="scanning"&&<div style={{textAlign:"center",padding:"20px 0"}}><div style={{fontSize:36,marginBottom:8}}>⏳</div><div style={{fontWeight:600,color:"#475569"}}>Reading bill…</div></div>}
        {status==="error"&&<div style={{textAlign:"center",padding:"16px 0"}}>
          <div style={{fontSize:32,marginBottom:8}}>⚠️</div>
          <div style={{fontWeight:600,color:"#dc2626",marginBottom:4}}>Could not read bill</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:12}}>The image may be unclear or the content unrecognisable. Try a clearer photo.</div>
          <button onClick={onSkip} style={{padding:"12px 24px",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer"}}>Fill Manually →</button>
        </div>}
        {status==="done"&&result&&<>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
            <span style={{fontWeight:700,fontSize:13}}>Extracted</span>
            <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:(confColors[result.confidence]||["#f1f5f9","#64748b"])[0],color:(confColors[result.confidence]||["#f1f5f9","#64748b"])[1]}}>{result.confidence}</span>
          </div>
          {result.langNote&&<div style={{background:"#fff8e6",border:"1.5px solid #fde68a",borderRadius:8,padding:"7px 10px",fontSize:11,color:"#9a6400",marginBottom:8}}>📝 {result.langNote}</div>}
          {result.confidenceNote&&<div style={{background:"#e8f0fe",border:"1.5px solid #bfdbfe",borderRadius:8,padding:"7px 10px",fontSize:11,color:"#1a56cc",marginBottom:10}}>💡 {result.confidenceNote}</div>}
          <div style={{background:"#f8fafc",borderRadius:10,padding:"10px 12px",fontSize:13,lineHeight:2,border:"1.5px solid #e2e8f0",marginBottom:14}}>
            {[["Amount",result.amount?fmt(result.amount):"—"],["Vendor",result.vendor||"—"],["Date",result.date||"—"],["Item",result.item||"—"]].map(([k,v])=>(
              <div key={k} style={{display:"flex",gap:8}}><span style={{color:"#94a3b8",width:52,flexShrink:0}}>{k}</span><span style={{fontWeight:600,color:v==="—"?"#cbd5e1":"#0f172a"}}>{v}</span></div>
            ))}
          </div>
          <button onClick={()=>onExtracted(result)} style={{width:"100%",padding:"14px 0",background:"#0f172a",color:"white",border:"none",borderRadius:12,fontWeight:700,fontSize:15,cursor:"pointer"}}>Fill Form with These →</button>
        </>}
      </div>
    </div>
  );
}

// ─── DUPLICATE CHECKER ────────────────────────────────────────────────────────
function DuplicateDialog({matches,onAccept,onReject}) {
  const [reason,setReason] = useState("");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:10002,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:500,padding:24}}>
        <div style={{width:36,height:4,background:"#e2e8f0",borderRadius:2,margin:"0 auto 16px"}}/>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,marginBottom:4,color:"#dc2626"}}>⚠️ Possible Duplicate</div>
        <div style={{fontSize:13,color:"#475569",marginBottom:14,lineHeight:1.6}}>
          This entry looks similar to {matches.length} existing {matches.length===1?"entry":"entries"}:
        </div>
        {matches.map((m,i)=>(
          <div key={i} style={{background:"#fdecea",borderRadius:10,padding:"10px 14px",marginBottom:8,fontSize:12}}>
            <div style={{fontWeight:700}}>{m.vendor} · {m.date} · {fmt(m.amount)}</div>
            <div style={{color:"#64748b",marginTop:2}}>{m.description} · {m.serial}</div>
          </div>
        ))}
        <div style={{marginTop:14}}>
          <label style={{...lbl,color:"#dc2626"}}>Reason this is NOT a duplicate * (required to proceed)</label>
          <textarea style={{...inp,borderColor:"#fca5a5",resize:"vertical"}} rows={2}
            placeholder="e.g. Second payment for same contractor, different work phase"
            value={reason} onChange={e=>setReason(e.target.value)}/>
        </div>
        <div style={{display:"flex",gap:10,marginTop:14}}>
          <button onClick={onReject} style={{flex:1,padding:"12px 0",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer"}}>← Go Back</button>
          <button onClick={()=>{if(!reason.trim()){alert("Please enter a reason");return;}onAccept(reason);}}
            style={{flex:2,padding:"12px 0",background:"#dc2626",color:"white",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>
            Save Anyway →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD CATEGORY MODAL ───────────────────────────────────────────────────────
function AddCategoryModal({onAdd,onClose}) {
  const [name,setName] = useState("");
  const [icon,setIcon] = useState("📦");
  const [color,setColor] = useState("#6B7280");
  const icons = ["📦","🏗️","🪵","🔨","💡","🚿","🏠","💰","📋","🔑","🌿","🎨"];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:10002,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,padding:24}}>
        <div style={{width:36,height:4,background:"#e2e8f0",borderRadius:2,margin:"0 auto 16px"}}/>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,marginBottom:16}}>Add New Category</div>
        <label style={lbl}>Category Name *</label>
        <input style={{...inp,marginBottom:14}} placeholder="e.g. Landscaping" value={name} onChange={e=>setName(e.target.value)}/>
        <label style={lbl}>Icon</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
          {icons.map(ic=><button key={ic} onClick={()=>setIcon(ic)} style={{width:40,height:40,fontSize:20,background:icon===ic?"#eef2ff":"#f8fafc",border:`2px solid ${icon===ic?"#4f46e5":"#e2e8f0"}`,borderRadius:10,cursor:"pointer"}}>{ic}</button>)}
        </div>
        <label style={lbl}>Color</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
          {CAT_COLORS.map(c=><button key={c} onClick={()=>setColor(c)} style={{width:32,height:32,background:c,border:`3px solid ${color===c?"#0f172a":"transparent"}`,borderRadius:8,cursor:"pointer"}}/>)}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"12px 0",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{if(!name.trim()){alert("Enter a name");return;}onAdd({id:"custom_"+Date.now(),label:name.trim(),icon,color,items:["Other"],units:["LS","Nos"],custom:true});}}
            style={{flex:2,padding:"12px 0",background:"#0f172a",color:"white",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>Add Category</button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD ITEM MODAL ───────────────────────────────────────────────────────────
function AddItemModal({categoryLabel,onAdd,onClose}) {
  const [name,setName] = useState("");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:10002,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,padding:24}}>
        <div style={{width:36,height:4,background:"#e2e8f0",borderRadius:2,margin:"0 auto 16px"}}/>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,marginBottom:4}}>Add Item</div>
        <div style={{fontSize:12,color:"#64748b",marginBottom:16}}>Adding to: {categoryLabel}</div>
        <label style={lbl}>Item Name *</label>
        <input style={{...inp,marginBottom:20}} placeholder="e.g. Hollow Core Slab" value={name} onChange={e=>setName(e.target.value)} autoFocus/>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"12px 0",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{if(!name.trim()){alert("Enter item name");return;}onAdd(name.trim());}}
            style={{flex:2,padding:"12px 0",background:"#0f172a",color:"white",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>Add Item</button>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function AdminPanel({users,onUpdateUsers,onClose,pop}) {
  const [localUsers,setLocalUsers] = useState(users.map(u=>({...u})));
  const [adding,setAdding] = useState(false);
  const [newUser,setNewUser] = useState({name:"",pin:"",isAdmin:false,avatar:"👤"});
  const avatars = ["👨‍💼","👩‍💼","👷","📊","👑","🧑‍🔧","👩‍🦱","👩‍🦳","🧑‍💻","👨‍🏫"];

  const save = async () => {
    onUpdateUsers(localUsers);
    await callScript({action:"saveConfig",key:"users",value:JSON.stringify(localUsers)});
    pop("Users saved ✓"); onClose();
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:10001,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",padding:24}}>
        <div style={{width:36,height:4,background:"#e2e8f0",borderRadius:2,margin:"0 auto 16px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800}}>👑 Admin Settings</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#94a3b8"}}>✕</button>
        </div>
        <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>Team Members</div>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
          {localUsers.map((u,i)=>(
            <div key={u.id} style={{background:"#f8fafc",borderRadius:12,padding:"12px 14px",border:"1.5px solid #e2e8f0"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{fontSize:22}}>{u.avatar}</div>
                <input value={u.name} onChange={e=>setLocalUsers(ls=>ls.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
                  style={{...inp,padding:"6px 10px",fontSize:13,flex:1}}/>
                <button onClick={()=>setLocalUsers(ls=>ls.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#fca5a5",fontSize:18,cursor:"pointer"}}>✕</button>
              </div>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,color:"#94a3b8",marginBottom:3}}>PIN</div>
                  <input value={u.pin} maxLength={4} onChange={e=>setLocalUsers(ls=>ls.map((x,j)=>j===i?{...x,pin:e.target.value.replace(/\D/g,"")}:x))}
                    style={{...inp,padding:"6px 10px",fontSize:13,letterSpacing:4}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,color:"#94a3b8",marginBottom:3}}>Role</div>
                  <select value={u.isAdmin?"admin":"member"} onChange={e=>setLocalUsers(ls=>ls.map((x,j)=>j===i?{...x,isAdmin:e.target.value==="admin"}:x))}
                    style={{...inp,padding:"6px 10px",fontSize:13}}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
        {adding?(
          <div style={{background:"#f0f9ff",borderRadius:12,padding:14,border:"1.5px solid #bae6fd",marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:"#0369a1",marginBottom:10}}>New Member</div>
            <input style={{...inp,marginBottom:8}} placeholder="Full name" value={newUser.name} onChange={e=>setNewUser(p=>({...p,name:e.target.value}))}/>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <input style={{...inp,letterSpacing:4}} placeholder="PIN (4 digits)" maxLength={4} value={newUser.pin} onChange={e=>setNewUser(p=>({...p,pin:e.target.value.replace(/\D/g,"")}))}/>
              <select style={inp} value={newUser.isAdmin?"admin":"member"} onChange={e=>setNewUser(p=>({...p,isAdmin:e.target.value==="admin"}))}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setAdding(false)} style={{flex:1,padding:"10px 0",background:"#f1f5f9",border:"none",borderRadius:9,fontWeight:600,cursor:"pointer",color:"#475569"}}>Cancel</button>
              <button onClick={()=>{
                if(!newUser.name||newUser.pin.length!==4){alert("Name and 4-digit PIN required");return;}
                setLocalUsers(ls=>[...ls,{...newUser,id:"user_"+Date.now()}]);
                setAdding(false); setNewUser({name:"",pin:"",isAdmin:false,avatar:"👤"});
              }} style={{flex:2,padding:"10px 0",background:"#0f172a",border:"none",borderRadius:9,fontWeight:700,cursor:"pointer",color:"white"}}>Add</button>
            </div>
          </div>
        ):(
          <button onClick={()=>setAdding(true)} style={{width:"100%",padding:"11px 0",background:"#f0f9ff",color:"#0369a1",border:"1.5px dashed #bae6fd",borderRadius:10,fontWeight:600,cursor:"pointer",marginBottom:16,fontSize:13}}>+ Add New Member</button>
        )}
        <div style={{background:"#fff8e6",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#9a6400",marginBottom:16}}>
          ⚠️ PIN changes take effect immediately on next login.
        </div>
        <button onClick={save} style={{width:"100%",padding:"14px 0",background:"#0f172a",color:"white",border:"none",borderRadius:12,fontWeight:700,fontSize:15,cursor:"pointer"}}>Save Changes</button>
      </div>
    </div>
  );
}

// ─── DIARY IMPORT ─────────────────────────────────────────────────────────────
function DiaryImport({currentUser,categories,onImported,onClose}) {
  const [step,setStep] = useState("upload");
  const [preview,setPreview] = useState(null);
  const [b64,setB64] = useState(null);
  const [rows,setRows] = useState([]);
  const fileRef = useRef();

  const onFile = async f => {
    const reader = new FileReader();
    reader.onload = async x => {
      const compressed = await compressImage(x.target.result);
      setPreview(compressed);
      setB64(compressed.split(",")[1]);
    };
    reader.readAsDataURL(f);
  };

  const scan = async () => {
    setStep("scanning");
    try {
      const text = await callAI([{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:"image/jpeg",data:b64}},
        {type:"text",text:`This is a page from a construction expense diary/register. Extract ALL expense entries visible. Each entry has: date, vendor/party name, amount, and possibly description. May be English, Hindi, or Gujarati.\nReturn ONLY a JSON array (no markdown):\n[{"date":"YYYY-MM-DD or empty","vendor":"string","amount":number or null,"description":"string","paymentMode":"Cash|UPI|Cheque|NEFT/RTGS|Card or empty","confidence":"High|Medium|Low"}]`}
      ]}],2000);
      const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
      const enriched = await Promise.all(parsed.map(async(row,i)=>{
        let category="misc";
        try {
          const ct = await callAI([{role:"user",content:`Construction expense. Description: "${row.description}". Vendor: "${row.vendor}". Return ONLY JSON: {"category":"steel|cement|rawmaterial|contractor|architect|lawyer|labour|electrical|plumbing|transport|government|equipment|interior|misc"}`}],150);
          const cp = JSON.parse(ct.replace(/```json|```/g,"").trim());
          if(categories.find(c=>c.id===cp.category)) category=cp.category;
        } catch {}
        return {...row,id:i,category,item:row.description||"Other",qty:"",unit:"LS",billNumber:"",notes:"",include:true};
      }));
      setRows(enriched); setStep("review");
    } catch { setStep("upload"); alert("Could not read page. Try a clearer photo."); }
  };

  const upd = (id,k,v) => setRows(rs=>rs.map(r=>r.id===id?{...r,[k]:v}:r));

  const getIssues = row => {
    const issues=[];
    if(!row.vendor?.trim()) issues.push("Vendor name is missing");
    if(!row.amount) issues.push("Amount is missing");
    return issues;
  };

  const doImport = async () => {
    setStep("importing");
    const toImport = rows.filter(r=>r.include&&getIssues(r).length===0);
    for(const row of toImport) {
      const desc=[row.item,row.qty&&row.unit?`${row.qty} ${row.unit}`:""].filter(Boolean).join(" · ");
      const cat=categories.find(c=>c.id===row.category);
      await callScript({action:"append",row:[nowStr(),row.date,cat?.label||"",row.item,row.qty,row.unit,desc,row.amount||0,row.vendor,row.paymentMode||"Cash",row.billNumber||"N/A","No",`[Diary Import] ${row.notes||""}`,currentUser.name,currentUser.isAdmin?"Admin":"Member","imported","","","",""]});
    }
    onImported(toImport.map(r=>{
      const desc=[r.item,r.qty&&r.unit?`${r.qty} ${r.unit}`:""].filter(Boolean).join(" · ");
      return {id:Date.now()+r.id,ts:nowStr(),date:r.date,category:r.category,item:r.item,qty:r.qty,unit:r.unit,description:desc,amount:r.amount||0,vendor:r.vendor,paymentMode:r.paymentMode||"Cash",billNumber:r.billNumber||"N/A",hasBill:"No",notes:`[Diary Import] ${r.notes||""}`,loggedBy:currentUser.name,loggedById:currentUser.id,status:"imported",history:[],billPreview:null,driveLink:null,serial:"",dupFlag:false};
    }));
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:10001,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"white",zIndex:1}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800}}>📔 Diary Import</div>
            <div style={{fontSize:11,color:"#64748b"}}>Photo → AI reads → you review → import</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#94a3b8"}}>✕</button>
        </div>
        <div style={{padding:20}}>
          {step==="upload"&&<>
            <div style={{border:"2px dashed #cbd5e1",borderRadius:14,padding:32,textAlign:"center",background:"#f8fafc",marginBottom:14}}>
              {preview
                ?<img src={preview} alt="page" style={{maxHeight:200,maxWidth:"100%",borderRadius:8,objectFit:"contain"}}/>
                :<><div style={{fontSize:36,marginBottom:8}}>📖</div><div style={{fontWeight:600,color:"#4f46e5",fontSize:14}}>Upload diary/register page</div><div style={{fontSize:12,color:"#94a3b8",marginTop:4}}>English · Hindi · Gujarati · Any format</div></>}
            </div>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              <UploadButton onFile={onFile} label="📸 Camera / Gallery" style={{flex:1}}/>
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)onFile(f);}}/>
            <div style={{background:"#f0f9ff",border:"1.5px solid #bae6fd",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#0369a1",marginBottom:14,lineHeight:1.6}}>
              💡 Good light, page flat, one page at a time. You review all entries before anything saves.
            </div>
            {preview&&<button onClick={scan} style={{width:"100%",padding:"14px 0",background:"linear-gradient(135deg,#4f46e5,#7c3aed)",color:"white",border:"none",borderRadius:12,fontWeight:700,fontSize:15,cursor:"pointer"}}>✨ Extract All Entries</button>}
          </>}

          {step==="scanning"&&<div style={{textAlign:"center",padding:"40px 0"}}>
            <div style={{fontSize:44,marginBottom:12}}>📖</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:800,marginBottom:6}}>Reading page…</div>
            <div style={{fontSize:13,color:"#64748b"}}>Extracting entries and guessing categories</div>
          </div>}

          {step==="review"&&(()=>{
            const included = rows.filter(r=>r.include);
            const blocked = included.filter(r=>getIssues(r).length>0);
            const readyCount = included.filter(r=>getIssues(r).length===0).length;
            const canImport = blocked.length===0 && readyCount>0;
            return <>
              <div style={{background:"#f8fafc",borderRadius:12,padding:"12px 14px",marginBottom:14,border:"1.5px solid #e2e8f0"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <div style={{fontWeight:700,fontSize:14}}>{rows.length} entries found</div>
                  <div style={{fontWeight:800,color:"#4f46e5"}}>{fmt(included.reduce((s,r)=>s+(r.amount||0),0))}</div>
                </div>
                <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:"#e6faf2",color:"#0f7a4a",fontWeight:600}}>✓ {readyCount} ready</span>
                  {blocked.length>0&&<span style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:"#fdecea",color:"#c0392b",fontWeight:600}}>⚠ {blocked.length} need fixing</span>}
                </div>
              </div>

              {rows.map(row=>{
                const issues=getIssues(row);
                const hasIssues=issues.length>0;
                const isLow=row.confidence==="Low";
                const state=!row.include?"skipped":hasIssues?"issues":isLow?"warn":"ok";
                const styles={skipped:["#e2e8f0","#f8fafc","#f1f5f9","#94a3b8","Skipped"],issues:["#fca5a5","#fff8f8","#fdecea","#c0392b",`⚠ Fix required — ${issues.join(" · ")}`],warn:["#fde68a","#fffdf0","#fff8e6","#9a6400","⚠ Low confidence — verify all fields"],ok:["#a7f3d0","white","#e6faf2","#0f7a4a","✓ Ready to import"]};
                const [border,bg,hbg,hcolor,hlabel]=styles[state];
                return (
                  <div key={row.id} style={{border:`2px solid ${border}`,borderRadius:14,marginBottom:12,overflow:"hidden",opacity:row.include?1:.55}}>
                    <div style={{background:hbg,padding:"8px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <input type="checkbox" checked={row.include} onChange={e=>upd(row.id,"include",e.target.checked)} style={{width:18,height:18}}/>
                        <span style={{fontSize:11,fontWeight:700,color:hcolor}}>{hlabel}</span>
                      </div>
                      <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:20,background:"white",color:hcolor}}>{row.confidence}</span>
                    </div>
                    <div style={{padding:12,background:bg,display:"flex",flexDirection:"column",gap:10}}>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <label style={{...lbl,marginBottom:0,color:!row.vendor?.trim()?"#c0392b":"#64748b"}}>Vendor *</label>
                          {!row.vendor?.trim()&&<span style={{fontSize:10,color:"#c0392b",fontWeight:700}}>Required</span>}
                        </div>
                        <input style={{...inp,padding:"9px 12px",borderColor:!row.vendor?.trim()?"#fca5a5":"#e2e8f0",background:!row.vendor?.trim()?"#fff8f8":"white"}}
                          placeholder="Who was paid? (required)" value={row.vendor||""} onChange={e=>upd(row.id,"vendor",e.target.value)}/>
                      </div>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <label style={{...lbl,marginBottom:0,color:!row.amount?"#c0392b":"#64748b"}}>Amount ₹ *</label>
                          {!row.amount&&<span style={{fontSize:10,color:"#c0392b",fontWeight:700}}>Required</span>}
                        </div>
                        <input style={{...inp,padding:"9px 12px",fontSize:15,fontWeight:700,borderColor:!row.amount?"#fca5a5":"#e2e8f0",background:!row.amount?"#fff8f8":"white"}}
                          type="number" inputMode="decimal" placeholder="Enter amount" value={row.amount||""}
                          onChange={e=>upd(row.id,"amount",e.target.value?parseFloat(e.target.value):null)}/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <div>
                          <label style={{...lbl,marginBottom:4}}>Date</label>
                          <input style={{...inp,padding:"9px 10px",fontSize:12}} type="date" value={row.date||""} onChange={e=>upd(row.id,"date",e.target.value)}/>
                        </div>
                        <div>
                          <label style={{...lbl,marginBottom:4}}>Category</label>
                          <select style={{...inp,padding:"9px 10px",fontSize:12}} value={row.category} onChange={e=>upd(row.id,"category",e.target.value)}>
                            {categories.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label style={{...lbl,marginBottom:4}}>Payment <span style={{color:"#94a3b8",fontWeight:400,fontSize:9,textTransform:"none"}}>(defaults to Cash)</span></label>
                        <select style={{...inp,padding:"9px 12px"}} value={row.paymentMode||"Cash"} onChange={e=>upd(row.id,"paymentMode",e.target.value)}>
                          {PAYMENT_MODES.filter(m=>m).map(m=><option key={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{...lbl,marginBottom:4}}>Description / Notes</label>
                        <input style={{...inp,padding:"9px 12px"}} placeholder="What was this for?" value={row.item||""} onChange={e=>upd(row.id,"item",e.target.value)}/>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div style={{position:"sticky",bottom:0,background:"white",padding:"12px 0 4px"}}>
                {!canImport&&blocked.length>0&&<div style={{background:"#fdecea",border:"1.5px solid #fca5a5",borderRadius:10,padding:"9px 14px",fontSize:12,color:"#c0392b",fontWeight:600,marginBottom:10,textAlign:"center"}}>Fix or skip {blocked.length} row{blocked.length>1?"s":""} before importing</div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setStep("upload")} style={{flex:1,padding:"13px 0",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:11,fontWeight:600,cursor:"pointer"}}>← Retake</button>
                  <button onClick={doImport} disabled={!canImport}
                    style={{flex:2,padding:"13px 0",background:canImport?"#0f172a":"#e2e8f0",color:canImport?"white":"#94a3b8",border:"none",borderRadius:11,fontWeight:700,fontSize:14,cursor:canImport?"pointer":"not-allowed"}}>
                    {canImport?`Import ${readyCount} Entries →`:`Fix ${blocked.length} issue${blocked.length>1?"s":""} first`}
                  </button>
                </div>
              </div>
            </>;
          })()}

          {step==="importing"&&<div style={{textAlign:"center",padding:"40px 0"}}>
            <div style={{fontSize:40,marginBottom:12}}>⏳</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,marginBottom:4}}>Saving to Sheet…</div>
          </div>}
        </div>
      </div>
    </div>
  );
}

// ─── EDIT MODAL ───────────────────────────────────────────────────────────────
function EditModal({expense,categories,onSave,onClose}) {
  const [ef,setEf] = useState({...expense});
  const [reason,setReason] = useState("");
  const ec = categories.find(c=>c.id===ef.category)||{};
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:10001,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",padding:24}}>
        <div style={{width:36,height:4,background:"#e2e8f0",borderRadius:2,margin:"0 auto 16px"}}/>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,marginBottom:4}}>Edit Entry</div>
        <div style={{fontSize:12,color:"#94a3b8",marginBottom:16}}>Original preserved in audit log</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><label style={lbl}>Date</label><input style={inp} type="date" value={ef.date} onChange={e=>setEf(p=>({...p,date:e.target.value}))}/></div>
            <div><label style={lbl}>Amount ₹</label><input style={inp} type="number" value={ef.amount} onChange={e=>setEf(p=>({...p,amount:e.target.value}))} inputMode="decimal"/></div>
          </div>
          <div><label style={lbl}>Item</label>
            <select style={inp} value={ef.item} onChange={e=>setEf(p=>({...p,item:e.target.value}))}>
              {(ec.items||[]).map(i=><option key={i}>{i}</option>)}
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><label style={lbl}>Qty</label><input style={inp} value={ef.qty} onChange={e=>setEf(p=>({...p,qty:e.target.value}))}/></div>
            <div><label style={lbl}>Unit</label><select style={inp} value={ef.unit} onChange={e=>setEf(p=>({...p,unit:e.target.value}))}>{(ec.units||[]).map(u=><option key={u}>{u}</option>)}</select></div>
          </div>
          <div><label style={lbl}>Vendor *</label><input style={inp} value={ef.vendor} onChange={e=>setEf(p=>({...p,vendor:e.target.value}))}/></div>
          <div><label style={lbl}>Payment</label>
            <select style={inp} value={ef.paymentMode} onChange={e=>setEf(p=>({...p,paymentMode:e.target.value}))}>
              {PAYMENT_MODES.filter(m=>m).map(m=><option key={m}>{m}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Notes</label><textarea style={{...inp,resize:"vertical"}} rows={2} value={ef.notes} onChange={e=>setEf(p=>({...p,notes:e.target.value}))}/></div>
          <div style={{borderTop:"1.5px solid #f1f5f9",paddingTop:12}}>
            <label style={{...lbl,color:"#dc2626"}}>Reason for edit * (audit log)</label>
            <textarea style={{...inp,borderColor:"#fca5a5",resize:"vertical"}} rows={2} placeholder="e.g. Correcting amount from ₹12,000 to ₹15,000" value={reason} onChange={e=>setReason(e.target.value)}/>
          </div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:16}}>
          <button onClick={onClose} style={{flex:1,padding:"12px 0",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer"}}>Cancel</button>
          <button onClick={()=>{if(!reason.trim()){alert("Reason required");return;}onSave(ef,reason);}}
            style={{flex:2,padding:"12px 0",background:"#0f172a",color:"white",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>Save Edit</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [appState,setAppState] = useState("loading");
  const [users,setUsers] = useState(DEFAULT_USERS);
  const [categories,setCategories] = useState(DEFAULT_CATEGORIES);
  const [pinTarget,setPinTarget] = useState(null);
  const [user,setUser] = useState(null);
  const [expenses,setExpenses] = useState([]);
  const [form,setForm] = useState(BLANK);
  const [billMode,setBillMode] = useState("vendor");
  const [billB64,setBillB64] = useState(null);
  const [billPreview,setBillPreview] = useState(null);
  const [billScanned,setBillScanned] = useState(false);
  const [showScanner,setShowScanner] = useState(false);
  const [billWarns,setBillWarns] = useState({});
  const [activeTab,setActiveTab] = useState("entry");
  const [toast,setToast] = useState(null);
  const [cancelTarget,setCancelTarget] = useState(null);
  const [cancelReason,setCancelReason] = useState("");
  const [editTarget,setEditTarget] = useState(null);
  const [showAdmin,setShowAdmin] = useState(false);
  const [showDiary,setShowDiary] = useState(false);
  const [showAddCat,setShowAddCat] = useState(false);
  const [showAddItem,setShowAddItem] = useState(false);
  const [dupMatches,setDupMatches] = useState(null);
  const [pendingSave,setPendingSave] = useState(null);
  // Log filters
  const [filterCat,setFilterCat] = useState("all");
  const [filterVendor,setFilterVendor] = useState("");
  const [filterDateFrom,setFilterDateFrom] = useState("");
  const [filterDateTo,setFilterDateTo] = useState("");

  const pop = useCallback((msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),4000);},[]);
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));
  const buildDesc = () => [form.item,form.qty&&form.unit?`${form.qty} ${form.unit}`:form.qty||""].filter(Boolean).join(" · ");
  const canAct = exp => user?.isAdmin || exp.loggedById===user?.id;
  const cat = categories.find(c=>c.id===form.category)||{};

  // ── Startup: load config + entries ──
  useEffect(()=>{
    const init = async () => {
      try {
        const s = JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");

        // Load config and data in parallel
        const [configResult, dataResult] = await Promise.all([
          callScript({action:"getConfig"}),
          callScript({action:"getData"})
        ]);

        // Use local vars so category mapping works immediately
        let activeUsers = DEFAULT_USERS;
        let activeCats = DEFAULT_CATEGORIES;

        if(configResult.ok&&configResult.data) {
          try{const u=JSON.parse(configResult.data.users||"null");if(u){setUsers(u);activeUsers=u;}}catch{}
          try{const c=JSON.parse(configResult.data.categories||"null");if(c){setCategories(c);activeCats=c;}}catch{}
        }

        // Parse sheet rows using local activeCats — not stale React state
        if(dataResult.ok&&dataResult.data&&Array.isArray(dataResult.data)) {
          const loaded = dataResult.data.map((row,i)=>{
            // Find category by label match
            const catLabel = String(row[2]||"");
            const catMatch = activeCats.find(c=>c.label===catLabel);
            return {
              id: String(row[0]||"")+i,
              ts: String(row[0]||""),
              date: String(row[1]||""),
              category: catMatch?.id||"misc",
              item: String(row[3]||""),
              qty: String(row[4]||""),
              unit: String(row[5]||""),
              description: String(row[6]||""),
              amount: parseFloat(row[7])||0,
              vendor: String(row[8]||""),
              paymentMode: String(row[9]||"Cash"),
              billNumber: String(row[10]||"N/A"),
              hasBill: String(row[11]||"No"),
              notes: String(row[12]||""),
              loggedBy: String(row[13]||""),
              loggedById: "",
              status: String(row[15]||"active"),
              serial: String(row[18]||""),
              driveLink: String(row[19]||""),
              dupFlag: String(row[20]||"")==="true",
              history:[], billPreview:null
            };
          }).filter(r=>r.vendor||r.amount>0); // must have vendor or amount
          setExpenses(loaded);
        }

        // Restore session
        if(s&&s.until>Date.now()) {
          const u = activeUsers.find(x=>x.id===s.id);
          if(u){setUser(u);setAppState("main");return;}
        }
      } catch(e){console.error("Init error:",e);}
      setAppState("login");
    };
    init();
  },[]);

  // ── File handler ──
  const onFile = async f => {
    const reader = new FileReader();
    reader.onload = async x => {
      const compressed = await compressImage(x.target.result);
      setBillPreview(compressed);
      setBillB64(compressed.split(",")[1]);
      setBillScanned(false); setBillWarns({});
      setShowScanner(true);
    };
    reader.readAsDataURL(f);
  };

  // ── Bill extracted ──
  const onExtracted = res => {
    setShowScanner(false); setBillScanned(true);
    const warns={};
    const fill=(k,v)=>{if(v!==null&&v!==undefined&&v!==""){sf(k,String(v));warns[k]=true;}};
    fill("amount",res.amount);fill("vendor",res.vendor);fill("date",res.date);fill("billNumber",res.billNumber);
    if(res.category&&categories.find(c=>c.id===res.category)){sf("category",res.category);warns.category=true;}
    if(res.paymentMode&&PAYMENT_MODES.includes(res.paymentMode)){sf("paymentMode",res.paymentMode);warns.paymentMode=true;}
    if(res.item){const c=categories.find(x=>x.id===(res.category||form.category));const match=c?.items?.find(i=>i.toLowerCase().includes(res.item.toLowerCase().split(" ")[0]))||res.item;sf("item",match);warns.item=true;}
    if(res.qty){sf("qty",String(res.qty));warns.qty=true;}
    if(res.unit){const c=categories.find(x=>x.id===(res.category||form.category));const match=c?.units?.find(u=>u.toLowerCase()===res.unit.toLowerCase())||c?.units?.[0]||res.unit;sf("unit",match);warns.unit=true;}
    setBillWarns(warns);
    pop("Bill read — review the highlighted fields below","info");
  };

  const confirmAllWarns = () => setBillWarns({});
  const confirmWarn = k => setBillWarns(p=>({...p,[k]:false}));
  const allConfirmed = () => !Object.values(billWarns).some(v=>v);
  const hasWarnings = () => Object.values(billWarns).some(v=>v);

  // ── Duplicate check ──
  const checkDuplicates = (amount,vendor,date,billNumber) => {
    return expenses.filter(e=>{
      if(e.status==="cancelled") return false;
      const sameVendor = e.vendor?.toLowerCase()===vendor?.toLowerCase();
      const sameAmount = Math.abs(e.amount-parseFloat(amount||0))<1;
      const sameDate = e.date===date;
      if(sameVendor&&sameAmount&&sameDate) return true;
      if(billNumber&&billNumber!=="N/A"&&e.billNumber===billNumber) return true;
      return false;
    });
  };

  // ── Add custom category ──
  const addCategory = async newCat => {
    const updated=[...categories,newCat];
    setCategories(updated); setShowAddCat(false);
    await callScript({action:"saveConfig",key:"categories",value:JSON.stringify(updated)});
    pop("Category added ✓");
  };

  // ── Add custom item ──
  const addItem = async itemName => {
    const updated=categories.map(c=>c.id===form.category?{...c,items:[...c.items.filter(i=>i!=="Other"),itemName,"Other"]}:c);
    setCategories(updated); setShowAddItem(false); sf("item",itemName);
    await callScript({action:"saveConfig",key:"categories",value:JSON.stringify(updated)});
    pop("Item added ✓");
  };

  // ── Core save logic ──
  const executeSave = async (dupOverrideReason=null) => {
    const desc=buildDesc();
    const ts=nowStr();
    const serial=generateSerial(expenses);
    const hasBill=billMode!=="none"&&billB64?"Yes":"No";

    // Upload to Drive if bill present
    let driveLink="";
    if(hasBill==="Yes"&&billB64) {
      pop("Uploading bill to Drive…","info");
      const link = await uploadToDrive(billB64,`${serial}.jpg`,"image/jpeg");
      driveLink=link||"";
      if(!link) pop("Bill upload failed — entry saved without photo","warn");
    }

    const row=[ts,form.date,cat?.label||"",form.item,form.qty,form.unit,desc,parseFloat(form.amount),form.vendor,form.paymentMode,form.billNumber||"N/A",hasBill,form.notes,user.name,user.isAdmin?"Admin":"Member","active","","",serial,driveLink,dupOverrideReason?"true (override: "+dupOverrideReason+")":"false"];

    const exp={id:Date.now(),ts,date:form.date,category:form.category,item:form.item,qty:form.qty,unit:form.unit,description:desc,amount:parseFloat(form.amount),vendor:form.vendor,paymentMode:form.paymentMode,billNumber:form.billNumber||"N/A",hasBill,notes:form.notes,loggedBy:user.name,loggedById:user.id,status:"active",history:[],billPreview:hasBill==="Yes"?billPreview:null,driveLink,serial,dupFlag:!!dupOverrideReason};

    setExpenses(p=>[exp,...p]);
    const r=await callScript({action:"append",row});
    if(r.demo) pop(`✓ Logged · ${serial}`);
    else if(r.ok) pop(`✓ Saved to Sheet · ${serial}`);
    else pop("Saved locally — sheet sync failed","error");

    setForm(BLANK); setBillMode("vendor"); setBillB64(null); setBillPreview(null);
    setBillScanned(false); setBillWarns({}); setDupMatches(null); setPendingSave(null);
  };

  // ── Save with duplicate check ──
  const handleSave = async () => {
    if(!form.item||!form.category){pop("Select category and item","error");return;}
    if(!form.amount){pop("Enter amount","error");return;}
    if(!form.vendor?.trim()){pop("Vendor name is required","error");return;}
    if(!form.paymentMode){pop("Select payment method","error");return;}
    if(billMode!=="none"&&billB64&&!billScanned){pop("Please scan the bill first","warn");return;}
    if(billMode!=="none"&&billScanned&&!allConfirmed()){pop("Confirm all yellow fields first","warn");return;}

    const dups=checkDuplicates(form.amount,form.vendor,form.date,form.billNumber);
    if(dups.length>0){setDupMatches(dups);setPendingSave(true);return;}
    await executeSave();
  };

  // ── Cancel ──
  const doCancel = () => {
    if(!cancelReason.trim()){pop("Enter a reason","error");return;}
    const ts=nowStr();
    setExpenses(p=>p.map(e=>e.id===cancelTarget.id?{...e,status:"cancelled",cancelledBy:user.name,cancelledAt:ts,cancelReason,history:[...(e.history||[]),{type:"cancelled",by:user.name,at:ts,note:cancelReason}]}:e));
    callScript({action:"append",row:[ts,"","","","","","","","","","","","",user.name,"","cancelled",cancelReason,cancelTarget.id,cancelTarget.serial,"",""]});
    pop("Entry cancelled"); setCancelTarget(null); setCancelReason("");
  };

  // ── Edit ──
  const doEdit = (updated,reason) => {
    const ts=nowStr();
    setExpenses(p=>p.map(e=>{
      if(e.id!==editTarget.id) return e;
      const newDesc=[updated.item,updated.qty&&updated.unit?`${updated.qty} ${updated.unit}`:""].filter(Boolean).join(" · ");
      return {...e,...updated,description:newDesc,status:"modified",lastEditBy:user.name,lastEditAt:ts,history:[...(e.history||[]),{type:"edited",by:user.name,at:ts,reason,before:{amount:e.amount,date:e.date,item:e.item}}]};
    }));
    callScript({action:"append",row:[ts,"","","","","","","","","","","","",user.name,"","modified",reason,editTarget.id,editTarget.serial,"",""]});
    pop("Entry updated"); setEditTarget(null);
  };

  // ── Filtered expenses ──
  const filtered = expenses.filter(e=>{
    if(filterCat!=="all"&&e.category!==filterCat) return false;
    if(filterVendor&&!e.vendor?.toLowerCase().includes(filterVendor.toLowerCase())) return false;
    if(filterDateFrom&&e.date<filterDateFrom) return false;
    if(filterDateTo&&e.date>filterDateTo) return false;
    return true;
  });
  const filteredActive = filtered.filter(e=>e.status!=="cancelled");
  const filteredTotal = filteredActive.reduce((s,e)=>s+e.amount,0);
  const grandTotal = expenses.filter(e=>e.status!=="cancelled").reduce((s,e)=>s+e.amount,0);
  const topCats = categories.map(c=>({...c,t:expenses.filter(e=>e.status!=="cancelled"&&e.category===c.id).reduce((s,e)=>s+e.amount,0)})).filter(c=>c.t>0).sort((a,b)=>b.t-a.t);
  const hasFilters = filterCat!=="all"||filterVendor||filterDateFrom||filterDateTo;

  // ─── LOGIN ──────────────────────────────────────────────────────────────────
  if(appState==="loading") return (
    <div style={{minHeight:"100vh",background:"#080d14",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{fontSize:40}}>🏗️</div>
      <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:"white"}}>School Build Tracker</div>
      <div style={{width:32,height:32,border:"3px solid #1a2640",borderTopColor:"#6366f1",borderRadius:"50%",animation:"spin 1s linear infinite",marginTop:8}}/>
      <div style={{fontSize:12,color:"#3d5270"}}>Loading…</div>
    </div>
  );

  if(appState==="login"||appState==="pin") return (
    <div style={{minHeight:"100vh",background:"radial-gradient(ellipse at 50% -10%,#1a2f5e,#080d14 60%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}.uc{cursor:pointer;border-radius:14px;padding:13px 16px;border:1.5px solid #1a2640;background:#0c1624;transition:all .18s;display:flex;align-items:center;gap:12px}.uc:active{background:#0d1e35;border-color:#4f46e5}`}</style>
      <div style={{maxWidth:360,width:"100%",textAlign:"center"}}>
        {pinTarget?(
          <PinScreen user={pinTarget} onSuccess={()=>{setUser(pinTarget);setAppState("main");}} onBack={()=>{setPinTarget(null);setAppState("login");}}/>
        ):(
          <>
            <div style={{fontSize:40,marginBottom:10}}>🏗️</div>
            <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:"white",marginBottom:4}}>School Build Tracker</h1>
            <p style={{color:"#3d5270",fontSize:12,marginBottom:24}}>Shree Sanskaar Public Education Trust</p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {users.map(u=>(
                <div key={u.id} className="uc" onClick={()=>{setPinTarget(u);setAppState("pin");}}>
                  <Av u={u} s={38}/>
                  <div style={{textAlign:"left"}}>
                    <div style={{color:"white",fontWeight:700,fontSize:13}}>{u.name}</div>
                    <div style={{color:"#3d5270",fontSize:11}}>{u.isAdmin?"Admin":"Member"}</div>
                  </div>
                  <div style={{marginLeft:"auto",color:"#4f46e5",fontSize:16}}>→</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ─── MAIN ──────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",minHeight:"100vh",background:"#f1f5f9",color:"#0f172a",maxWidth:600,margin:"0 auto",position:"relative"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{-webkit-text-size-adjust:100%;text-size-adjust:100%}
        input,select,textarea{font-family:inherit;color:#0f172a;-webkit-appearance:none;appearance:none;font-size:16px}
        input:focus,select:focus,textarea:focus{outline:none;border-color:#4f46e5!important;box-shadow:0 0 0 3px #4f46e515}
        button{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
        .erow{border-bottom:1px solid #f1f5f9}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        ::-webkit-scrollbar{display:none}
        select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px!important}
      `}</style>

      {/* Header — fixed height, no reflow */}
      <div style={{background:"linear-gradient(135deg,#080d14,#0f172a)",padding:"12px 16px",position:"sticky",top:0,zIndex:100,minHeight:52}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:28}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18,lineHeight:1}}>🏗️</span>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:800,color:"white",lineHeight:1.2}}>School Build Tracker</div>
              <div style={{fontSize:10,color:"#2d3f5a",lineHeight:1.2}}>Shree Sanskaar · {fmt(grandTotal)}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {user.isAdmin&&<button onClick={()=>setShowAdmin(true)} style={{background:"#1a2235",border:"none",color:"#818cf8",fontSize:11,padding:"5px 10px",borderRadius:8,cursor:"pointer",fontWeight:600,lineHeight:1}}>⚙️ Admin</button>}
            <div style={{display:"flex",alignItems:"center",gap:5,padding:"5px 10px",background:"#1a2235",borderRadius:20,cursor:"pointer"}} onClick={()=>{sessionStorage.removeItem(SESSION_KEY);setUser(null);setAppState("login");}}>
              <Av u={user} s={20}/>
              <span style={{fontSize:11,color:"#cbd5e1",fontWeight:600,maxWidth:65,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.name.split(" ")[0]}</span>
              <span style={{fontSize:10,color:"#3d5270"}}>↩</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar — fixed height */}
      <div style={{background:"white",borderBottom:"1px solid #e2e8f0",display:"flex",position:"sticky",top:52,zIndex:99,minHeight:44}}>
        {[["entry","✏️ Entry"],["log","📋 Log"],["audit","🔍 Audit"]].map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id)}
            style={{flex:1,padding:"0",height:44,background:"none",border:"none",borderBottom:`2.5px solid ${activeTab===id?"#4f46e5":"transparent"}`,color:activeTab===id?"#4f46e5":"#64748b",fontSize:13,fontWeight:activeTab===id?700:500,cursor:"pointer",fontFamily:"inherit",lineHeight:"44px"}}>
            {label}
          </button>
        ))}
      </div>

      <div style={{padding:16}}>

        {/* ── ENTRY TAB ── */}
        {activeTab==="entry"&&<>
          {/* Two options */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
            <div style={{background:"white",borderRadius:14,padding:16,boxShadow:"0 2px 10px rgba(0,0,0,.06)",border:"1.5px solid #e2e8f0",textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:6}}>✏️</div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>New Expense</div>
              <div style={{fontSize:11,color:"#64748b"}}>Log a single entry</div>
            </div>
            <div style={{background:"white",borderRadius:14,padding:16,boxShadow:"0 2px 10px rgba(0,0,0,.06)",border:"1.5px solid #bae6fd",textAlign:"center",cursor:"pointer"}} onClick={()=>setShowDiary(true)}>
              <div style={{fontSize:28,marginBottom:6}}>📔</div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:4,color:"#0369a1"}}>Diary Import</div>
              <div style={{fontSize:11,color:"#64748b"}}>Photo → AI reads page</div>
            </div>
          </div>

          {/* Form */}
          <div style={{background:"white",borderRadius:16,padding:18,boxShadow:"0 2px 10px rgba(0,0,0,.06)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:800,marginBottom:2}}>New Expense</div>
            <div style={{fontSize:11,color:"#94a3b8",marginBottom:16}}>Logging as <strong style={{color:"#4f46e5"}}>{user.name}</strong></div>

            {/* Bill selector */}
            <div style={{marginBottom:16}}>
              <label style={lbl}>Bill / Receipt</label>
              <div style={{display:"flex",gap:6}}>
                {[["none","No Bill"],["vendor","📄 Vendor Bill"],["trust","📋 Trust Receipt"]].map(([id,label])=>(
                  <button key={id} onClick={()=>{setBillMode(id);if(id==="none"){setBillB64(null);setBillPreview(null);setBillScanned(false);setBillWarns({});}}}
                    style={{flex:1,padding:"9px 4px",background:billMode===id?id==="trust"?"#4f46e5":"#0f172a":"#f8fafc",color:billMode===id?"white":"#64748b",border:`1.5px solid ${billMode===id?id==="trust"?"#4f46e5":"#0f172a":"#e2e8f0"}`,borderRadius:9,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bill upload */}
            {billMode!=="none"&&(
              <div style={{marginBottom:16}}>
                {!billPreview?(
                  <div style={{background:"#f0f9ff",border:"1.5px dashed #bae6fd",borderRadius:12,padding:16,textAlign:"center"}}>
                    <div style={{fontSize:12,color:"#0369a1",fontWeight:600,marginBottom:6}}>{billMode==="trust"?"Upload your Shree Sanskaar trust receipt":"Have a bill? Upload to auto-fill the form"}</div>
                    <div style={{fontSize:11,color:"#64748b",marginBottom:12,lineHeight:1.6}}>{billMode==="vendor"?"Works with Hindi, Gujarati, handwritten bills":"Trust receipt format is recognised automatically"}</div>
                    <UploadButton onFile={onFile} label="📸 Camera / Gallery / PDF"/>
                  </div>
                ):(
                  <div>
                    <img src={billPreview} alt="bill" style={{width:"100%",maxHeight:120,objectFit:"contain",borderRadius:10,border:"1.5px solid #e2e8f0",background:"#f8fafc",marginBottom:8}}/>
                    {!billScanned&&<button onClick={()=>setShowScanner(true)} style={{width:"100%",padding:"10px 0",background:"linear-gradient(135deg,#4f46e5,#7c3aed)",color:"white",border:"none",borderRadius:10,fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:6}}>🔍 Scan & Auto-fill</button>}
                    {billScanned&&!hasWarnings()&&<div style={{padding:"7px 11px",background:"#e6faf2",borderRadius:8,fontSize:12,color:"#0f7a4a",fontWeight:600,border:"1.5px solid #a7f3d0",marginBottom:6}}>✓ Bill confirmed — fill any missing fields below</div>}
                    {billScanned&&hasWarnings()&&(
                      <div style={{background:"#fff8e6",border:"1.5px solid #fde68a",borderRadius:10,padding:"10px 12px",marginBottom:6}}>
                        <div style={{fontSize:12,color:"#9a6400",fontWeight:600,marginBottom:8}}>⚠ Fields highlighted in yellow were read from the bill. Please review then confirm.</div>
                        <button onClick={confirmAllWarns} style={{width:"100%",padding:"9px 0",background:"#0f172a",color:"white",border:"none",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer"}}>✓ Looks Good — Confirm All Fields</button>
                      </div>
                    )}
                    <button onClick={()=>{setBillPreview(null);setBillB64(null);setBillScanned(false);setBillWarns({});}} style={{background:"none",border:"none",fontSize:11,color:"#94a3b8",cursor:"pointer",padding:0}}>Remove photo</button>
                  </div>
                )}
              </div>
            )}

            {/* Fields */}
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div>
                <label style={lbl}>Category *</label>
                <select className={billWarns.category?"warn-inp":""} style={billWarns.category?warnInp:inp} value={form.category}
                  onChange={e=>{const v=e.target.value;if(v==="__add__"){setShowAddCat(true);}else{sf("category",v);sf("item","");sf("unit","");}}}>
                  <option value="">— Select category —</option>
                  {categories.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                  <option value="__add__">+ Add new category…</option>
                </select>
              </div>

              {form.category&&<div>
                <label style={lbl}>Item *</label>
                <select className={billWarns.item?"warn-inp":""} style={billWarns.item?warnInp:inp} value={form.item}
                  onChange={e=>{const v=e.target.value;if(v==="__add__"){setShowAddItem(true);}else sf("item",v);}}>
                  <option value="">— Select item —</option>
                  {(cat.items||[]).map(i=><option key={i}>{i}</option>)}
                  <option value="__add__">+ Add new item…</option>
                </select>
              </div>}

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <label style={lbl}>Qty</label>
                  <input className={billWarns.qty?"warn-inp":""} style={billWarns.qty?warnInp:inp} type="number" placeholder="e.g. 5" value={form.qty} onChange={e=>sf("qty",e.target.value)} inputMode="decimal"/>
                </div>
                <div>
                  <label style={lbl}>Unit {cat.units&&<span style={{color:"#cbd5e1",fontWeight:400,fontSize:9,textTransform:"none"}}>({cat.units?.[0]})</span>}</label>
                  <select className={billWarns.unit?"warn-inp":""} style={billWarns.unit?warnInp:inp} value={form.unit} onChange={e=>sf("unit",e.target.value)}>
                    <option value="">—</option>
                    {(cat.units||["LS","Nos"]).map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {(form.item||form.qty)&&<div style={{background:"#e6faf2",border:"1.5px solid #a7f3d0",borderRadius:8,padding:"7px 11px",fontSize:12}}><span style={{color:"#64748b"}}>Saves as: </span><strong style={{color:"#0f7a4a"}}>{buildDesc()}</strong></div>}

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <label style={lbl}>Date *</label>
                  <input className={billWarns.date?"warn-inp":""} style={billWarns.date?warnInp:inp} type="date" value={form.date} onChange={e=>sf("date",e.target.value)}/>
                </div>
                <div>
                  <label style={lbl}>Amount ₹ *</label>
                  <input className={billWarns.amount?"warn-inp":""} style={{...(billWarns.amount?warnInp:inp),fontSize:16,fontWeight:700}} type="number" placeholder="0" value={form.amount} onChange={e=>sf("amount",e.target.value)} inputMode="decimal"/>
                </div>
              </div>

              <div>
                <label style={lbl}>Vendor / Party Name *</label>
                <input className={billWarns.vendor?"warn-inp":""} style={billWarns.vendor?warnInp:inp} type="text" placeholder="Required — who was paid?" value={form.vendor} onChange={e=>sf("vendor",e.target.value)}/>
              </div>

              <div>
                <label style={lbl}>Payment Method *</label>
                <select className={billWarns.paymentMode?"warn-inp":""} style={billWarns.paymentMode?warnInp:inp} value={form.paymentMode} onChange={e=>sf("paymentMode",e.target.value)}>
                  <option value="">— Select payment method —</option>
                  {PAYMENT_MODES.filter(m=>m).map(m=><option key={m}>{m}</option>)}
                </select>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <label style={lbl}>Bill / Receipt No.</label>
                  <input className={billWarns.billNumber?"warn-inp":""} style={billWarns.billNumber?warnInp:inp} placeholder="Leave blank if none" value={form.billNumber} onChange={e=>sf("billNumber",e.target.value)}/>
                </div>
                <div>
                  <label style={lbl}>Notes</label>
                  <input style={inp} placeholder="Any remark" value={form.notes} onChange={e=>sf("notes",e.target.value)}/>
                </div>
              </div>

              <button onClick={handleSave} style={{width:"100%",padding:"15px 0",background:"linear-gradient(135deg,#0c1117,#0f172a)",color:"white",border:"none",borderRadius:12,fontWeight:700,fontSize:15,cursor:"pointer",marginTop:4}}>→ Log Expense</button>
            </div>
          </div>

          {/* Breakdown */}
          {topCats.length>0&&<div style={{background:"white",borderRadius:16,padding:18,boxShadow:"0 2px 10px rgba(0,0,0,.06)",marginTop:16}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:800,marginBottom:14}}>Spend by Category</div>
            {topCats.map(c=>{
              const pct=Math.round(c.t/grandTotal*100);
              return <div key={c.id} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                  <span style={{fontWeight:600}}>{c.icon} {c.label}</span>
                  <span style={{fontWeight:700,color:c.color}}>{fmt(c.t)} <span style={{color:"#94a3b8",fontWeight:400}}>· {pct}%</span></span>
                </div>
                <div style={{height:6,background:"#f1f5f9",borderRadius:3}}><div style={{width:pct+"%",height:"100%",background:c.color,borderRadius:3,transition:"width .5s"}}/></div>
              </div>;
            })}
          </div>}
        </>}

        {/* ── LOG TAB ── */}
        {activeTab==="log"&&<>
          {/* Filters */}
          <div style={{background:"white",borderRadius:14,padding:14,marginBottom:14,boxShadow:"0 2px 8px rgba(0,0,0,.05)"}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🔍 Filter</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div>
                <label style={lbl}>Vendor Name</label>
                <input style={{...inp,padding:"8px 12px"}} placeholder="Search by vendor…" value={filterVendor} onChange={e=>setFilterVendor(e.target.value)}/>
              </div>
              <div>
                <label style={lbl}>Category</label>
                <select style={{...inp,padding:"8px 12px"}} value={filterCat} onChange={e=>setFilterCat(e.target.value)}>
                  <option value="all">All Categories</option>
                  {categories.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <label style={lbl}>Date From</label>
                  <input style={{...inp,padding:"8px 10px",fontSize:12}} type="date" value={filterDateFrom} onChange={e=>setFilterDateFrom(e.target.value)}/>
                </div>
                <div>
                  <label style={lbl}>Date To</label>
                  <input style={{...inp,padding:"8px 10px",fontSize:12}} type="date" value={filterDateTo} onChange={e=>setFilterDateTo(e.target.value)}/>
                </div>
              </div>
              {hasFilters&&<button onClick={()=>{setFilterCat("all");setFilterVendor("");setFilterDateFrom("");setFilterDateTo("");}} style={{padding:"8px 0",background:"#fdecea",color:"#c0392b",border:"none",borderRadius:8,fontWeight:600,fontSize:12,cursor:"pointer"}}>✕ Clear filters</button>}
            </div>
          </div>

          {/* Summary */}
          <div style={{background:"linear-gradient(135deg,#0f172a,#1e293b)",borderRadius:14,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:11,color:"#475569",fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>
                {hasFilters?"Filtered Total":"Total Expenses"}
              </div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:"#818cf8"}}>{fmt(filteredTotal)}</div>
              <div style={{fontSize:11,color:"#475569",marginTop:2}}>{filteredActive.length} active {hasFilters?"(filtered)":""} entries</div>
            </div>
            {hasFilters&&<div style={{textAlign:"right"}}>
              <div style={{fontSize:11,color:"#475569",fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>Grand Total</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,color:"#64748b"}}>{fmt(grandTotal)}</div>
            </div>}
          </div>

          {/* Export */}
          <button onClick={()=>{
            const hdr=["Serial","Timestamp","Date","Category","Description","Amount","Vendor","Payment","Bill No.","Has Bill","Drive Link","Notes","Status","Logged By","Duplicate Flag"];
            const rows=filtered.map(e=>[e.serial,e.ts,e.date,categories.find(c=>c.id===e.category)?.label,e.description,e.amount,e.vendor,e.paymentMode,e.billNumber,e.hasBill,e.driveLink||"",e.notes,e.status,e.loggedBy,e.dupFlag?"⚠ Duplicate override":""]);
            const csv=[hdr,...rows].map(r=>r.map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
            const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`expenses-${todayStr()}.csv`;a.click();
            pop("Exported ✓");
          }} style={{width:"100%",padding:"10px 0",background:"#e6faf2",color:"#0f7a4a",border:"1.5px solid #a7f3d0",borderRadius:10,fontWeight:600,fontSize:13,cursor:"pointer",marginBottom:14}}>📊 Export CSV</button>

          {/* Entry cards */}
          {filtered.length===0?(
            <div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}><div style={{fontSize:32,marginBottom:8}}>📋</div><div style={{fontWeight:600}}>{hasFilters?"No entries match your filters":"No entries yet"}</div></div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {filtered.map(e=>(
                <div key={e.id} style={{background:"white",borderRadius:14,padding:14,boxShadow:"0 2px 8px rgba(0,0,0,.05)",border:`1.5px solid ${e.status==="cancelled"?"#fca5a5":e.dupFlag?"#fde68a":"#e2e8f0"}`,opacity:e.status==="cancelled"?.55:1}}>
                  {/* Primary info */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:16,textDecoration:e.status==="cancelled"?"line-through":"none",color:"#0f172a"}}>{e.vendor||"—"}</div>
                      <div style={{fontSize:13,color:"#64748b",marginTop:1}}>{e.date}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                      <div style={{fontWeight:800,fontSize:18,textDecoration:e.status==="cancelled"?"line-through":"none",color:"#0f172a"}}>{fmt(e.amount)}</div>
                      <StatusPill s={e.status}/>
                    </div>
                  </div>

                  {e.dupFlag&&<div style={{background:"#fff8e6",border:"1.5px solid #fde68a",borderRadius:8,padding:"5px 10px",fontSize:11,color:"#9a6400",fontWeight:600,marginBottom:8}}>⚠ Admin note: Accepted as duplicate override</div>}

                  {/* Secondary info */}
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:8}}>
                    <CatPill id={e.category} categories={categories}/>
                    <span style={{fontSize:11,color:"#64748b"}}>{e.description}</span>
                  </div>

                  {/* Tertiary info */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:11,color:"#94a3b8"}}>{e.paymentMode}</span>
                      {e.billNumber!=="N/A"&&<span style={{fontSize:11,color:"#94a3b8"}}>· Bill #{e.billNumber}</span>}
                      {e.serial&&<span style={{fontSize:10,fontWeight:700,color:"#4f46e5",padding:"1px 6px",background:"#eef2ff",borderRadius:6}}>{e.serial}</span>}
                      {e.driveLink&&<a href={e.driveLink} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#0369a1"}}>📎 Bill</a>}
                      {e.notes&&<span style={{fontSize:11,color:"#64748b"}}>· {e.notes}</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <Av u={users.find(u=>u.loggedById===e.loggedById)||{avatar:"👤"}} s={18}/>
                        <span style={{fontSize:11,color:"#64748b"}}>{e.loggedBy}</span>
                      </div>
                      {e.status==="active"&&canAct(e)&&<div style={{display:"flex",gap:6}}>
                        <button onClick={()=>setEditTarget(e)} style={{padding:"3px 10px",background:"#eff6ff",color:"#1d4ed8",border:"none",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer"}}>Edit</button>
                        <button onClick={()=>{setCancelTarget(e);setCancelReason("");}} style={{padding:"3px 10px",background:"#fdecea",color:"#c0392b",border:"none",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                      </div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>}

        {/* ── AUDIT TAB ── */}
        {activeTab==="audit"&&<div style={{background:"white",borderRadius:16,padding:16,boxShadow:"0 2px 10px rgba(0,0,0,.05)"}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:800,marginBottom:4}}>Audit Log</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>All entries — nothing deleted, full history</div>
          {expenses.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}><div style={{fontSize:32,marginBottom:8}}>🔍</div><div style={{fontWeight:600}}>No entries yet</div></div>
          :<div style={{display:"flex",flexDirection:"column",gap:8}}>
            {expenses.map(e=>(
              <div key={e.id} className="erow" style={{paddingBottom:12,marginBottom:4,opacity:e.status==="cancelled"?.45:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13}}>{e.vendor} · {fmt(e.amount)}</div>
                    <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>{e.ts} · {e.serial}</div>
                  </div>
                  <StatusPill s={e.status}/>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",marginTop:6,flexWrap:"wrap"}}>
                  <CatPill id={e.category} categories={categories}/>
                  <span style={{fontSize:11,color:"#64748b"}}>{e.description}</span>
                  <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:"auto"}}>
                    <Av u={users.find(u=>u.id===e.loggedById)||{avatar:"👤"}} s={16}/>
                    <span style={{fontSize:11,color:"#64748b"}}>{e.loggedBy}</span>
                  </div>
                </div>
                {e.dupFlag&&<div style={{fontSize:10,color:"#9a6400",background:"#fff8e6",padding:"2px 8px",borderRadius:6,marginTop:4,display:"inline-block"}}>⚠ Duplicate override</div>}
                {(e.history||[]).map((h,i)=>(
                  <div key={i} style={{fontSize:10,background:h.type==="cancelled"?"#fdecea":"#fff8e6",color:h.type==="cancelled"?"#c0392b":"#9a6400",padding:"3px 8px",borderRadius:6,marginTop:4,lineHeight:1.6}}>
                    {h.type==="cancelled"?"🚫":"✏️"} {h.type} by {h.by} · {h.at} · {h.note||h.reason}
                  </div>
                ))}
              </div>
            ))}
          </div>}
        </div>}
      </div>

      {/* Cancel modal */}
      {cancelTarget&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:10001,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
        <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,padding:24}}>
          <div style={{width:36,height:4,background:"#e2e8f0",borderRadius:2,margin:"0 auto 16px"}}/>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,marginBottom:4}}>Cancel Entry</div>
          <div style={{fontSize:13,color:"#475569",marginBottom:14}}>{cancelTarget.vendor} · {fmt(cancelTarget.amount)}<br/><span style={{fontSize:12,color:"#94a3b8"}}>Stays in log, marked cancelled.</span></div>
          <label style={{...lbl,color:"#dc2626"}}>Reason *</label>
          <textarea style={{...inp,borderColor:"#fca5a5",resize:"vertical",marginBottom:14}} rows={2} placeholder="e.g. Duplicate entry / Wrong amount" value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setCancelTarget(null)} style={{flex:1,padding:"12px 0",background:"#f1f5f9",color:"#475569",border:"none",borderRadius:10,fontWeight:600,cursor:"pointer"}}>Back</button>
            <button onClick={doCancel} style={{flex:2,padding:"12px 0",background:"#dc2626",color:"white",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>Mark Cancelled</button>
          </div>
        </div>
      </div>}

      {/* Modals */}
      {showScanner&&billB64&&<BillScanner imageB64={billB64} isTrust={billMode==="trust"} onExtracted={onExtracted} onSkip={()=>{setShowScanner(false);setBillScanned(true);pop("Skipped scan — fill manually","info");}}/>}
      {showDiary&&<DiaryImport currentUser={user} categories={categories} onImported={rows=>{setExpenses(p=>[...rows,...p]);setShowDiary(false);pop(`✓ ${rows.length} entries imported`);}} onClose={()=>setShowDiary(false)}/>}
      {editTarget&&<EditModal expense={editTarget} categories={categories} onSave={doEdit} onClose={()=>setEditTarget(null)}/>}
      {showAdmin&&<AdminPanel users={users} onUpdateUsers={u=>{setUsers(u);setUser(u.find(x=>x.id===user.id)||user);}} onClose={()=>setShowAdmin(false)} pop={pop}/>}
      {showAddCat&&<AddCategoryModal onAdd={addCategory} onClose={()=>setShowAddCat(false)}/>}
      {showAddItem&&form.category&&<AddItemModal categoryLabel={cat.label||""} onAdd={addItem} onClose={()=>setShowAddItem(false)}/>}
      {dupMatches&&pendingSave&&<DuplicateDialog matches={dupMatches} onAccept={reason=>{setDupMatches(null);setPendingSave(null);executeSave(reason);}} onReject={()=>{setDupMatches(null);setPendingSave(null);}}/>}
      <Toast t={toast}/>
    </div>
  );
}
