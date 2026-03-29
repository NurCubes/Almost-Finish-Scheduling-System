import { useEffect, useState } from "react";
import ITLogo  from "./IT.png";
import PCCLogo from "./pcc.png";

/* ══════════════════════════════════════════════════
   TWO-STEP LOCAL AUTH — VERIFY ON EVERY VISIT
   Every time the user opens localhost:5173, they must
   complete both steps regardless of any existing session.

   HOW IT WORKS:
   - On mount we immediately call POST /auth/logout to
     destroy any existing server session.
   - Then we start fresh at Step 1 (PIN).
   - The server session is only used to carry pinVerified
     between step 1 → step 2 within the same visit.
   - Once the tab/window is closed and reopened, the whole
     flow restarts.
══════════════════════════════════════════════════ */

// ── Shared brand header ───────────────────────────────────
function BrandHeader({ subtitle = "Passi City College — Information & Communication Technology" }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <img src={ITLogo}  style={{ width:52, height:52, objectFit:"contain" }} alt="ICT" />
        <img src={PCCLogo} style={{ width:52, height:52, objectFit:"contain" }} alt="PCC" />
      </div>
      <div style={{ color:"#f8fafc", fontSize:20, fontWeight:800, letterSpacing:0.4, marginTop:4 }}>
        SmartSched
      </div>
      <div style={{ color:"#64748b", fontSize:12 }}>{subtitle}</div>
    </div>
  );
}

// ── Styled input ──────────────────────────────────────────
function AuthInput({ type, value, onChange, onKeyDown, placeholder, maxLength, autoFocus, style: extraStyle = {} }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      maxLength={maxLength}
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width:"100%", padding:"12px 14px",
        background:"#0f172a",
        border: focused ? "1.5px solid #3b82f6" : "1px solid #334155",
        borderRadius:8, color:"#f8fafc", fontSize:15,
        outline:"none", boxSizing:"border-box",
        transition:"border 0.15s",
        ...extraStyle,
      }}
    />
  );
}

// ── Submit button ─────────────────────────────────────────
function AuthButton({ onClick, loading, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        width:"100%", padding:"13px 0",
        background: loading ? "#1e3a6e" : hov ? "#1d4ed8" : "#2563eb",
        color:"#fff", border:"none", borderRadius:8,
        cursor: loading ? "not-allowed" : "pointer",
        fontSize:14, fontWeight:700, letterSpacing:0.3,
        transition:"background 0.15s",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
      }}
      onMouseOver={() => setHov(true)}
      onMouseOut={() => setHov(false)}
    >
      {loading
        ? <>
            <span style={{
              display:"inline-block", width:14, height:14,
              border:"2px solid #ffffff33", borderTop:"2px solid #fff",
              borderRadius:"50%", animation:"spin 0.7s linear infinite",
            }} />
            Verifying…
          </>
        : children}
    </button>
  );
}

// ── Error / info banner ───────────────────────────────────
function Banner({ msg, type = "error" }) {
  if (!msg) return null;
  const colors = { error:"#f87171", warn:"#fbbf24", info:"#60a5fa" };
  return (
    <div style={{ color: colors[type] ?? colors.error, fontSize:13, fontWeight:500, textAlign:"center" }}>
      {type === "error" ? "⚠ " : "ℹ "}{msg}
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────
function AuthCard({ shake, children }) {
  return (
    <div style={{
      marginTop:8, background:"#1e293b", border:"1px solid #334155",
      borderRadius:14, padding:"32px 40px",
      display:"flex", flexDirection:"column", alignItems:"center", gap:14,
      maxWidth:380, width:"90%", textAlign:"center",
      boxShadow:"0 24px 48px rgba(0,0,0,0.4)",
      animation: shake ? "shake 0.5s" : "none",
    }}>
      {children}
    </div>
  );
}

// ── CSS keyframes ─────────────────────────────────────────
function Styles() {
  return (
    <style>{`
      @keyframes shake {
        0%,100%{ transform:translateX(0) }
        20%    { transform:translateX(-8px) }
        40%    { transform:translateX(8px) }
        60%    { transform:translateX(-6px) }
        80%    { transform:translateX(6px) }
      }
      @keyframes spin { to { transform:rotate(360deg); } }
    `}</style>
  );
}

// ── Shared page wrapper ───────────────────────────────────
const pageStyle = {
  display:"flex", alignItems:"center", justifyContent:"center",
  height:"100vh", width:"100vw", margin:0, position:"fixed", inset:0,
  background:"#0f172a", flexDirection:"column", gap:16,
  fontFamily:"'Segoe UI', sans-serif",
};

const FootNote = () => (
  <div style={{ color:"#334155", fontSize:11, marginTop:4 }}>
    Unauthorized access attempts are logged.
  </div>
);

// ══════════════════════════════════════════════════════════
//  STEP 1 — Email + PIN
// ══════════════════════════════════════════════════════════
function PinStep({ onSuccess }) {
  const [email,   setEmail]   = useState("");
  const [pin,     setPin]     = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const [shake,   setShake]   = useState(false);

  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 600); };

  const submit = async () => {
    if (!email.trim() || !pin.trim()) {
      setError("Please enter your email and PIN.");
      triggerShake(); return;
    }
    setLoading(true); setError("");
    try {
      const res = await fetch("/auth/verify-pin", {
        method:"POST", credentials:"include",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ email: email.trim(), pin }),
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess(email.trim());
      } else {
        setError(data.message || "Incorrect PIN.");
        setPin(""); triggerShake();
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const onKey = (e) => e.key === "Enter" && submit();

  return (
    <div style={pageStyle}>
      <BrandHeader />
      <AuthCard shake={shake}>
        <div style={{ fontSize:36 }}>🔒</div>
        <div style={{ color:"#f1f5f9", fontSize:17, fontWeight:700 }}>
          Step 1 of 2 — PIN Verification
        </div>
        <div style={{
          color:"#94a3b8", fontSize:12, lineHeight:1.6,
          borderTop:"1px solid #334155", paddingTop:12, width:"100%",
        }}>
          Enter your admin email and system PIN to continue.
        </div>
        <AuthInput
          type="email" value={email}
          onChange={e => { setEmail(e.target.value); setError(""); }}
          onKeyDown={onKey}
          placeholder="admin@example.com"
          autoFocus
        />
        <AuthInput
          type="password" value={pin}
          onChange={e => { setPin(e.target.value); setError(""); }}
          onKeyDown={onKey}
          placeholder="System PIN"
          maxLength={12}
          style={{ textAlign:"center", letterSpacing:6, fontSize:18 }}
        />
        <Banner msg={error} />
        <AuthButton onClick={submit} loading={loading}>🔓 Verify PIN</AuthButton>
      </AuthCard>
      <FootNote />
      <Styles />
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  STEP 2 — Password
// ══════════════════════════════════════════════════════════
function PasswordStep({ email, onSuccess }) {
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [shake,    setShake]    = useState(false);
  const [show,     setShow]     = useState(false);

  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 600); };

  const submit = async () => {
    if (!password) { setError("Password required."); triggerShake(); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/auth/login", {
        method:"POST", credentials:"include",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess(data);
      } else {
        setError(data.message || "Incorrect password.");
        setPassword(""); triggerShake();
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  return (
    <div style={pageStyle}>
      <BrandHeader />
      <AuthCard shake={shake}>
        <div style={{ fontSize:36 }}>🔑</div>
        <div style={{ color:"#f1f5f9", fontSize:17, fontWeight:700 }}>
          Step 2 of 2 — Password
        </div>
        <div style={{
          color:"#94a3b8", fontSize:12, lineHeight:1.6,
          borderTop:"1px solid #334155", paddingTop:12, width:"100%",
        }}>
          PIN verified for <strong style={{ color:"#60a5fa" }}>{email}</strong>.<br />
          Enter your password to complete login.
        </div>
        <div style={{ position:"relative", width:"100%" }}>
          <AuthInput
            type={show ? "text" : "password"}
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="Strong password"
            autoFocus
          />
          <button
            onClick={() => setShow(s => !s)}
            tabIndex={-1}
            style={{
              position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
              background:"none", border:"none", color:"#64748b",
              cursor:"pointer", fontSize:16, padding:0, lineHeight:1,
            }}
          >
            {show ? "🙈" : "👁️"}
          </button>
        </div>
        <Banner msg={error} />
        <AuthButton onClick={submit} loading={loading}>✅ Sign In</AuthButton>
      </AuthCard>
      <FootNote />
      <Styles />
    </div>
  );
}

// ── Clearing screen — shown while destroying old session ──
function ClearingScreen() {
  return (
    <div style={pageStyle}>
      <BrandHeader subtitle="Passi City College — ICT" />
      <div style={{
        marginTop:20, width:36, height:36,
        border:"3px solid #1e293b", borderTop:"3px solid #2563eb",
        borderRadius:"50%", animation:"spin 0.8s linear infinite",
      }} />
      <div style={{ color:"#475569", fontSize:12, marginTop:8 }}>
        Initializing secure session…
      </div>
      <Styles />
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  PROTECTED ROUTE
//
//  EVERY visit to the app:
//    1. Mount → immediately POST /auth/logout (destroy any
//       existing session so the user MUST re-verify).
//    2. Once the old session is cleared → show PIN step.
//    3. PIN ok → show Password step.
//    4. Password ok → show the app.
//
//  This means:
//    - Refresh the page?  → verify again.
//    - Open a new tab?    → verify again.
//    - Come back later?   → verify again.
//    - Only navigating within the already-loaded SPA keeps
//      the user logged in (React state survives in-page
//      navigation but not a full page load/refresh).
// ══════════════════════════════════════════════════════════
export default function ProtectedRoute({ children }) {
  // "clearing" → destroying old session on mount
  // "pin"      → step 1
  // "pass"     → step 2
  // "ok"       → authenticated, show app
  const [stage,       setStage]       = useState("clearing");
  const [pinnedEmail, setPinnedEmail] = useState("");

  useEffect(() => {
    // Destroy any existing session immediately on every page load.
    // This forces full re-verification on every visit.
    fetch("/auth/logout", { method:"POST", credentials:"include" })
      .catch(() => { /* ignore network errors — just proceed */ })
      .finally(() => {
        // Whether logout succeeded or failed, always start at PIN step.
        setStage("pin");
      });

    // Expose logout for use elsewhere in the app (e.g. a logout button).
    // Calling this resets back to PIN step without a page reload.
    window.__smartschedLogout = () => {
      setStage("pin");
      setPinnedEmail("");
    };

    return () => { delete window.__smartschedLogout; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stage === "clearing") return <ClearingScreen />;

  if (stage === "pin")
    return (
      <PinStep onSuccess={(email) => {
        setPinnedEmail(email);
        setStage("pass");
      }} />
    );

  if (stage === "pass")
    return (
      <PasswordStep
        email={pinnedEmail}
        onSuccess={() => setStage("ok")}
      />
    );

  if (stage === "ok") return children;

  return null;
}