import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, BedDouble, Calendar, Check, ChevronLeft, ChevronRight, Copy, Footprints, HeartPulse, RefreshCw, Settings2, Sparkles, Tag, Upload, X, Zap,
} from "lucide-react";
import type { BrainState, HealthDay, HealthProfile, Workspace } from "../../types";
import { applyHealthPatches, cleanMetric, cleanTags, HEALTH_METRICS, healthDayId, normalizeHealthDays, normalizeHealthProfile, parseHealthPayload, type HealthDayPatch } from "../../utils/health";
import { importAppleHealthExport } from "../../utils/healthExport";
import { computeHealth, hm, localToday, type HealthInsights } from "../../utils/healthMetrics";
import { sampleHealthDays } from "../../utils/healthSample";
import { computeDeepHealth, type DeepHealth } from "../../utils/healthInsights";
import { InsightList, InsightsView, SleepScoreCard, SleepView } from "./HealthInsightViews";
import { createHealthSyncToken, healthSyncStatus, revokeHealthSync, type HealthSyncStatus } from "../../services/serverApi";
import { managedAuthEnabled } from "../../services/managedAuth";
import { DialogBackdrop } from "../workspace/DialogBackdrop";
import { ScoreRing, TimeChart, type ChartPoint } from "./HealthCharts";
import "../../health.css";

type Update = (update: (state: BrainState) => BrainState) => void;
interface Props { state: BrainState; workspace: Workspace; onChange: Update; onAsk: (prompt: string) => void }
type View = "today" | "sleep" | "insights" | "trends" | "days";

const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
};
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const toneOf = (label: string) => label === "Primed" ? "good" : label === "Normal" ? "neutral" : label === "Strained" ? "warn" : "bad";
const signed = (n: number, digits = 0) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
const shiftDate = (dateStr: string, delta: number): string => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

export function HealthWorkspace({ state, workspace, onChange, onAsk }: Props) {
  const stored = state.healthDays || [];
  const [view, setView] = useState<View>("today");
  const [range, setRange] = useState<30 | 90>(30);
  const [preview, setPreview] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const today = localToday();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const isToday = selectedDate === today;

  const sample = useMemo(() => sampleHealthDays(today), [today]);
  const showingSample = preview && !stored.length;
  const days = showingSample ? sample : stored;
  const insights = useMemo(() => computeHealth(days, workspace.health, selectedDate), [days, workspace.health, selectedDate]);
  const deep = useMemo(() => computeDeepHealth(days, workspace.health, selectedDate), [days, workspace.health, selectedDate]);
  const currentDay = useMemo(() => days.find(d => d.date === selectedDate), [days, selectedDate]);
  const lastDate = stored.length ? stored[stored.length - 1].date : undefined;
  const firstDate = days.length ? days[0].date : undefined;
  const staleDays = lastDate ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastDate}T12:00:00Z`)) / 86400000) : 0;
  const dateInputRef = useRef<HTMLInputElement>(null);

  const shiftDay = (delta: number) => {
    setSelectedDate(prev => {
      const next = shiftDate(prev, delta);
      return next > today ? today : next;
    });
  };

  const triggerDatePicker = () => {
    try {
      if (dateInputRef.current && "showPicker" in HTMLInputElement.prototype) {
        dateInputRef.current.showPicker();
        return;
      }
    } catch {
      // fallback
    }
    dateInputRef.current?.focus();
    dateInputRef.current?.click();
  };

  const saveDay = (day: HealthDay | null, date: string) => onChange(prev => {
    const rest = (prev.healthDays || []).filter(d => d.date !== date);
    return { ...prev, healthDays: day ? normalizeHealthDays([...rest, day]) : rest };
  });
  const saveProfile = (profile: HealthProfile | undefined) => onChange(prev => ({
    ...prev, workspaces: (prev.workspaces || []).map(w => {
      if (w.id !== workspace.id) return w;
      const { health: _h, ...rest } = w;
      return profile ? { ...rest, health: profile } : rest;
    }),
  }));
  /** Merges imported days in. Only changed days are saved; tags and notes are never touched. */
  const applyImport = (patches: HealthDayPatch[], source: string): number => {
    const result = applyHealthPatches(stored, patches, source);
    if (result.changed.length) {
      onChange(prev => ({ ...prev, healthDays: applyHealthPatches(prev.healthDays || [], patches, source).days }));
      const last = patches[patches.length - 1]?.date;
      if (last) setSelectedDate(last);
    }
    setPreview(false);
    return result.changed.length;
  };

  const editingDay = editing ? days.find(d => d.date === editing) || { id: healthDayId(editing), date: editing, metrics: {}, updatedAt: "" } : null;

  return (
    <div className="hl-root">
      <div className="hl-toolbar">
        <div className="hl-toolbar-left">
          <div className="hl-views" role="tablist" aria-label="Health views">
            {(["today", "sleep", "insights", "trends", "days"] as const).map(v => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => {
                  setView(v);
                  if (v === "today" && view === "today" && !isToday) setSelectedDate(today);
                }}
              >
                {v === "today" ? (isToday ? "Today" : "Day") : v === "sleep" ? "Sleep" : v === "insights" ? "Insights" : v === "trends" ? "Trends" : "Days"}
              </button>
            ))}
          </div>

          {days.length > 0 && (view === "today" || view === "sleep" || view === "insights") && (
            <div className="hl-date-nav" role="group" aria-label="Date navigation">
              <button
                type="button"
                className="ws-icon-button"
                aria-label="Previous day"
                title="Previous day"
                onClick={() => shiftDay(-1)}
              >
                <ChevronLeft size={16} />
              </button>
              <div className="hl-date-picker-wrap">
                <button
                  type="button"
                  className="hl-date-pill"
                  onClick={triggerDatePicker}
                  title="Choose specific date"
                >
                  <Calendar size={14} className="ws-text-muted" />
                  <span>{dayLabel(selectedDate)}</span>
                  {isToday && <span className="hl-date-today-badge">Today</span>}
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  max={today}
                  min={firstDate}
                  value={selectedDate}
                  onChange={e => { if (e.target.value) setSelectedDate(e.target.value); }}
                  className="hl-sr-input"
                  aria-label="Date selector"
                />
              </div>
              <button
                type="button"
                className="ws-icon-button"
                aria-label="Next day"
                title="Next day"
                disabled={selectedDate >= today}
                onClick={() => shiftDay(1)}
              >
                <ChevronRight size={16} />
              </button>
              {!isToday && (
                <button
                  type="button"
                  className="ws-button ws-secondary hl-nav-today-btn"
                  onClick={() => setSelectedDate(today)}
                  title="Jump to today"
                >
                  Today
                </button>
              )}
            </div>
          )}
        </div>
        <div className="hl-toolbar-actions">
          <button className={`hl-sync-pill${lastDate && staleDays <= 3 ? " hl-sync-ok" : ""}`} onClick={() => setImportOpen(true)}>
            <Upload size={14} />
            {lastDate ? `Data through ${shortDate(lastDate)} · Import` : "Import Apple Health export"}
          </button>
          <button className="ws-icon-button" aria-label="Health targets" title="Targets" onClick={() => setProfileOpen(true)}><Settings2 size={16} /></button>
        </div>
      </div>
      {notice && <div className="hl-notice" role="status">{notice}<button className="ws-icon-button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></div>}
      {showingSample && <div className="hl-notice hl-notice-sample" role="status"><Sparkles size={15} />Sample data so you can see the layout. Nothing here is yours or saved.<button className="ws-button ws-secondary" onClick={() => setPreview(false)}>Hide sample</button></div>}
      {!showingSample && lastDate && staleDays >= 4 && (
        <div className="hl-notice" role="status">
          <RefreshCw size={15} />Your data ends {dayLabel(lastDate)}, {staleDays} days ago. Export again from the Health app to catch up.
          <button className="ws-button ws-secondary" onClick={() => setImportOpen(true)}>Import</button>
        </div>
      )}

      {!days.length ? (
        <EmptyState onImport={() => setImportOpen(true)} onPreview={() => setPreview(true)} />
      ) : view === "today" ? (
        <DayView
          h={insights}
          deep={deep}
          onOpenSleep={() => setView("sleep")}
          onOpenInsights={() => setView("insights")}
          date={selectedDate}
          day={currentDay}
          isToday={isToday}
          lastDate={lastDate}
          onAsk={onAsk}
          onTagDay={() => setEditing(selectedDate)}
          onJumpToDate={setSelectedDate}
        />
      ) : view === "sleep" ? (
        <SleepView deep={deep} days={days} />
      ) : view === "insights" ? (
        <InsightsView deep={deep} days={days} />
      ) : view === "trends" ? (
        <TrendsView h={insights} deep={deep} days={days} range={range} setRange={setRange} />
      ) : (
        <DaysView
          days={days}
          selectedDate={selectedDate}
          onSelectDate={d => { setSelectedDate(d); setView("today"); }}
          onEdit={setEditing}
          onImport={() => setImportOpen(true)}
          readOnly={showingSample}
        />
      )}

      {importOpen && <ImportDialog lastDate={lastDate} onClose={() => setImportOpen(false)} onImport={applyImport}
        onDone={message => { setImportOpen(false); setNotice(message); }} onAutoSync={() => { setImportOpen(false); setSyncOpen(true); }} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} onImport={() => { setSyncOpen(false); setImportOpen(true); }} />}
      {profileOpen && <ProfileDialog profile={workspace.health} insights={insights} onClose={() => setProfileOpen(false)} onSave={p => { saveProfile(p); setProfileOpen(false); }} />}
      {editingDay && !showingSample && <DayDialog day={editingDay} knownTags={[...new Set(stored.flatMap(d => d.tags || []))]} onClose={() => setEditing(null)}
        onSave={d => { saveDay(d, editingDay.date); setEditing(null); }} />}
    </div>
  );
}

const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function EmptyState({ onImport, onPreview }: { onImport: () => void; onPreview: () => void }) {
  return (
    <div className="hl-empty">
      <span className="ws-icon ws-color-rose"><HeartPulse size={22} /></span>
      <strong>Bring in your Apple Health data</strong>
      <p>Export everything from the Health app on your iPhone and drop it here. Every metric your Watch has ever recorded comes in, and recovery, sleep debt, training load and the rest are worked out against your own baselines.</p>
      <div className="hl-empty-actions">
        <button className="ws-button ws-primary" onClick={onImport}><Upload size={15} />Import Apple Health export</button>
        <button className="ws-button ws-secondary" onClick={onPreview}><Sparkles size={15} />Preview with sample data</button>
      </div>
    </div>
  );
}

type ImportState = { phase: "idle" } | { phase: "reading"; name: string; fraction: number; records: number; lastDate?: string } | { phase: "error"; message: string };

function ImportDialog({ lastDate, onClose, onImport, onDone, onAutoSync }: {
  lastDate?: string; onClose: () => void; onImport: (patches: HealthDayPatch[], source: string) => number; onDone: (message: string) => void; onAutoSync: () => void;
}) {
  const [status, setStatus] = useState<ImportState>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const reading = status.phase === "reading";
  const read = async (file: File) => {
    setStatus({ phase: "reading", name: file.name, fraction: 0, records: 0 });
    try {
      let patches: HealthDayPatch[], source = "Apple Health export";
      if (/\.json$/i.test(file.name)) { patches = parseHealthPayload(JSON.parse(await file.text())); source = "Import"; }
      else patches = (await importAppleHealthExport(file, (fraction, p) => setStatus({ phase: "reading", name: file.name, fraction, records: p.records, lastDate: p.lastDate }))).patches;
      const changed = onImport(patches, source);
      const first = patches[0].date, last = patches[patches.length - 1].date;
      onDone(changed
        ? `Imported ${patches.length.toLocaleString()} days (${shortDate(first)} ${first.slice(0, 4)} to ${shortDate(last)} ${last.slice(0, 4)}). ${changed.toLocaleString()} ${changed === 1 ? "day" : "days"} new or updated.`
        : `Everything in this export (through ${shortDate(last)}) was already here.`);
    } catch (e) {
      setStatus({ phase: "error", message: e instanceof Error ? e.message : "That file could not be read." });
    }
  };
  return (
    <DialogBackdrop label="Import Apple Health export" onClose={() => { if (!reading) onClose(); }} className="ws-overlay">
      <div className="ws-dialog hl-sync-dialog">
        <div className="ws-dialog-heading">
          <div>
            <span className="ws-icon ws-color-rose"><Upload size={22} /></span>
            <h2>Import Apple Health export</h2>
            <p>{lastDate ? `Your data runs through ${dayLabel(lastDate)}. Import a fresh export whenever you like; only new or changed days are saved, and your tags and notes stay.` : "Free, and it brings in every metric your Watch has recorded, all the way back."}</p>
          </div>
          <button className="ws-icon-button" aria-label="Close" disabled={reading} onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          <ol className="hl-steps">
            <li>On your iPhone, open <b>Health</b> and tap your picture in the top right.</li>
            <li>Tap <b>Export All Health Data</b> → <b>Export</b>. It can take a few minutes.</li>
            <li>Save the <b>export.zip</b> to Files or iCloud Drive, or AirDrop it to your Mac.</li>
            <li>Choose it below. You don't need to unzip it.</li>
          </ol>
          {status.phase === "reading" ? (
            <div className="hl-progress" role="status" aria-live="polite">
              <div className="hl-progress-top"><span>Reading {status.name}</span><span>{Math.round(status.fraction * 100)}%</span></div>
              <div className="hl-progress-bar"><span style={{ width: `${Math.max(2, status.fraction * 100)}%` }} /></div>
              <small>{status.records.toLocaleString()} readings so far{status.lastDate ? `, up to ${dayLabel(status.lastDate)}` : ""}. Big exports take a minute; keep this tab open.</small>
            </div>
          ) : (
            <button type="button" className={`hl-drop${dragging ? " hl-drop-over" : ""}`} onClick={() => input.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void read(f); }}>
              <Upload size={20} />
              <strong>Choose export.zip</strong>
              <span>or drop it here · export.xml and Health Auto Export JSON work too</span>
            </button>
          )}
          {status.phase === "error" && <p className="hl-error">{status.message}</p>}
          <p className="hl-muted hl-small">The file is read on this device. Only one summary per day is saved (steps, sleep, heart rate, workouts…), never the raw samples.</p>
          <input ref={input} type="file" accept=".zip,.xml,.json,application/zip,text/xml,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
        </div>
        <div className="ws-dialog-actions">
          <button className="ws-button ws-secondary hl-left" disabled={reading} onClick={onAutoSync}>Automatic sync (optional)</button>
          <button className="ws-button ws-secondary" disabled={reading} onClick={onClose}>Close</button>
        </div>
      </div>
    </DialogBackdrop>
  );
}

function DayView({
  h,
  deep,
  onOpenSleep,
  onOpenInsights,
  date,
  day,
  isToday,
  lastDate,
  onAsk,
  onTagDay,
  onJumpToDate,
}: {
  h: HealthInsights;
  deep: DeepHealth;
  onOpenSleep: () => void;
  onOpenInsights: () => void;
  date: string;
  day?: HealthDay;
  isToday: boolean;
  lastDate?: string;
  onAsk: (p: string) => void;
  onTagDay: () => void;
  onJumpToDate?: (d: string) => void;
}) {
  const r = h.recovery;
  const t = h.training;
  const restingHrVal = day?.metrics.restingHr ?? (isToday ? h.latest?.metrics.restingHr : undefined);
  const hrvVal = day?.metrics.hrv ?? (isToday ? h.latest?.metrics.hrv : undefined);
  const stepsVal = day?.metrics.steps ?? (isToday ? h.steps.today : undefined);

  return (
    <div className="hl-today">
      {h.strain.length > 0 && (
        <div className="hl-alert" role="alert">
          <AlertTriangle size={18} />
          <div><strong>Your body looks under strain</strong>{h.strain.map(s => <p key={s}>{s}</p>)}<small>Patterns from your watch, not a diagnosis. Consider an easier day.</small></div>
        </div>
      )}

      {isToday && !day && lastDate && lastDate < date && onJumpToDate && (
        <div className="hl-notice hl-notice-stale-day" role="status">
          <RefreshCw size={15} />
          <span>No health data recorded for today yet. Latest data is from {dayLabel(lastDate)}.</span>
          <button type="button" className="ws-button ws-secondary" onClick={() => onJumpToDate(lastDate)}>
            View {shortDate(lastDate)} summary →
          </button>
        </div>
      )}

      <div className="hl-hero">
        <section className="hl-card hl-recovery">
          <header><span>Recovery</span><small>{r ? dayLabel(r.date) : dayLabel(date)}</small></header>
          {r ? (
            <div className="hl-recovery-body">
              <ScoreRing score={r.score} tone={toneOf(r.label)} />
              <div>
                <strong className={`hl-label hl-tone-${toneOf(r.label)}`}>{r.label}</strong>
                <p className="hl-muted">60 is a normal day for you.</p>
                <ul className="hl-components">
                  {r.components.map(c => (
                    <li key={c.key}><span className={`hl-mark ${c.good ? "hl-good" : "hl-bad"}`} aria-hidden="true">{c.good ? "▲" : "▼"}</span><b>{c.label}</b> {c.detail}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="hl-muted hl-pad">
              <p>
                {h.dayCount >= 7
                  ? `No recovery reading recorded for ${isToday ? "today" : dayLabel(date)}.`
                  : `Needs about a week of HRV or resting heart rate to learn your normal. ${h.dayCount} day${h.dayCount === 1 ? "" : "s"} so far.`}
              </p>
              {lastDate && date !== lastDate && onJumpToDate && (
                <button
                  type="button"
                  className="ws-button ws-secondary"
                  style={{ marginTop: 8 }}
                  onClick={() => onJumpToDate(lastDate)}
                >
                  View latest data from {shortDate(lastDate)}
                </button>
              )}
            </div>
          )}
          <footer>
            <button
              className="ws-button ws-secondary"
              onClick={() =>
                onAsk(
                  isToday
                    ? "Look at my health summary and tell me how hard I should train today and why. Keep it short."
                    : `Look at my health summary for ${dayLabel(date)} and tell me how my recovery and training looked. Keep it short.`
                )
              }
            >
              <Sparkles size={14} />{isToday ? "Ask Iris about today" : `Ask Iris about ${shortDate(date)}`}
            </button>
            <button className="ws-button ws-secondary" onClick={onTagDay}><Tag size={14} />{isToday ? "Tag today" : `Tag ${shortDate(date)}`}</button>
          </footer>
        </section>
        <SleepScoreCard night={deep.night} usual={deep.usual.sleepScore} onOpen={onOpenSleep} />
        <section className="hl-card">
          <header><span>Training load</span><Zap size={16} className="ws-text-amber" /></header>
          <div className="hl-big">{t.ratio !== undefined ? t.ratio.toFixed(2) : "—"}<small>{t.zone ? `${t.zone.toLowerCase()} · 7-day vs 42-day` : "needs a few weeks"}</small></div>
          <dl className="hl-facts">
            <div><dt>Fatigue (7 d)</dt><dd>{Math.round(t.fatigue)}</dd></div>
            <div><dt>Fitness (42 d)</dt><dd>{Math.round(t.fitness)}</dd></div>
            <div><dt>Form</dt><dd>{signed(t.form)}</dd></div>
          </dl>
          <p className="hl-muted hl-small">0.8–1.3 builds fitness safely; above 1.5 is a spike. Max HR {t.maxHr} ({t.maxHrSource}).</p>
          {day?.workouts && day.workouts.length > 0 && (
            <div className="hl-day-workouts">
              <dt className="hl-muted hl-small">Workouts on this day</dt>
              <div className="hl-workout-chips">
                {day.workouts.map((w, i) => (
                  <span key={i} className="hl-workout-chip">
                    <b>{w.type}</b> {w.minutes}m
                    {w.avgHr ? ` · avg ${w.avgHr} bpm` : ""}
                    {w.distanceKm ? ` · ${w.distanceKm.toFixed(1)} km` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      <InsightList insights={deep.insights} patterns={deep.patterns} limit={4} onMore={onOpenInsights} />
      <div className="ws-stats">
        {[
          { label: "Resting HR", value: restingHrVal !== undefined ? `${restingHrVal}` : "—", detail: h.baselines.restingHr ? `usual ${Math.round(h.baselines.restingHr.mean)} bpm` : "bpm", icon: HeartPulse, color: "rose" },
          { label: "HRV", value: hrvVal !== undefined ? `${hrvVal}` : "—", detail: h.baselines.hrv ? `usual ${h.baselines.hrv.mean} ms` : "ms", icon: Activity, color: "purple" },
          {
            label: isToday ? "Steps today" : "Steps",
            value: stepsVal !== undefined ? stepsVal.toLocaleString() : "—",
            detail: isToday
              ? `${h.steps.streak}-day streak at ${h.steps.goal.toLocaleString()}`
              : stepsVal !== undefined && stepsVal >= h.steps.goal
              ? `Goal met (${h.steps.goal.toLocaleString()})`
              : `Goal ${h.steps.goal.toLocaleString()}`,
            icon: Footprints,
            color: "green",
          },
          { label: "Cardio fitness", value: h.vo2 ? h.vo2.latest.toFixed(1) : "—", detail: h.vo2?.perMonth !== undefined ? `${signed(h.vo2.perMonth, 1)} per month` : "VO₂ max", icon: BedDouble, color: "blue" },
        ].map(s => (
          <div className="ws-stat" key={s.label}>
            <div><span>{s.label}</span><s.icon size={17} className={`ws-text-${s.color}`} /></div>
            <strong>{s.value}</strong>
            <small>{s.detail}</small>
          </div>
        ))}
      </div>
      {day && (day.tags?.length || day.note) ? (
        <section className="hl-card hl-day-meta">
          {day.tags?.length ? (
            <div className="hl-day-tags">
              <Tag size={14} className="ws-text-muted" />
              {day.tags.map(t => <span key={t} className="hl-chip">{t}</span>)}
            </div>
          ) : null}
          {day.note ? (
            <p className="hl-day-note"><strong className="hl-muted">Note:</strong> {day.note}</p>
          ) : null}
        </section>
      ) : null}
      {h.tagEffects.length > 0 && (
        <section className="hl-card">
          <header><span>What changes your next morning</span><Tag size={16} /></header>
          <ul className="hl-effects">
            {h.tagEffects.slice(0, 6).map(t => (
              <li key={t.tag}>
                <span className="hl-chip">{t.tag}</span><small>{t.days} days</small>
                <span className="hl-effect-list">{t.effects.map(e => <span key={e.key} className={e.better ? "hl-good" : "hl-bad"}>{e.label} {signed(e.diffPct)}%</span>)}</span>
              </li>
            ))}
          </ul>
          <p className="hl-muted hl-small">The morning after a tagged day compared with all other mornings. A pattern, not proof.</p>
        </section>
      )}
    </div>
  );
}

function TrendsView({ h, deep, days, range, setRange }: { h: HealthInsights; deep: DeepHealth; days: HealthDay[]; range: 30 | 90; setRange: (r: 30 | 90) => void }) {
  const scoreBy = new Map(deep.nights.map(n => [n.date, n.score]));
  const series = h.series.slice(-range);
  const pick = (key: "recovery" | "hrv" | "restingHr" | "sleepMin" | "steps" | "fatigue" | "fitness"): ChartPoint[] => series.map(p => ({ date: p.date, value: p[key] }));
  const byDate = new Map(days.map(d => [d.date, d]));
  const metric = (key: string): ChartPoint[] => series.map(p => ({ date: p.date, value: byDate.get(p.date)?.metrics[key] }));
  const hrvB = h.baselines.hrv, rhrB = h.baselines.restingHr;
  const hrvSd = hrvB ? [Math.round(hrvB.mean * Math.exp(-hrvB.sd)), Math.round(hrvB.mean * Math.exp(hrvB.sd))] : undefined;
  return (
    <div className="hl-trends">
      <div className="hl-range" role="group" aria-label="Range">
        {([30, 90] as const).map(r => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r} days</button>)}
      </div>
      {h.trends.length > 0 && (
        <section className="hl-card">
          <header><span>Last 7 days vs the 4 weeks before</span></header>
          <table className="hl-table">
            <thead><tr><th>Metric</th><th>Last 7 days</th><th>Before</th><th>Change</th></tr></thead>
            <tbody>
              {h.trends.map(t => (
                <tr key={t.key}>
                  <td>{t.label}</td>
                  <td>{t.key === "sleepMin" ? hm(t.recent) : `${t.recent.toLocaleString()} ${t.unit}`}</td>
                  <td>{t.key === "sleepMin" ? hm(t.baseline) : `${t.baseline.toLocaleString()} ${t.unit}`}</td>
                  <td className={t.better === undefined ? "" : t.better ? "hl-good" : "hl-bad"}>{signed(t.changePct, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div className="hl-grid2">
        <section className="hl-card"><header><span>Recovery</span></header>
          <TimeChart points={pick("recovery")} label="Recovery" format={v => `${Math.round(v)}`} domain={[0, 100]} goal={{ value: 60, label: "your normal" }} /></section>
        <section className="hl-card"><header><span>HRV</span><small>shaded: your usual range</small></header>
          <TimeChart points={pick("hrv")} label="HRV" format={v => `${Math.round(v)} ms`} band={hrvSd ? { low: hrvSd[0], high: hrvSd[1], label: "Your usual range" } : undefined} /></section>
        <section className="hl-card"><header><span>Resting heart rate</span><small>shaded: your usual range</small></header>
          <TimeChart points={pick("restingHr")} label="Resting HR" format={v => `${Math.round(v)}`} band={rhrB ? { low: rhrB.mean - rhrB.sd, high: rhrB.mean + rhrB.sd, label: "Your usual range" } : undefined} /></section>
        <section className="hl-card"><header><span>Sleep score</span></header>
          <TimeChart points={series.map(p => ({ date: p.date, value: scoreBy.get(p.date) }))} label="Sleep score" format={v => `${Math.round(v)}`} domain={[0, 100]}
            goal={deep.usual.sleepScore !== undefined ? { value: deep.usual.sleepScore, label: "usual" } : undefined} /></section>
        <section className="hl-card"><header><span>Sleep</span><small>lighter bars are under your goal</small></header>
          <TimeChart kind="bar" points={pick("sleepMin")} label="Sleep" format={v => `${(v / 60).toFixed(1)}h`} goal={{ value: h.sleep.goalMin, label: "goal" }} /></section>
        <section className="hl-card"><header><span>Training load</span></header>
          <TimeChart points={pick("fatigue")} label="Fatigue" compare={{ points: pick("fitness"), label: "Fitness" }} format={v => `${Math.round(v)}`} /></section>
        <section className="hl-card"><header><span>Steps</span></header>
          <TimeChart kind="bar" points={pick("steps")} label="Steps" format={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`} goal={{ value: h.steps.goal, label: "goal" }} /></section>
        {series.some(p => byDate.get(p.date)?.metrics.weightKg !== undefined) && (
          <section className="hl-card"><header><span>Weight</span></header>
            <TimeChart points={metric("weightKg")} label="Weight" format={v => `${v.toFixed(1)} kg`} /></section>
        )}
      </div>
    </div>
  );
}

function DaysView({
  days,
  selectedDate,
  onSelectDate,
  onEdit,
  onImport,
  readOnly,
}: {
  days: HealthDay[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onEdit: (date: string) => void;
  onImport: () => void;
  readOnly: boolean;
}) {
  const recent = [...days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90);
  const today = localToday();
  return (
    <section className="hl-card">
      <header><span>Daily log</span>{!readOnly && <button className="ws-button ws-secondary" onClick={onImport}><Upload size={14} />Import file</button>}</header>
      <div className="hl-table-wrap">
        <table className="hl-table hl-days">
          <thead><tr><th>Day</th><th>Sleep</th><th>HRV</th><th>Resting HR</th><th>Steps</th><th>Workouts</th><th>Tags</th></tr></thead>
          <tbody>
            {recent.map(d => {
              const isSelected = d.date === selectedDate;
              return (
                <tr
                  key={d.date}
                  className={isSelected ? "hl-row-selected" : undefined}
                  onClick={() => onSelectDate(d.date)}
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter") onSelectDate(d.date); }}
                  title={`View ${dayLabel(d.date)} summary`}
                >
                  <td>
                    <div className="hl-day-cell">
                      <span className="hl-day-name">{dayLabel(d.date)}</span>
                      {d.date === today && <span className="hl-day-badge">Today</span>}
                    </div>
                  </td>
                  <td>{d.metrics.sleepMin !== undefined ? hm(d.metrics.sleepMin) : "—"}</td>
                  <td>{d.metrics.hrv ?? "—"}</td>
                  <td>{d.metrics.restingHr ?? "—"}</td>
                  <td>{d.metrics.steps?.toLocaleString() ?? "—"}</td>
                  <td>{d.workouts?.map(w => `${w.type} ${w.minutes}m`).join(", ") || "—"}</td>
                  <td>
                    <div className="hl-tag-cell">
                      {(d.tags || []).map(t => <span key={t} className="hl-chip">{t}</span>)}
                      {d.note && <span className="hl-muted" title={d.note}> ✎</span>}
                      {!readOnly && (
                        <button
                          type="button"
                          className="ws-icon-button hl-day-edit-btn"
                          title={`Edit tags and notes for ${dayLabel(d.date)}`}
                          aria-label={`Edit ${dayLabel(d.date)}`}
                          onClick={e => {
                            e.stopPropagation();
                            onEdit(d.date);
                          }}
                        >
                          <Tag size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const QUICK_TAGS = ["alcohol", "late caffeine", "late meal", "late screen", "sick", "stressed", "travel", "hard workout", "rest day", "meditated"];
const EDITABLE = ["sleepMin", "restingHr", "hrv", "steps", "weightKg"];

function DayDialog({ day, knownTags, onClose, onSave }: { day: HealthDay; knownTags: string[]; onClose: () => void; onSave: (day: HealthDay | null) => void }) {
  const [tags, setTags] = useState<string[]>(day.tags || []);
  const [note, setNote] = useState(day.note || "");
  const [custom, setCustom] = useState("");
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(EDITABLE.map(k => [k, day.metrics[k] !== undefined ? String(k === "sleepMin" ? +(day.metrics[k] / 60).toFixed(2) : day.metrics[k]) : ""])));
  const toggle = (t: string) => setTags(list => list.includes(t) ? list.filter(x => x !== t) : cleanTags([...list, t]));
  const options = [...new Set([...QUICK_TAGS, ...knownTags, ...tags])];
  const save = () => {
    const metrics = { ...day.metrics };
    for (const k of EDITABLE) {
      const raw = values[k].trim();
      if (!raw) { delete metrics[k]; continue; }
      const v = cleanMetric(k, k === "sleepMin" ? Number(raw) * 60 : Number(raw));
      if (v !== undefined) metrics[k] = v;
    }
    const next: HealthDay = { ...day, metrics, tags: cleanTags(tags), note: note.trim(), updatedAt: new Date().toISOString(), source: day.source || "manual" };
    if (!next.tags?.length) delete next.tags;
    if (!next.note) delete next.note;
    onSave(next);
  };
  return (
    <DialogBackdrop label={`Edit ${dayLabel(day.date)}`} onClose={onClose} className="ws-overlay">
      <form className="ws-dialog" onSubmit={e => { e.preventDefault(); save(); }}>
        <div className="ws-dialog-heading">
          <div><h2>{dayLabel(day.date)}</h2><p>Tag what happened the day before a morning to learn what helps and hurts your recovery.</p></div>
          <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          <fieldset>
            <legend>Tags</legend>
            <div className="hl-tag-picker">
              {options.map(t => <button type="button" key={t} aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>{tags.includes(t) && <Check size={13} />}{t}</button>)}
            </div>
            <div className="hl-inline">
              <input value={custom} placeholder="Add your own tag" maxLength={40} onChange={e => setCustom(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (custom.trim()) { toggle(custom); setCustom(""); } } }} />
              <button type="button" className="ws-button ws-secondary" disabled={!custom.trim()} onClick={() => { toggle(custom); setCustom(""); }}>Add</button>
            </div>
          </fieldset>
          <label>Note <small>optional</small><textarea rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label>
          <fieldset>
            <legend>Correct a reading <small>optional</small></legend>
            <div className="hl-metric-grid">
              {EDITABLE.map(k => { const m = HEALTH_METRICS.find(x => x.key === k)!; return (
                <label key={k}>{k === "sleepMin" ? "Sleep (hours)" : `${m.label} (${m.unit})`}
                  <input inputMode="decimal" value={values[k]} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))} /></label>
              ); })}
            </div>
          </fieldset>
        </div>
        <div className="ws-dialog-actions">
          {day.updatedAt && <button type="button" className="ws-button ws-secondary hl-danger" onClick={() => { if (window.confirm("Delete everything stored for this day?")) onSave(null); }}>Delete day</button>}
          <button type="button" className="ws-button ws-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="ws-button ws-primary">Save</button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

function ProfileDialog({ profile, insights, onClose, onSave }: { profile?: HealthProfile; insights: HealthInsights; onClose: () => void; onSave: (p: HealthProfile | undefined) => void }) {
  const [sleep, setSleep] = useState(profile?.sleepGoalMin ? String(profile.sleepGoalMin / 60) : "");
  const [steps, setSteps] = useState(profile?.stepGoal ? String(profile.stepGoal) : "");
  const [maxHr, setMaxHr] = useState(profile?.maxHr ? String(profile.maxHr) : "");
  const [born, setBorn] = useState(profile?.birthYear ? String(profile.birthYear) : "");
  const [sex, setSex] = useState<"" | "female" | "male">(profile?.sex || "");
  const int = (s: string) => s.trim() ? Math.round(Number(s)) : undefined;
  return (
    <DialogBackdrop label="Health targets" onClose={onClose} className="ws-overlay">
      <form className="ws-dialog" onSubmit={e => { e.preventDefault(); onSave(normalizeHealthProfile({ sleepGoalMin: sleep.trim() ? Math.round(Number(sleep) * 60) : undefined, stepGoal: int(steps), maxHr: int(maxHr), birthYear: int(born), sex: sex || undefined })); }}>
        <div className="ws-dialog-heading">
          <div><h2>Your targets</h2><p>Metrics are measured against these. Leave a field empty to use the default.</p></div>
          <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          <div className="hl-metric-grid">
            <label>Sleep goal (hours)<input inputMode="decimal" placeholder="8" value={sleep} onChange={e => setSleep(e.target.value)} /></label>
            <label>Daily steps<input inputMode="numeric" placeholder="8000" value={steps} onChange={e => setSteps(e.target.value)} /></label>
            <label>Max heart rate<input inputMode="numeric" placeholder={`${insights.training.maxHr}`} value={maxHr} onChange={e => setMaxHr(e.target.value)} /></label>
            <label>Birth year<input inputMode="numeric" placeholder="2004" value={born} onChange={e => setBorn(e.target.value)} /></label>
            <label>Training-load weighting<select value={sex} onChange={e => setSex(e.target.value as typeof sex)}><option value="">Default</option><option value="female">Female</option><option value="male">Male</option></select></label>
          </div>
          <p className="hl-muted hl-small">Max HR now: {insights.training.maxHr} bpm, {insights.training.maxHrSource}.</p>
        </div>
        <div className="ws-dialog-actions">
          <button type="button" className="ws-button ws-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="ws-button ws-primary">Save targets</button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="hl-copy">
      <span>{label}</span>
      <code>{value}</code>
      <button type="button" className="ws-icon-button" aria-label={`Copy ${label}`} onClick={() => { void navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        {done ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function SyncDialog({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const [status, setStatus] = useState<HealthSyncStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [how, setHow] = useState<"hae" | "shortcut">("hae");
  useEffect(() => {
    if (!managedAuthEnabled) { setError("Automatic sync needs the hosted, signed-in version of the app. You can still import files here."); return; }
    healthSyncStatus().then(setStatus).catch(e => setError(e.message));
  }, []);
  const run = (fn: () => Promise<HealthSyncStatus>) => { setBusy(true); setError(""); fn().then(setStatus).catch(e => setError(e.message)).finally(() => setBusy(false)); };
  const token = status?.token;
  return (
    <DialogBackdrop label="Automatic Apple Health sync" onClose={onClose} className="ws-overlay">
      <div className="ws-dialog hl-sync-dialog">
        <div className="ws-dialog-heading">
          <div>
            <span className="ws-icon ws-color-rose"><RefreshCw size={22} /></span>
            <h2>Automatic Apple Health sync</h2>
            <p>Apple keeps Health data on your iPhone, so the phone sends it here on a schedule. Set it up once and it keeps the workspace current.</p>
          </div>
          <button className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="ws-form-body">
          {error && <p className="hl-error">{error}</p>}
          {status && !status.available && <p className="hl-error">The server is missing SUPABASE_SERVICE_ROLE_KEY, which sync needs to know whose data arrived.</p>}
          {status?.connected && !token && (
            <div className="hl-status">
              <Check size={16} />
              <div><strong>Connected · token ending {status.hint}</strong>
                <p>{status.lastSyncAt ? `Last sync ${ago(status.lastSyncAt)} from ${status.lastSyncSource || "your phone"} (${status.lastSyncDays} days).` : "Waiting for the first sync from your phone."}</p></div>
            </div>
          )}
          {token && <div className="hl-status hl-status-new"><AlertTriangle size={16} /><div><strong>Copy your token now</strong><p>It is shown only once. Anyone with it can add health data to your account, so keep it in the export app only.</p></div></div>}
          {status && (
            <>
              <Copyable label="URL" value={status.endpoint} />
              {token && <Copyable label="Header" value={`x-health-token: ${token}`} />}
              {!token && <p className="hl-muted hl-small">{status.connected ? "Lost the token? Create a new one; the old one stops working." : "Create a token to start."}</p>}
              <div className="hl-views" role="tablist" aria-label="Sync method">
                <button role="tab" aria-selected={how === "hae"} onClick={() => setHow("hae")}>Health Auto Export app</button>
                <button role="tab" aria-selected={how === "shortcut"} onClick={() => setHow("shortcut")}>iOS Shortcut (free)</button>
              </div>
              {how === "hae" ? (
                <ol className="hl-steps">
                  <li>Install <b>Health Auto Export – JSON+CSV</b> on your iPhone and allow it to read Health. Automations need its premium tier.</li>
                  <li>Automations → New automation → <b>REST API</b>. Paste the URL above.</li>
                  <li>Add a header: key <code>x-health-token</code>, value your token.</li>
                  <li>Data type <b>Health Metrics</b>, format <b>JSON</b>, date range <b>Last 7 days</b>, <b>Aggregate data</b> on, time grouping <b>Day</b>.</li>
                  <li>Pick metrics: step count, active energy, exercise time, stand hours, resting heart rate, heart rate variability, heart rate, respiratory rate, sleep analysis, VO₂ max, weight, blood oxygen, sleeping wrist temperature, time in daylight. Add a second automation with data type <b>Workouts</b> for training load.</li>
                  <li>Sync cadence <b>every hour</b>. Tap <b>Manual export</b> once to test; this dialog shows the sync.</li>
                </ol>
              ) : (
                <ol className="hl-steps">
                  <li>Shortcuts → Automation → <b>Time of Day</b> (e.g. 9:00 AM daily) → Run immediately.</li>
                  <li>For each metric, add <b>Find Health Samples</b> (e.g. Resting Heart Rate, today, latest 1) and for sums use Steps / Active Energy with <b>Calculate Statistics → Sum</b>.</li>
                  <li>Add <b>Get Contents of URL</b>: the URL above, method POST, header <code>x-health-token</code>, request body JSON with <code>date</code> (Format Date as yyyy-MM-dd) and any of <code>steps</code>, <code>activeKcal</code>, <code>exerciseMin</code>, <code>restingHr</code>, <code>hrv</code>, <code>respRate</code>, <code>sleepHours</code>, <code>sleepStart</code>/<code>sleepEnd</code> (yyyy-MM-dd HH:mm), <code>weightKg</code>, <code>vo2max</code>.</li>
                  <li>Run it once by hand to check. Fewer metrics than the app, but free.</li>
                </ol>
              )}
            </>
          )}
        </div>
        <div className="ws-dialog-actions">
          <button className="ws-button ws-secondary" onClick={onImport}><Upload size={14} />Import a file instead</button>
          {status?.connected && <button className="ws-button ws-secondary hl-danger" disabled={busy} onClick={() => { if (window.confirm("Turn off sync? The phone's token stops working; your data stays.")) run(revokeHealthSync); }}>Turn off</button>}
          {status?.available && <button className="ws-button ws-primary" disabled={busy} onClick={() => run(createHealthSyncToken)}>{status.connected ? "Create new token" : "Create sync token"}</button>}
        </div>
      </div>
    </DialogBackdrop>
  );
}
