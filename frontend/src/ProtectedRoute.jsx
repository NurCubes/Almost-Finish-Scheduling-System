import { useEffect, useState, useRef, createContext, useContext } from "react";
import { getDeptLogo, PCCLogo } from "./LogoMap.jsx";

export const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

const MAX_ATTEMPTS = 6;
const LOCKOUT_SECS = 25;

function useLockout() {
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);
  useEffect(() => {
    if (!lockedUntil) return;
    timerRef.current = setInterval(() => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left <= 0) { setLockedUntil(null); setTimeLeft(0); setAttempts(0); clearInterval(timerRef.current); }
      else { setTimeLeft(left); }
    }, 200);
    return () => clearInterval(timerRef.current);
  }, [lockedUntil]);
  const isLocked = !!lockedUntil && Date.now() < lockedUntil;
  const recordFailure = () => {
    const next = attempts + 1; setAttempts(next);
    if (next >= MAX_ATTEMPTS) { const until = Date.now() + LOCKOUT_SECS * 1000; setLockedUntil(until); setTimeLeft(LOCKOUT_SECS); }
    return next;
  };
  return { attempts, isLocked, timeLeft, recordFailure };
}

const DEPT_DISPLAY = [
  { code:"BSIT", color:"#800000" },
  { code:"CRIM", color:"#b91c1c" },
  { code:"BSBA", color:"#b45309" },
  { code:"BSHM", color:"#be185d" },
  { code:"BSED", color:"#15803d" },
];

function BrandHeader() {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
      <img src={PCCLogo} style={{ width:56, height:56, objectFit:"contain", filter:"drop-shadow(0 2px 8px rgba(0,0,0,0.3))" }} alt="PCC"/>
      <div style={{ textAlign:"center" }}>
        <div style={{ color:"#f8fafc", fontSize:22, fontWeight:900, letterSpacing:0.5 }}>SmartSched</div>
        <div style={{ color:"#94a3b8", fontSize:11, marginTop:3, fontWeight:600, letterSpacing:0.8, textTransform:"uppercase" }}>Class Scheduling System</div>
        <div style={{ color:"#475569", fontSize:11, marginTop:2 }}>Passi City College </div>
      </div>
      <div style={{ display:"flex", gap:10, alignItems:"center", justifyContent:"center", padding:"12px 18px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, marginTop:2 }}>
        {DEPT_DISPLAY.map(({ code, color }) => {
          const src = getDeptLogo(code);
          return (
            <div key={code} style={{ width:52, height:52, background:"rgba(255,255,255,0.06)", borderRadius:10, border:`1.5px solid ${color}60`, display:"flex", alignItems:"center", justifyContent:"center", padding:4, overflow:"hidden" }}>
              {src
                ? <img src={src} alt={code} style={{ width:44, height:44, objectFit:"contain" }}/>
                : <span style={{ color, fontSize:8, fontWeight:800 }}>{code}</span>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AuthInput({ type, value, onChange, onKeyDown, placeholder, maxLength, autoFocus, disabled, style: extra={} }) {
  const [focused, setFocused] = useState(false);
  return <input type={type} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} maxLength={maxLength} autoFocus={autoFocus} disabled={disabled} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={{ width:"100%", padding:"12px 14px", background:disabled?"#0a1020":"#0f172a", border:focused?"1.5px solid #3b82f6":"1px solid #334155", borderRadius:8, color:disabled?"#475569":"#f8fafc", fontSize:15, outline:"none", boxSizing:"border-box", transition:"border 0.15s", cursor:disabled?"not-allowed":"text", ...extra }}/>;
}

function AuthButton({ onClick, loading, disabled, children }) {
  const [hov, setHov] = useState(false);
  const isD = loading || disabled;
  return <button onClick={onClick} disabled={isD} onMouseOver={() => !isD && setHov(true)} onMouseOut={() => setHov(false)}
    style={{ width:"100%", padding:"13px 0", background:isD?"#1e3a6e":hov?"#1d4ed8":"#2563eb", color:isD?"#94a3b8":"#fff", border:"none", borderRadius:8, cursor:isD?"not-allowed":"pointer", fontSize:14, fontWeight:700, letterSpacing:0.3, transition:"background 0.15s", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
    {loading ? <><span style={{ display:"inline-block", width:14, height:14, border:"2px solid #ffffff33", borderTop:"2px solid #fff", borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>Verifying…</> : children}
  </button>;
}

function Banner({ msg, type="error" }) {
  if (!msg) return null;
  const colors = { error:"#f87171", warn:"#fbbf24", info:"#60a5fa" };
  return <div style={{ color:colors[type]??colors.error, fontSize:13, fontWeight:500, textAlign:"center" }}>{type==="error"?"⚠ ":"ℹ "}{msg}</div>;
}

function LockoutBanner({ timeLeft, attempts }) {
  if (!timeLeft) return null;
  return <div style={{ background:"#450a0a", border:"1px solid #7f1d1d", borderRadius:8, padding:"12px 16px", display:"flex", flexDirection:"column", alignItems:"center", gap:6, width:"100%", boxSizing:"border-box" }}>
    <div style={{ color:"#fca5a5", fontSize:13, fontWeight:700 }}>🔒 Account Locked</div>
    <div style={{ color:"#f87171", fontSize:12, textAlign:"center", lineHeight:1.5 }}>Too many failed attempts ({attempts}/{MAX_ATTEMPTS}).<br/>Please wait before trying again.</div>
    <div style={{ marginTop:4, background:"#7f1d1d", borderRadius:6, padding:"6px 20px", color:"#fecaca", fontSize:22, fontWeight:800, letterSpacing:2 }}>{timeLeft}s</div>
  </div>;
}

function AuthCard({ shake, children }) {
  return <div style={{ marginTop:8, background:"#1e293b", border:"1px solid #334155", borderRadius:14, padding:"28px 36px", display:"flex", flexDirection:"column", alignItems:"center", gap:14, maxWidth:400, width:"90%", textAlign:"center", boxShadow:"0 24px 48px rgba(0,0,0,0.4)", animation:shake?"shake 0.5s":"none" }}>{children}</div>;
}

function Styles() {
  return <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>;
}

const pageStyle = { display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", width:"100vw", margin:0, position:"fixed", inset:0, background:"#0f172a", flexDirection:"column", gap:14, fontFamily:"'Segoe UI',sans-serif", overflowY:"auto", backgroundImage:"radial-gradient(ellipse at 20% 50%,rgba(30,58,138,0.12) 0%,transparent 60%),radial-gradient(ellipse at 80% 20%,rgba(88,28,135,0.08) 0%,transparent 60%)" };
const FootNote = () => <div style={{ color:"#334155", fontSize:11, marginTop:4 }}>Unauthorized access attempts are logged.</div>;

function PinStep({ onSuccess }) {
  const [email,setEmail]=useState(""); const [pin,setPin]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false); const [shake,setShake]=useState(false);
  const { attempts, isLocked, timeLeft, recordFailure } = useLockout();
  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 600); };
  const submit = async () => {
    if (isLocked) return;
    if (!email.trim() || !pin.trim()) { setError("Please enter your email and PIN."); triggerShake(); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/auth/verify-pin", { method:"POST", credentials:"include", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ email:email.trim(), pin }) });
      const data = await res.json();
      if (res.ok) { onSuccess(email.trim()); }
      else { const next=recordFailure(); if(next<MAX_ATTEMPTS)setError(`${data.message||"Incorrect email or PIN."} (${next}/${MAX_ATTEMPTS} attempts)`); setPin(""); triggerShake(); }
    } catch { setError("Network error. Please try again."); }
    setLoading(false);
  };
  return (<div style={pageStyle}><BrandHeader/><AuthCard shake={shake}><div style={{fontSize:34}}>🔒</div><div style={{color:"#f1f5f9",fontSize:16,fontWeight:700}}>Step 1 of 2 — PIN Verification</div><div style={{color:"#94a3b8",fontSize:12,lineHeight:1.6,borderTop:"1px solid #334155",paddingTop:12,width:"100%"}}>Enter your admin email and system PIN to continue.</div>
    {isLocked?<LockoutBanner timeLeft={timeLeft} attempts={attempts}/>:<><AuthInput type="email" value={email} onChange={e=>{setEmail(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="admin@example.com" autoFocus/><AuthInput type="password" value={pin} onChange={e=>{setPin(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="System PIN" maxLength={12} style={{textAlign:"center",letterSpacing:6,fontSize:18}}/><Banner msg={error}/></>}
    <AuthButton onClick={submit} loading={loading} disabled={isLocked}>🔓 Verify PIN</AuthButton></AuthCard><FootNote/><Styles/></div>);
}

function PasswordStep({ email, onSuccess }) {
  const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false); const [shake,setShake]=useState(false); const [show,setShow]=useState(false);
  const { attempts, isLocked, timeLeft, recordFailure } = useLockout();
  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 600); };
  const submit = async () => {
    if (isLocked) return;
    if (!password) { setError("Password required."); triggerShake(); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/auth/login", { method:"POST", credentials:"include", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ password }) });
      const data = await res.json();
      if (res.ok) { onSuccess(data); }
      else { const next=recordFailure(); if(next<MAX_ATTEMPTS)setError(`${data.message||"Incorrect password."} (${next}/${MAX_ATTEMPTS} attempts)`); setPassword(""); triggerShake(); }
    } catch { setError("Network error. Please try again."); }
    setLoading(false);
  };
  return (<div style={pageStyle}><BrandHeader/><AuthCard shake={shake}><div style={{fontSize:34}}>🔑</div><div style={{color:"#f1f5f9",fontSize:16,fontWeight:700}}>Step 2 of 2 — Password</div><div style={{color:"#94a3b8",fontSize:12,lineHeight:1.6,borderTop:"1px solid #334155",paddingTop:12,width:"100%"}}>PIN verified for <strong style={{color:"#60a5fa"}}>{email}</strong>.<br/>Enter your password to complete login.</div>
    {isLocked?<LockoutBanner timeLeft={timeLeft} attempts={attempts}/>:<><div style={{position:"relative",width:"100%"}}><AuthInput type={show?"text":"password"} value={password} onChange={e=>{setPassword(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Strong password" autoFocus/><button onClick={()=>setShow(s=>!s)} tabIndex={-1} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:16,padding:0,lineHeight:1}}>{show?"🙈":"👁️"}</button></div><Banner msg={error}/></>}
    <AuthButton onClick={submit} loading={loading} disabled={isLocked}>✅ Sign In</AuthButton></AuthCard><FootNote/><Styles/></div>);
}

function ClearingScreen() {
  return <div style={pageStyle}><BrandHeader/><div style={{marginTop:20,width:36,height:36,border:"3px solid #1e293b",borderTop:"3px solid #2563eb",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/><div style={{color:"#475569",fontSize:12,marginTop:8}}>Initializing secure session…</div><Styles/></div>;
}

export default function ProtectedRoute({ children }) {
  const [stage, setStage] = useState("clearing");
  const [pinnedEmail, setPinnedEmail] = useState("");
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    fetch("/auth/logout", { method:"POST", credentials:"include" }).catch(()=>{}).finally(() => { setStage("pin"); });
    window.__smartschedLogout = () => { setStage("pin"); setPinnedEmail(""); setAuthUser(null); };
    return () => { delete window.__smartschedLogout; };
  }, []);
  if (stage === "clearing") return <ClearingScreen/>;
  if (stage === "pin") return <PinStep onSuccess={email => { setPinnedEmail(email); setStage("pass"); }}/>;
  if (stage === "pass") return <PasswordStep email={pinnedEmail} onSuccess={data => {
    setAuthUser({ name:data.name, email:data.email, role:data.role, departmentId:data.departmentId, deptCode:data.deptCode, deptName:data.deptName, isSuperAdmin:data.role==="superadmin", isDeptAdmin:data.role==="dept_admin" });
    setStage("ok");
  }}/>;
  if (stage === "ok") return <AuthContext.Provider value={authUser}>{children}</AuthContext.Provider>;
  return null;
}