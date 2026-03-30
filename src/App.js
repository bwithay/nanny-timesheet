import React, { useState, useEffect, useCallback, useMemo } from "react";

// ─── FIREBASE CONFIG ───
const FB_URL = "https://tax-tracker-2026-default-rtdb.firebaseio.com/nanny-timesheet";

async function fbLoad(path) {
  try {
    const res = await fetch(`${FB_URL}/${path}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (e) { console.log("Firebase load error", e); return null; }
}

async function fbSave(path, val) {
  try {
    await fetch(`${FB_URL}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(val),
    });
  } catch (e) { console.log("Firebase save error", e); }
}

// ─── CONFIG ───
const RATES = {
  directChildcare: 25, directHousehold: 30, respiteCompany: 19,
  respiteSupplementChildcare: 6, respiteSupplementHousehold: 11,
  employerFICA: 0.0765, futaAndStateUI: 0.021, workersComp: 0.015,
  payrollServiceWeekly: 9, overtimeMultiplier: 1.5,
};

const CHILDREN = ["Noah", "Josiah"];
const DEFAULT_TAX_RATE = 0.185;
const DEFAULT_RESPITE_TAX_RATE = 0.185;
const DEFAULT_QUARTERLY_CAP = 60;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EMPLOYER_PIN = "2134";

// ─── UTILS ───
function getMondayOfWeek(date) {
  const d = new Date(date); const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff); d.setHours(0, 0, 0, 0); return d;
}
function formatWeekRange(monday) {
  const sun = new Date(monday); sun.setDate(monday.getDate() + 6);
  const o = { month: "short", day: "numeric" };
  return `${monday.toLocaleDateString("en-US", o)} – ${sun.toLocaleDateString("en-US", o)}`;
}
function formatDayDate(monday, dayIndex) {
  const d = new Date(monday); d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function getMonthKey(monday) { return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}`; }
function getMonthLabel(mk) { const [y, m] = mk.split("-"); return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
function getQuarter(date) { return Math.floor(date.getMonth() / 3); }
function getQuarterLabel(date) { return `Q${getQuarter(date) + 1} ${date.getFullYear()}`; }
function sameQuarter(d1, d2) { return d1.getFullYear() === d2.getFullYear() && getQuarter(d1) === getQuarter(d2); }
function wk(monday) { return monday.toISOString().split("T")[0]; }
function num(v) { return parseFloat(v) || 0; }
function money(v) { return v.toLocaleString("en-US", { style: "currency", currency: "USD" }); }

const blankDay = () => ({
  directChildcare: "", directHousehold: "",
  noahRespiteChildcare: "", noahRespiteHousehold: "",
  josiahRespiteChildcare: "", josiahRespiteHousehold: "",
});
const blankWeek = () => DAYS.reduce((a, d) => { a[d] = blankDay(); return a; }, {});

function totalRespiteHrs(dd) {
  return num(dd.noahRespiteChildcare) + num(dd.noahRespiteHousehold) + num(dd.josiahRespiteChildcare) + num(dd.josiahRespiteHousehold);
}

function calcWeekTotals(weekData) {
  const dayCalcs = {};
  DAYS.forEach(d => {
    const dd = weekData[d];
    const dc = num(dd.directChildcare), dh = num(dd.directHousehold);
    const nrc = num(dd.noahRespiteChildcare), nrh = num(dd.noahRespiteHousehold);
    const jrc = num(dd.josiahRespiteChildcare), jrh = num(dd.josiahRespiteHousehold);
    const rc = nrc + jrc, rh = nrh + jrh;
    const totalHrs = dc + dh + rc + rh;
    dayCalcs[d] = { dc, dh, rc, rh, nrc, nrh, jrc, jrh, totalHrs, dailyOTHrs: Math.max(0, totalHrs - 8) };
  });

  const totals = DAYS.reduce((acc, d) => {
    const c = dayCalcs[d];
    acc.directChildcareHrs += c.dc; acc.directHouseholdHrs += c.dh;
    acc.respiteChildcareHrs += c.rc; acc.respiteHouseholdHrs += c.rh;
    acc.noahHrs += c.nrc + c.nrh; acc.josiahHrs += c.jrc + c.jrh;
    acc.totalHrs += c.totalHrs; acc.dailyOTHrs += c.dailyOTHrs;
    acc.directPay += c.dc * RATES.directChildcare + c.dh * RATES.directHousehold;
    acc.supplementPay += c.rc * RATES.respiteSupplementChildcare + c.rh * RATES.respiteSupplementHousehold;
    acc.respiteCompanyPay += (c.rc + c.rh) * RATES.respiteCompany;
    return acc;
  }, { directChildcareHrs: 0, directHouseholdHrs: 0, respiteChildcareHrs: 0, respiteHouseholdHrs: 0, noahHrs: 0, josiahHrs: 0, totalHrs: 0, dailyOTHrs: 0, directPay: 0, supplementPay: 0, respiteCompanyPay: 0 });

  const weeklyOTHrs = Math.max(0, totals.totalHrs - 40);
  const otHrs = Math.max(weeklyOTHrs, totals.dailyOTHrs);
  const blendedRate = totals.totalHrs > 0 ? (totals.directPay + totals.supplementPay) / totals.totalHrs : RATES.directChildcare;
  const otPremium = otHrs * blendedRate * 0.5;
  const grossPayroll = totals.directPay + totals.supplementPay + otPremium;
  const employerFICA = grossPayroll * RATES.employerFICA;
  const futaUI = grossPayroll * RATES.futaAndStateUI;
  const workersComp = grossPayroll * RATES.workersComp;
  const totalEmployerCost = grossPayroll + employerFICA + futaUI + workersComp + RATES.payrollServiceWeekly;

  return { dayCalcs, totals, weeklyOTHrs, otHrs, otPremium, grossPayroll, employerFICA, futaUI, workersComp, totalEmployerCost };
}

// ─── STEPPER + DIRECT INPUT ───
function HoursInput({ label, sublabel, value, onChange, accentColor }) {
  const cur = num(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const adjust = (delta) => { const next = Math.max(0, Math.round((cur + delta) * 4) / 4); onChange(next === 0 ? "" : String(next)); };
  const commitDraft = () => { setEditing(false); const p = parseFloat(draft); if (isNaN(p) || p < 0) { onChange(""); return; } const r = Math.round(p * 4) / 4; onChange(r === 0 ? "" : String(r)); };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#2d3142" }}>{label}</span>
        {sublabel && <span style={{ fontSize: 10.5, color: "#8d93a5" }}>{sublabel}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <button onClick={() => adjust(-0.5)} style={stepBtn}>−</button>
        <button onClick={() => adjust(-0.25)} style={stepSm}>−¼</button>
        {editing ? (
          <input type="number" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitDraft} onKeyDown={(e) => { if (e.key === "Enter") commitDraft(); }}
            inputMode="decimal" step="0.25" min="0"
            style={{ flex: 1, textAlign: "center", fontSize: 18, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: "#2d3142", background: `${accentColor}15`, border: `2px solid ${accentColor}`, borderRadius: 10, padding: "6px 0", outline: "none", width: "100%", minWidth: 0 }} />
        ) : (
          <button onClick={() => { setDraft(cur > 0 ? String(cur) : ""); setEditing(true); }} style={{
            flex: 1, textAlign: "center", fontSize: 18, fontWeight: 700, color: cur > 0 ? "#2d3142" : "#c5c9d6", fontFamily: "'DM Mono', monospace",
            background: cur > 0 ? `${accentColor}12` : "#f7f8fb", borderRadius: 10, padding: "7px 0",
            border: cur > 0 ? `1.5px solid ${accentColor}40` : "1.5px solid #e0e3eb", cursor: "pointer", transition: "all 0.2s",
          }}>{cur > 0 ? cur.toFixed(cur % 1 === 0 ? 0 : 2) : "0"}<span style={{ fontSize: 10, fontWeight: 500, color: "#8d93a5", marginLeft: 3 }}>hrs</span></button>
        )}
        <button onClick={() => adjust(0.25)} style={stepSm}>+¼</button>
        <button onClick={() => adjust(0.5)} style={stepBtn}>+</button>
      </div>
    </div>
  );
}
const stepBtn = { width: 36, height: 36, borderRadius: 10, border: "1.5px solid #e0e3eb", background: "#f7f8fb", fontSize: 17, fontWeight: 700, color: "#6b7189", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
const stepSm = { width: 30, height: 36, borderRadius: 10, border: "1.5px solid #e0e3eb", background: "#f7f8fb", fontSize: 10, fontWeight: 600, color: "#8d93a5", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" };

// ─── PIN MODAL ───
function PinModal({ onSuccess, onCancel }) {
  const [pin, setPin] = useState(""); const [error, setError] = useState(false);
  const submit = () => { if (pin === EMPLOYER_PIN) onSuccess(); else { setError(true); setPin(""); setTimeout(() => setError(false), 1500); } };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(45,49,66,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 24, padding: "32px 28px", width: 280, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#2d3142", marginBottom: 6 }}>Employer View</div>
        <div style={{ fontSize: 12, color: "#8d93a5", marginBottom: 20 }}>Enter PIN to view cost breakdown</div>
        <input type="password" inputMode="numeric" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={{ width: "100%", textAlign: "center", fontSize: 28, fontWeight: 700, fontFamily: "'DM Mono', monospace", letterSpacing: 12, border: error ? "2px solid #e05555" : "2px solid #e0e3eb", borderRadius: 14, padding: "12px 0", outline: "none", background: error ? "#fff0f0" : "#f7f8fb", transition: "all 0.2s", boxSizing: "border-box" }} placeholder="• • • •" />
        {error && <div style={{ fontSize: 12, color: "#e05555", marginTop: 8 }}>Incorrect PIN</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "1.5px solid #e0e3eb", background: "#f7f8fb", fontSize: 13, fontWeight: 600, color: "#6b7189", cursor: "pointer" }}>Cancel</button>
          <button onClick={submit} style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: "none", background: "#2d3142", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer" }}>Unlock</button>
        </div>
      </div>
    </div>
  );
}

// ─── PROGRESS BAR ───
function ProgressBar({ used, cap, color, height = 8 }) {
  const pct = Math.min(100, (used / cap) * 100);
  const nearCap = pct >= 85;
  return (
    <div style={{ background: "#e0e3eb", borderRadius: height / 2, height, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: height / 2, background: nearCap ? "#d45454" : color, transition: "width 0.3s" }} />
    </div>
  );
}

// ─── SMALL COMPONENTS ───
function SummaryLine({ label, value, color = "#b0b5c9" }) {
  return (<div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 12, color }}>{label}</span><span style={{ fontSize: 13, fontWeight: 600, color: color === "#b0b5c9" ? "#e8eff8" : color, fontFamily: "'DM Mono', monospace" }}>{value}</span></div>);
}
function LegendDot({ color, label }) {
  return (<div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 8, height: 8, borderRadius: 4, background: color }} /><span style={{ fontSize: 11, color: "#8d93a5" }}>{label}</span></div>);
}
const navBtn = { width: 34, height: 34, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.07)", color: "#b0b5c9", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

const accent = "#4a6fa5", accentLight = "#e8eff8", warm = "#d4834e", warmLight = "#fdf0e7";
const green = "#3a8a6a", greenLight = "#e6f5ef", slate = "#2d3142", red = "#d45454";
const childColors = { Noah: "#5b8ec9", Josiah: "#c97b3a" };

// ─── MAIN APP ───
function App() {
  const [currentMonday, setCurrentMonday] = useState(() => getMondayOfWeek(new Date()));
  const [weeks, setWeeks] = useState({});
  const [activeDay, setActiveDay] = useState(null);
  const [view, setView] = useState("nanny");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [respiteOpen, setRespiteOpen] = useState({});
  const [respiteChild, setRespiteChild] = useState("Noah");
  const [nannyTaxRate] = useState(DEFAULT_TAX_RATE);
  const [respiteTaxRate] = useState(DEFAULT_RESPITE_TAX_RATE);
  const [quarterlyCap] = useState(DEFAULT_QUARTERLY_CAP);

  const key = wk(currentMonday);
  const weekData = weeks[key] || blankWeek();
  const thisMonday = getMondayOfWeek(new Date());
  const isCurrentWeek = wk(currentMonday) === wk(thisMonday);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const dayOfWeek = new Date().getDay();
  const isPaymentDay = dayOfWeek === 0;
  const isPaymentEve = dayOfWeek === 6;

  // ─── LOAD FROM FIREBASE ───
  useEffect(() => {
    async function load() {
      const data = await fbLoad("data");
      if (data && data.weeks) {
        setWeeks(data.weeks);
      }
      setLoaded(true);
    }
    load();
  }, []);

  // ─── SAVE TO FIREBASE (debounced) ───
  const saveTimeout = React.useRef(null);
  const persist = useCallback((updatedWeeks) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      await fbSave("data", { weeks: updatedWeeks });
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    }, 500);
  }, []);

  function updateHours(day, type, value) {
    const updated = { ...weeks, [key]: { ...weekData, [day]: { ...weekData[day], [type]: value } } };
    setWeeks(updated);
    persist(updated);
  }

  function prevWeek() { const d = new Date(currentMonday); d.setDate(d.getDate() - 7); setCurrentMonday(d); setActiveDay(null); }
  function nextWeek() { const d = new Date(currentMonday); d.setDate(d.getDate() + 7); setCurrentMonday(d); setActiveDay(null); }
  function handleCostsToggle() { if (view === "employer") { setView("nanny"); return; } if (pinUnlocked) { setView("employer"); return; } setShowPin(true); }

  const wc = useMemo(() => calcWeekTotals(weekData), [weekData]);
  const { dayCalcs, totals, weeklyOTHrs, otHrs, otPremium, grossPayroll, employerFICA, futaUI, workersComp, totalEmployerCost } = wc;

  const estimatedFamilyNet = grossPayroll * (1 - nannyTaxRate);
  const estimatedRespiteNet = totals.respiteCompanyPay * (1 - respiteTaxRate);
  const nannyTotalGross = grossPayroll + totals.respiteCompanyPay;
  const nannyTotalNet = estimatedFamilyNet + estimatedRespiteNet;

  // ─── QUARTERLY RESPITE TRACKER ───
  const quarterlyRespite = useMemo(() => {
    const ref = currentMonday;
    let noah = 0, josiah = 0;
    Object.keys(weeks).forEach(k => {
      const m = new Date(k + "T00:00:00");
      if (sameQuarter(m, ref)) {
        const wd = weeks[k];
        DAYS.forEach(d => {
          const dd = wd[d];
          noah += num(dd.noahRespiteChildcare) + num(dd.noahRespiteHousehold);
          josiah += num(dd.josiahRespiteChildcare) + num(dd.josiahRespiteHousehold);
        });
      }
    });
    return { noah, josiah, label: getQuarterLabel(ref) };
  }, [weeks, currentMonday]);

  // ─── MONTH-TO-DATE ───
  const currentMonthKey = getMonthKey(currentMonday);
  const monthToDate = useMemo(() => {
    let totalCost = 0, totalGross = 0, totalHrs = 0, weeksInMonth = 0;
    Object.keys(weeks).forEach(k => {
      const m = new Date(k + "T00:00:00");
      if (getMonthKey(m) === currentMonthKey) {
        const wCalc = calcWeekTotals(weeks[k] || blankWeek());
        if (wCalc.totals.totalHrs > 0) { totalCost += wCalc.totalEmployerCost; totalGross += wCalc.grossPayroll; totalHrs += wCalc.totals.totalHrs; weeksInMonth++; }
      }
    });
    return { totalCost, totalGross, totalHrs, weeksInMonth };
  }, [weeks, currentMonthKey]);

  function dayFamilyGross(d) { const c = dayCalcs[d]; return c.dc * RATES.directChildcare + c.dh * RATES.directHousehold + c.rc * RATES.respiteSupplementChildcare + c.rh * RATES.respiteSupplementHousehold; }
  function dayTotalEarnings(d) { const c = dayCalcs[d]; return c.dc * RATES.directChildcare + c.dh * RATES.directHousehold + (c.rc + c.rh) * RATES.respiteCompany + c.rc * RATES.respiteSupplementChildcare + c.rh * RATES.respiteSupplementHousehold; }

  const pastKeys = Object.keys(weeks).filter(k => k !== key).sort((a, b) => b.localeCompare(a)).slice(0, 8);
  const isFirstUse = totals.totalHrs === 0 && pastKeys.length === 0 && !activeDay;

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f7fb", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ textAlign: "center", color: "#8d93a5" }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Loading timesheet...</div>
        </div>
      </div>
    );
  }

  // ─── QUARTERLY CARD ───
  const quarterlyCard = (quarterlyRespite.noah > 0 || quarterlyRespite.josiah > 0) && (
    <div style={{ margin: "12px 12px 0", padding: "14px 16px", background: "#fff", borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#8d93a5", letterSpacing: 1.5, textTransform: "uppercase" }}>Respite Hours — {quarterlyRespite.label}</div>
        <div style={{ fontSize: 10, color: "#8d93a5" }}>{quarterlyCap} hrs/child</div>
      </div>
      {CHILDREN.map(child => {
        const used = child === "Noah" ? quarterlyRespite.noah : quarterlyRespite.josiah;
        const remaining = Math.max(0, quarterlyCap - used);
        const col = childColors[child];
        return (
          <div key={child} style={{ marginBottom: child === "Noah" ? 10 : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: col }}>{child}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: slate, fontFamily: "'DM Mono', monospace" }}>
                {used.toFixed(1)} <span style={{ color: "#8d93a5", fontWeight: 400 }}>/ {quarterlyCap}</span>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ProgressBar used={used} cap={quarterlyCap} color={col} />
              <span style={{ fontSize: 10, color: remaining <= 5 ? red : "#8d93a5", fontWeight: 600, minWidth: 50, textAlign: "right" }}>
                {remaining.toFixed(1)} left
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );

  // ─── RENDER BLOCKS ───
  const dayPillsBlock = (
    <div style={{ display: "flex", gap: 4, padding: "14px 12px 6px", justifyContent: "center" }}>
      {DAYS.map((d, i) => {
        const hrs = dayCalcs[d].totalHrs;
        const isToday = isCurrentWeek && i === todayIdx;
        const isActive = activeDay === d;
        const hasOT = dayCalcs[d].dailyOTHrs > 0;
        return (
          <button key={d} onClick={() => setActiveDay(isActive ? null : d)} style={{
            flex: 1, maxWidth: 58, padding: "7px 0 5px", borderRadius: 14,
            border: isActive ? `2px solid ${accent}` : isToday ? `2px solid ${warm}60` : "2px solid transparent",
            background: isActive ? accentLight : isToday ? warmLight : "#fff",
            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            boxShadow: isActive ? `0 4px 16px ${accent}25` : "0 2px 8px rgba(0,0,0,0.04)", transition: "all 0.2s",
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? accent : isToday ? warm : "#8d93a5" }}>{d}</span>
            {hrs > 0 ? (
              <span style={{ fontSize: 9.5, fontWeight: 700, color: "#fff", background: hasOT ? red : accent, borderRadius: 6, padding: "2px 5px", fontFamily: "'DM Mono', monospace" }}>
                {hrs.toFixed(hrs % 1 === 0 ? 0 : 1)}h</span>
            ) : (<span style={{ fontSize: 10, color: "#c5c9d6" }}>—</span>)}
          </button>
        );
      })}
    </div>
  );

  const firstUseHint = isFirstUse && (
    <div style={{ margin: "8px 12px", padding: "14px 16px", background: "#fff", borderRadius: 14, textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>👆</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: slate }}>Tap a day to start logging hours</div>
      <div style={{ fontSize: 11, color: "#8d93a5", marginTop: 4 }}>Payment is calculated weekly every Sunday</div>
    </div>
  );

  const dayInputBlock = activeDay && (() => {
    const c = dayCalcs[activeDay];
    const dd = weekData[activeDay];
    const directHrs = c.dc + c.dh;
    const respiteHrs = c.rc + c.rh;
    const noahDayHrs = c.nrc + c.nrh;
    const josiahDayHrs = c.jrc + c.jrh;
    const hasResp = respiteHrs > 0;

    const childFieldMap = {
      Noah: { cc: "noahRespiteChildcare", hh: "noahRespiteHousehold" },
      Josiah: { cc: "josiahRespiteChildcare", hh: "josiahRespiteHousehold" },
    };
    const fields = childFieldMap[respiteChild];

    return (
      <div style={{ margin: "8px 12px", padding: 16, background: "#fff", borderRadius: 20, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: slate }}>{activeDay} — {formatDayDate(currentMonday, DAYS.indexOf(activeDay))}</div>
          {c.dailyOTHrs > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: red, background: "#fff0f0", padding: "3px 8px", borderRadius: 8 }}>{c.dailyOTHrs.toFixed(1)}h OT</span>}
        </div>

        <div style={{ background: accentLight, borderRadius: 14, padding: "12px 14px", marginBottom: 10, border: `1px solid ${accent}20` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Direct Pay</div>
          <HoursInput label="Childcare" sublabel={`${money(RATES.directChildcare)}/hr`} value={dd.directChildcare} onChange={(v) => updateHours(activeDay, "directChildcare", v)} accentColor={accent} />
          <HoursInput label="Household / Cleaning" sublabel={`${money(RATES.directHousehold)}/hr`} value={dd.directHousehold} onChange={(v) => updateHours(activeDay, "directHousehold", v)} accentColor={accent} />
        </div>

        <div style={{ background: greenLight, borderRadius: 14, border: `1px solid ${green}20`, overflow: "hidden" }}>
          <button onClick={() => setRespiteOpen({ ...respiteOpen, [activeDay]: !respiteOpen[activeDay] })} style={{
            width: "100%", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
            background: "transparent", border: "none", cursor: "pointer",
          }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: green, letterSpacing: 1.5, textTransform: "uppercase" }}>Respite Hours</span>
              {hasResp && (
                <span style={{ fontSize: 10, fontWeight: 600, color: green, marginLeft: 8 }}>
                  {noahDayHrs > 0 && <span style={{ color: childColors.Noah }}>N:{noahDayHrs.toFixed(1)}</span>}
                  {noahDayHrs > 0 && josiahDayHrs > 0 && " · "}
                  {josiahDayHrs > 0 && <span style={{ color: childColors.Josiah }}>J:{josiahDayHrs.toFixed(1)}</span>}
                </span>
              )}
            </div>
            <span style={{ fontSize: 16, color: green, transition: "transform 0.2s", transform: respiteOpen[activeDay] ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
          </button>

          {(respiteOpen[activeDay] || hasResp) && (
            <div style={{ padding: "0 14px 12px" }}>
              <div style={{ fontSize: 10, color: "#6b8a7d", marginBottom: 10 }}>You earn your full rate — the company pays {money(RATES.respiteCompany)}, we pay the rest</div>

              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {CHILDREN.map(child => {
                  const isAct = respiteChild === child;
                  const chHrs = child === "Noah" ? noahDayHrs : josiahDayHrs;
                  const col = childColors[child];
                  const qUsed = child === "Noah" ? quarterlyRespite.noah : quarterlyRespite.josiah;
                  const qRemain = Math.max(0, quarterlyCap - qUsed);
                  return (
                    <button key={child} onClick={() => setRespiteChild(child)} style={{
                      flex: 1, padding: "8px 6px", borderRadius: 10,
                      border: isAct ? `2px solid ${col}` : "2px solid #d5e0d8",
                      background: isAct ? `${col}12` : "#fff",
                      cursor: "pointer", textAlign: "center", transition: "all 0.15s",
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isAct ? col : "#8d93a5" }}>{child}</div>
                      {chHrs > 0 && <div style={{ fontSize: 10, fontWeight: 600, color: col, marginTop: 2 }}>{chHrs.toFixed(1)}h today</div>}
                      <div style={{ fontSize: 9, color: qRemain <= 5 ? red : "#8d93a5", marginTop: 2 }}>{qRemain.toFixed(1)}h left in {quarterlyRespite.label}</div>
                    </button>
                  );
                })}
              </div>

              <HoursInput label={`${respiteChild} — Childcare`} sublabel={`${money(RATES.directChildcare)}/hr total to you`} value={dd[fields.cc]} onChange={(v) => updateHours(activeDay, fields.cc, v)} accentColor={childColors[respiteChild]} />
              <HoursInput label={`${respiteChild} — Household`} sublabel={`${money(RATES.directHousehold)}/hr total to you`} value={dd[fields.hh]} onChange={(v) => updateHours(activeDay, fields.hh, v)} accentColor={childColors[respiteChild]} />
            </div>
          )}
        </div>

        {c.totalHrs > 0 && (() => {
          return (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#f7f8fb", borderRadius: 12 }}>
              {hasResp ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "#8d93a5" }}>Direct ({directHrs.toFixed(1)} hrs)</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: slate, fontFamily: "'DM Mono', monospace" }}>{money(c.dc * RATES.directChildcare + c.dh * RATES.directHousehold)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "#7dbfa5" }}>Supplement ({respiteHrs.toFixed(1)} hrs)</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: green, fontFamily: "'DM Mono', monospace" }}>{money(c.rc * RATES.respiteSupplementChildcare + c.rh * RATES.respiteSupplementHousehold)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6, borderTop: "1px solid #e0e3eb" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#8d93a5" }}>From us</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: slate, fontFamily: "'DM Mono', monospace" }}>{money(dayFamilyGross(activeDay))}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6, marginTop: 6, borderTop: "1px solid #e0e3eb" }}>
                    <span style={{ fontSize: 12, color: "#6b8a7d" }}>Total earnings (incl. respite co.)</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: green, fontFamily: "'DM Mono', monospace" }}>{money(dayTotalEarnings(activeDay))}</span>
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#8d93a5" }}>Day total ({c.totalHrs.toFixed(1)} hrs)</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: slate, fontFamily: "'DM Mono', monospace" }}>{money(dayFamilyGross(activeDay))}</span>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  })();

  const nannySummaryBlock = (
    <div style={{ margin: "12px 12px 0", padding: 20, background: `linear-gradient(140deg, ${slate} 0%, #3d4260 100%)`, borderRadius: 22, boxShadow: "0 8px 32px rgba(45,49,66,0.2)" }}>
      <div style={{ fontSize: 11, letterSpacing: 2, color: "#8d93a5", textTransform: "uppercase", marginBottom: 14 }}>Weekly Pay Summary</div>
      <SummaryLine label={`Childcare (${totals.directChildcareHrs.toFixed(1)} hrs × ${money(RATES.directChildcare)})`} value={money(totals.directChildcareHrs * RATES.directChildcare)} />
      <SummaryLine label={`Household (${totals.directHouseholdHrs.toFixed(1)} hrs × ${money(RATES.directHousehold)})`} value={money(totals.directHouseholdHrs * RATES.directHousehold)} />
      {(totals.respiteChildcareHrs + totals.respiteHouseholdHrs) > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8, marginTop: 8, marginBottom: 8 }}>
          <SummaryLine label={`Respite childcare supp. (${totals.respiteChildcareHrs.toFixed(1)} hrs)`} value={money(totals.respiteChildcareHrs * RATES.respiteSupplementChildcare)} color="#7dbfa5" />
          <SummaryLine label={`Respite household supp. (${totals.respiteHouseholdHrs.toFixed(1)} hrs)`} value={money(totals.respiteHouseholdHrs * RATES.respiteSupplementHousehold)} color="#7dbfa5" />
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: childColors.Noah }}>Noah: {totals.noahHrs.toFixed(1)}h</span>
            <span style={{ fontSize: 10, color: childColors.Josiah }}>Josiah: {totals.josiahHrs.toFixed(1)}h</span>
          </div>
        </div>
      )}
      {otHrs > 0 && (<div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8, marginTop: 8, marginBottom: 8 }}><SummaryLine label={`OT premium (${otHrs.toFixed(1)} hrs × 0.5x)`} value={`+${money(otPremium)}`} color="#f0a0a0" /></div>)}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 14, marginTop: 8, marginBottom: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontSize: 14, fontWeight: 700, color: "#e8eff8" }}>Gross from Hicks Family</div><div style={{ fontSize: 10, color: "#8d93a5", marginTop: 1 }}>Before taxes withheld</div></div>
          <span style={{ fontSize: 26, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono', monospace" }}>{money(grossPayroll)}</span>
        </div>
        {grossPayroll > 0 && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,255,255,0.06)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ fontSize: 12, color: "#b0b5c9" }}>Estimated take-home</div><div style={{ fontSize: 9, color: "#7a7f94" }}>~{Math.round(nannyTaxRate * 100)}% est. withholding · based on your W-4</div></div>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#e8c96a", fontFamily: "'DM Mono', monospace" }}>~{money(estimatedFamilyNet)}</span>
          </div>
        )}
      </div>
      {(totals.respiteChildcareHrs + totals.respiteHouseholdHrs) > 0 && (
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 14px", marginTop: 12 }}>
          <SummaryLine label={`From respite company (${(totals.respiteChildcareHrs + totals.respiteHouseholdHrs).toFixed(1)} hrs × ${money(RATES.respiteCompany)})`} value={money(totals.respiteCompanyPay)} color="#b0b5c9" />
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 8, paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 13, fontWeight: 700, color: warm }}>Total weekly gross</span><span style={{ fontSize: 16, fontWeight: 700, color: warm, fontFamily: "'DM Mono', monospace" }}>{money(nannyTotalGross)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#b0b5c9" }}>Estimated total take-home</span><span style={{ fontSize: 14, fontWeight: 700, color: "#e8c96a", fontFamily: "'DM Mono', monospace" }}>~{money(nannyTotalNet)}</span></div>
            <div style={{ fontSize: 9, color: "#7a7f94", marginTop: 4, textAlign: "right" }}>
              {nannyTaxRate === respiteTaxRate ? `~${Math.round(nannyTaxRate * 100)}% est. withholding from both employers` : `Assumes ~${Math.round(nannyTaxRate * 100)}% from us, ~${Math.round(respiteTaxRate * 100)}% from respite company`}
            </div>
          </div>
        </div>
      )}
      {(totals.respiteChildcareHrs + totals.respiteHouseholdHrs) === 0 && grossPayroll === 0 && (<div style={{ textAlign: "center", color: "#6b7189", fontSize: 13, marginTop: 8 }}>No hours logged this week</div>)}
    </div>
  );

  const employerSummaryBlock = (
    <div style={{ margin: "12px 12px 0", padding: 20, background: `linear-gradient(140deg, ${slate} 0%, #3d4260 100%)`, borderRadius: 22, boxShadow: "0 8px 32px rgba(45,49,66,0.2)" }}>
      <div style={{ fontSize: 11, letterSpacing: 2, color: "#8d93a5", textTransform: "uppercase", marginBottom: 14 }}>Weekly Employer Cost</div>
      <SummaryLine label="Gross payroll (direct + supplement + OT)" value={money(grossPayroll)} />
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8, marginTop: 8, marginBottom: 8 }}>
        <SummaryLine label="Employer FICA (7.65%)" value={money(employerFICA)} />
        <SummaryLine label="FUTA + CA UI/ETT (2.1%)" value={money(futaUI)} />
        <SummaryLine label="Workers' comp (1.5%)" value={money(workersComp)} />
        <SummaryLine label="Payroll service" value={money(RATES.payrollServiceWeekly)} />
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 14, marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#e8eff8" }}>Total Weekly Cost</span>
        <span style={{ fontSize: 26, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono', monospace" }}>{money(totalEmployerCost)}</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 14px", marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#8d93a5" }}>Monthly estimate (× 4.33)</span><span style={{ fontSize: 16, fontWeight: 700, color: "#e8eff8", fontFamily: "'DM Mono', monospace" }}>{money(totalEmployerCost * 4.33)}</span></div>
      </div>
      {monthToDate.weeksInMonth > 0 && (
        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 14px", marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8d93a5", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>{getMonthLabel(currentMonthKey)} — Actual</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 12, color: "#b0b5c9" }}>{monthToDate.weeksInMonth} week{monthToDate.weeksInMonth > 1 ? "s" : ""} · {monthToDate.totalHrs.toFixed(1)} hrs</span><span style={{ fontSize: 14, fontWeight: 700, color: "#e8eff8", fontFamily: "'DM Mono', monospace" }}>{money(monthToDate.totalCost)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#b0b5c9" }}>Gross payroll</span><span style={{ fontSize: 14, fontWeight: 600, color: "#b0b5c9", fontFamily: "'DM Mono', monospace" }}>{money(monthToDate.totalGross)}</span></div>
        </div>
      )}
      {totals.totalHrs > 0 && (<div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "10px 14px", marginTop: 8, display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, color: "#8d93a5" }}>Effective cost/hr ({totals.totalHrs.toFixed(1)} hrs)</span><span style={{ fontSize: 14, fontWeight: 700, color: "#b0b5c9", fontFamily: "'DM Mono', monospace" }}>{money(totalEmployerCost / totals.totalHrs)}</span></div>)}
      {totals.totalHrs === 0 && (<div style={{ textAlign: "center", color: "#6b7189", fontSize: 13, marginTop: 8 }}>No hours logged this week</div>)}
    </div>
  );

  const hoursBarBlock = totals.totalHrs > 0 && (
    <div style={{ margin: "12px 12px 0", padding: "12px 16px", background: "#fff", borderRadius: 14, boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#8d93a5" }}>Hours this week</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: slate, fontFamily: "'DM Mono', monospace" }}>{totals.totalHrs.toFixed(1)}</span>
      </div>
      <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", height: 10 }}>
        {totals.directChildcareHrs > 0 && <div style={{ flex: totals.directChildcareHrs, background: accent }} />}
        {totals.directHouseholdHrs > 0 && <div style={{ flex: totals.directHouseholdHrs, background: "#7a9ec7" }} />}
        {totals.noahHrs > 0 && <div style={{ flex: totals.noahHrs, background: childColors.Noah }} />}
        {totals.josiahHrs > 0 && <div style={{ flex: totals.josiahHrs, background: childColors.Josiah }} />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 8 }}>
        <LegendDot color={accent} label={`${totals.directChildcareHrs.toFixed(1)}h childcare`} />
        <LegendDot color="#7a9ec7" label={`${totals.directHouseholdHrs.toFixed(1)}h household`} />
        <LegendDot color={childColors.Noah} label={`${totals.noahHrs.toFixed(1)}h Noah respite`} />
        <LegendDot color={childColors.Josiah} label={`${totals.josiahHrs.toFixed(1)}h Josiah respite`} />
      </div>
    </div>
  );

  const pastWeeksBlock = pastKeys.length > 0 && (
    <div style={{ margin: "16px 12px 0" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8d93a5", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10, paddingLeft: 4 }}>Past Weeks</div>
      {pastKeys.map(pk => {
        const m = new Date(pk + "T00:00:00"); const pwc = calcWeekTotals(weeks[pk] || blankWeek());
        if (pwc.totals.totalHrs === 0) return null;
        return (
          <button key={pk} onClick={() => { setCurrentMonday(m); setActiveDay(null); }} style={{
            width: "100%", padding: "12px 16px", background: "#fff", borderRadius: 14, border: "none", marginBottom: 6,
            display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", fontFamily: "'DM Sans', sans-serif",
          }}>
            <div style={{ textAlign: "left" }}><div style={{ fontSize: 13, fontWeight: 600, color: slate }}>{formatWeekRange(m)}</div><div style={{ fontSize: 11, color: "#8d93a5" }}>{pwc.totals.totalHrs.toFixed(1)} hrs</div></div>
            <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 700, color: slate, fontFamily: "'DM Mono', monospace" }}>{money(pwc.grossPayroll)}</div>{view === "employer" && <div style={{ fontSize: 11, color: warm, fontWeight: 600 }}>Cost: {money(pwc.totalEmployerCost)}</div>}</div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(168deg, #f5f7fb 0%, #eef1f8 40%, #f0ede8 100%)", fontFamily: "'DM Sans', sans-serif", maxWidth: 480, margin: "0 auto", paddingBottom: 90 }}>
      {showPin && <PinModal onSuccess={() => { setShowPin(false); setPinUnlocked(true); setView("employer"); }} onCancel={() => setShowPin(false)} />}

      {/* HEADER */}
      <div style={{ background: `linear-gradient(135deg, ${slate} 0%, #3d4260 100%)`, padding: "20px 20px 16px", borderRadius: "0 0 24px 24px", boxShadow: "0 8px 32px rgba(45,49,66,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div><div style={{ fontSize: 10, letterSpacing: 2.5, color: "#8d93a5", textTransform: "uppercase", marginBottom: 2 }}>Hicks Family</div><div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>Timesheet</div></div>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.12)", borderRadius: 12, padding: 3 }}>
            <button onClick={() => setView("nanny")} style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: view === "nanny" ? "#fff" : "transparent", color: view === "nanny" ? slate : "#8d93a5", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", boxShadow: view === "nanny" ? "0 2px 8px rgba(0,0,0,0.15)" : "none" }}>Pay</button>
            <button onClick={handleCostsToggle} style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: view === "employer" ? warm : "transparent", color: view === "employer" ? "#fff" : "#8d93a5", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", boxShadow: view === "employer" ? "0 2px 8px rgba(0,0,0,0.15)" : "none" }}>{pinUnlocked ? "Costs" : "🔒 Costs"}</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={prevWeek} style={navBtn}>‹</button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e8eff8" }}>{formatWeekRange(currentMonday)}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 3 }}>
              {isCurrentWeek && <span style={{ fontSize: 10, color: warm, fontWeight: 600 }}>This Week</span>}
              {isCurrentWeek && isPaymentDay && <span style={{ fontSize: 10, color: "#7dbfa5", fontWeight: 700 }}>📋 Payment Day</span>}
              {isCurrentWeek && isPaymentEve && <span style={{ fontSize: 10, color: "#e8c96a", fontWeight: 700 }}>📋 Payment Due Tomorrow</span>}
            </div>
          </div>
          <button onClick={nextWeek} style={navBtn}>›</button>
        </div>
        {isCurrentWeek && (isPaymentDay || isPaymentEve) && grossPayroll > 0 && (
          <div style={{ marginTop: 12, background: isPaymentDay ? "rgba(122,191,165,0.15)" : "rgba(232,201,106,0.15)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: isPaymentDay ? "#7dbfa5" : "#c9b05a" }}>{isPaymentDay ? "Payment due today" : "Payment due tomorrow"}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "'DM Mono', monospace" }}>{money(grossPayroll)}</span>
          </div>
        )}
      </div>

      {otHrs > 0 && (
        <div style={{ margin: "12px 12px 0", padding: "12px 16px", background: "#fff0f0", border: `1.5px solid ${red}30`, borderRadius: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: red }}>Overtime: {otHrs.toFixed(1)} hrs at 1.5x</div>
            <div style={{ fontSize: 11, color: "#8a4a4a" }}>
              {weeklyOTHrs > 0 ? `${weeklyOTHrs.toFixed(1)} hrs over 40/wk` : ""}{weeklyOTHrs > 0 && totals.dailyOTHrs > 0 ? " + " : ""}{totals.dailyOTHrs > 0 ? `${totals.dailyOTHrs.toFixed(1)} hrs over 8/day` : ""}. CA law requires 1.5x rate.
            </div>
          </div>
        </div>
      )}

      {view === "nanny" ? (
        <>{dayPillsBlock}{firstUseHint}{dayInputBlock}{nannySummaryBlock}{quarterlyCard}</>
      ) : (
        <>{employerSummaryBlock}{quarterlyCard}{dayPillsBlock}{dayInputBlock}</>
      )}

      {hoursBarBlock}
      {pastWeeksBlock}

      {saved && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: slate, color: "#e8eff8", padding: "10px 24px", borderRadius: 30, fontSize: 12, fontWeight: 600, letterSpacing: 0.5, boxShadow: "0 4px 20px rgba(45,49,66,0.3)", zIndex: 100 }}>Saved ✓</div>
      )}
    </div>
  );
}

export default App;
