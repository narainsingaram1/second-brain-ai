import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import {
  ArrowLeftRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Edit3,
  Layers,
  Plus,
  Ruler,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  BodyMeasurements,
  BrainState,
  HealthDay,
  HealthProfile,
  ProgressPhoto,
  ProgressPhotoPose,
  Workspace,
} from "../../types";
import {
  cachedImageUrl,
  imageBlob,
  resolveImageUrl,
  storeNoteImage,
} from "../../services/noteImageStore";
import { prepareImage, type PreparedImage } from "../../utils/imageInput";
import { prepareProgressPhotoImage } from "../../utils/noteImages";
import {
  MEASUREMENT_DEFS,
  PHOTO_PHASES,
  PROGRESS_POSES,
  QUICK_PHOTO_TAGS,
  compareProgressPhotos,
  computeBodyAnalytics,
  fmtLength,
  fromLengthUnit,
  photoWeightContext,
  poseLabel,
  toLengthUnit,
  type LengthUnit,
} from "../../utils/bodyProgress";
import {
  addDays,
  daysBetween,
  fmtWeight,
  fromUnit,
  toUnit,
  type WeightUnit,
} from "../../utils/training";
import { DialogBackdrop } from "../workspace/DialogBackdrop";
import {
  BodyWeightChart,
  TimeChart,
  WeightChangeBarChart,
  type WeightChangeBarItem,
} from "./HealthCharts";

export type BodySubView = "weight" | "photos" | "compare";
type RangeKey = "14d" | "30d" | "90d" | "180d" | "all";
type ChangeMode = "weekly" | "cumulative" | "daily";
type PhotoLayout = "timeline" | "grid";
type CompareMode = "side" | "slider" | "overlay";

export interface BodyProgressProps {
  state: BrainState;
  workspace: Workspace;
  days: HealthDay[];
  photos: ProgressPhoto[];
  unit: WeightUnit;
  lengthUnit: LengthUnit;
  today: string;
  focusPhotoId?: string | null;
  onClearFocusPhoto?: () => void;
  onSetUnits: (patch: { weightUnit?: WeightUnit; lengthUnit?: LengthUnit }) => void;
  onUpdateProfile: (patch: Partial<HealthProfile>) => void;
  onLogBodyDay: (
    date: string,
    patch: {
      weightKg?: number | null;
      bodyFatPct?: number | null;
      measurements?: Partial<Record<keyof BodyMeasurements, number | null>>;
      note?: string;
    }
  ) => void;
  onSavePhotos: (
    photos: ProgressPhoto[],
    alsoLogDay?: {
      date: string;
      weightKg?: number;
      bodyFatPct?: number;
      measurements?: BodyMeasurements;
    }
  ) => void;
  onUpdatePhoto: (photo: ProgressPhoto) => void;
  onDeletePhoto: (id: string) => void;
  onAsk: (prompt: string, images?: PreparedImage[]) => void;
}

const LONG_DATE = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const SHORT_DATE = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const fmtSigned = (v: number, digits = 1, suffix = "") => {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  const body = Math.abs(r) < 10 ** -(digits + 1) ? (0).toFixed(digits) : r.toFixed(digits);
  return `${r > 0 ? "+" : ""}${body}${suffix}`;
};

const fmtDeltaWeight = (deltaKg: number | undefined, unit: WeightUnit) => {
  if (deltaKg === undefined) return "—";
  return fmtSigned(toUnit(deltaKg, unit), 1, ` ${unit}`);
};

const fmtDeltaLength = (deltaCm: number | undefined, unit: LengthUnit) => {
  if (deltaCm === undefined) return "—";
  return fmtSigned(toLengthUnit(deltaCm, unit), 1, ` ${unit}`);
};

const fmtFeetInches = (cm: number | undefined) => {
  if (!cm) return "";
  const totalIn = Math.round(cm / 2.54);
  const ft = Math.floor(totalIn / 12);
  const inches = totalIn % 12;
  return `${ft}'${inches}"`;
};

const roundNum = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;
const parseNum = (s: string) => {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
};

const localTimeNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

async function photoToPreparedImage(photo: ProgressPhoto, name: string): Promise<PreparedImage> {
  const blob = await imageBlob(photo.imageRef);
  return prepareImage(blob, name);
}

/** Loads a stored progress image (`synapse-img:...`) asynchronously while using synchronous memory cache if hot. */
function StoredPhotoImg({
  imageRef,
  alt,
  className,
  style,
}: {
  imageRef: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [url, setUrl] = useState<string | undefined>(() => cachedImageUrl(imageRef));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hot = cachedImageUrl(imageRef);
    setUrl(hot);
    setFailed(false);
    if (hot) return;
    let alive = true;
    resolveImageUrl(imageRef)
      .then(resolved => {
        if (alive) setUrl(resolved);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [imageRef]);

  if (failed) {
    return (
      <div className={`hl-photo-fallback ${className || ""}`}>
        <Camera size={22} />
        <span>Unavailable</span>
      </div>
    );
  }
  if (!url) {
    return <div className={`hl-photo-loading ${className || ""}`} aria-hidden="true" />;
  }
  return <img src={url} alt={alt} className={className} style={style} draggable={false} />;
}

export function BodyProgressView(props: BodyProgressProps) {
  const {
    workspace,
    days,
    photos,
    unit,
    lengthUnit,
    today,
    focusPhotoId,
    onClearFocusPhoto,
    onSetUnits,
    onUpdateProfile,
    onLogBodyDay,
    onSavePhotos,
    onUpdatePhoto,
    onDeletePhoto,
    onAsk,
  } = props;

  const profile = workspace.health;
  const analytics = useMemo(
    () => computeBodyAnalytics(days, photos, profile, today),
    [days, photos, profile, today]
  );

  const [sub, setSub] = useState<BodySubView>(() =>
    photos.length > 0 && analytics.totalWeighIns === 0 ? "photos" : "weight"
  );
  const [addPhotoOpen, setAddPhotoOpen] = useState(false);
  const [addPhotoPresetDate, setAddPhotoPresetDate] = useState<string | undefined>(undefined);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Jump cleanly when a chat source pill points to a progress photo.
  useEffect(() => {
    if (!focusPhotoId) return;
    const found = photos.find(p => p.id === focusPhotoId);
    if (found) {
      setSub("photos");
      setInspectingId(found.id);
    }
    onClearFocusPhoto?.();
  }, [focusPhotoId, photos, onClearFocusPhoto]);

  const flash = (msg: string) => {
    setStatusMsg(msg);
  };

  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(null), 3200);
    return () => clearTimeout(t);
  }, [statusMsg]);

  const sortedPhotos = useMemo(
    () => [...photos].sort((a, b) => b.date.localeCompare(a.date) || (b.time || "").localeCompare(a.time || "") || b.createdAt.localeCompare(a.createdAt)),
    [photos]
  );

  const openAddPhoto = (presetDate?: string) => {
    setAddPhotoPresetDate(presetDate);
    setAddPhotoOpen(true);
  };

  const setCompareSlot = (slot: "A" | "B", id: string) => {
    if (slot === "A") setCompareAId(id);
    else setCompareBId(id);
  };

  const openPhotoCompareWithLatest = (photo: ProgressPhoto) => {
    const samePoseNewest = [...photos]
      .filter(p => p.id !== photo.id && p.pose === photo.pose)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const anyNewest = sortedPhotos.find(p => p.id !== photo.id);
    const partner = samePoseNewest || anyNewest;
    if (partner) {
      const firstIsOlder = photo.date <= partner.date;
      setCompareAId(firstIsOlder ? photo.id : partner.id);
      setCompareBId(firstIsOlder ? partner.id : photo.id);
    } else {
      setCompareAId(photo.id);
    }
    setInspectingId(null);
    setSub("compare");
  };

  const inspectingPhoto = inspectingId ? photos.find(p => p.id === inspectingId) : undefined;

  return (
    <div className="hl-body-view">
      {/* Top Sub-Navigation & Unit Bar */}
      <div className="hl-body-bar">
        <div className="hl-subtabs" role="tablist" aria-label="Body tracking sections">
          <button
            role="tab"
            aria-selected={sub === "weight"}
            className={`hl-subtab${sub === "weight" ? " is-active" : ""}`}
            onClick={() => setSub("weight")}
          >
            <Scale size={14} />
            Weight &amp; Graphs
            {analytics.totalWeighIns > 0 && <span className="hl-pill-count">{analytics.totalWeighIns}</span>}
          </button>
          <button
            role="tab"
            aria-selected={sub === "photos"}
            className={`hl-subtab${sub === "photos" ? " is-active" : ""}`}
            onClick={() => setSub("photos")}
          >
            <Camera size={14} />
            Progress Photos
            {photos.length > 0 && <span className="hl-pill-count">{photos.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={sub === "compare"}
            className={`hl-subtab${sub === "compare" ? " is-active" : ""}`}
            onClick={() => setSub("compare")}
          >
            <Columns2 size={14} />
            Compare
          </button>
        </div>

        <div className="hl-body-actions">
          <div className="hl-unit-group" aria-label="Weight unit">
            {(["lb", "kg"] as const).map(u => (
              <button
                key={u}
                type="button"
                className={`hl-seg-btn${unit === u ? " is-active" : ""}`}
                onClick={() => onSetUnits({ weightUnit: u })}
              >
                {u}
              </button>
            ))}
          </div>
          <div className="hl-unit-group" aria-label="Length unit">
            {(["in", "cm"] as const).map(u => (
              <button
                key={u}
                type="button"
                className={`hl-seg-btn${lengthUnit === u ? " is-active" : ""}`}
                onClick={() => onSetUnits({ lengthUnit: u })}
              >
                {u}
              </button>
            ))}
          </div>
          <button type="button" className="ws-button ws-primary hl-add-photo-cta" onClick={() => openAddPhoto()}>
            <Plus size={14} /> Add Photo
          </button>
        </div>
      </div>

      {statusMsg && <div className="hl-inline-toast" role="status">{statusMsg}</div>}

      {sub === "weight" && (
        <WeightAndGraphsSection
          days={days}
          photos={photos}
          analytics={analytics}
          profile={profile}
          unit={unit}
          lengthUnit={lengthUnit}
          today={today}
          onUpdateProfile={onUpdateProfile}
          onLogBodyDay={(d, p) => {
            onLogBodyDay(d, p);
            flash(`Saved body check-in for ${SHORT_DATE(d)}`);
          }}
          onInspectDatePhoto={date => {
            const matches = photos.filter(p => p.date === date);
            const preferred = matches.find(p => p.pose === "front") || matches[0];
            if (preferred) setInspectingId(preferred.id);
          }}
          onOpenPhotos={() => setSub("photos")}
          onOpenAddPhoto={() => openAddPhoto()}
          onAsk={onAsk}
        />
      )}

      {sub === "photos" && (
        <ProgressPhotosSection
          days={days}
          photos={sortedPhotos}
          unit={unit}
          lengthUnit={lengthUnit}
          compareAId={compareAId}
          compareBId={compareBId}
          onSetCompare={setCompareSlot}
          onClearCompare={() => { setCompareAId(null); setCompareBId(null); }}
          onOpenCompare={() => setSub("compare")}
          onInspect={id => setInspectingId(id)}
          onToggleMilestone={photo => onUpdatePhoto({ ...photo, milestone: !photo.milestone, updatedAt: new Date().toISOString() })}
          onOpenAddPhoto={openAddPhoto}
        />
      )}

      {sub === "compare" && (
        <CompareStudio
          days={days}
          photos={photos}
          unit={unit}
          lengthUnit={lengthUnit}
          compareAId={compareAId}
          compareBId={compareBId}
          onChangeA={setCompareAId}
          onChangeB={setCompareBId}
          onSwap={() => {
            setCompareAId(compareBId);
            setCompareBId(compareAId);
          }}
          onOpenAddPhoto={() => openAddPhoto()}
          onInspect={id => setInspectingId(id)}
          onAsk={onAsk}
        />
      )}

      {addPhotoOpen && (
        <AddPhotoDialog
          today={today}
          presetDate={addPhotoPresetDate}
          days={days}
          unit={unit}
          lengthUnit={lengthUnit}
          defaultPhase={photos[photos.length - 1]?.phase}
          onSave={(newPhotos, alsoDay) => {
            onSavePhotos(newPhotos, alsoDay);
            setAddPhotoOpen(false);
            setSub("photos");
            flash(`Added ${newPhotos.length} progress photo${newPhotos.length === 1 ? "" : "s"}`);
          }}
          onClose={() => setAddPhotoOpen(false)}
        />
      )}

      {inspectingPhoto && (
        <PhotoInspectorDialog
          photo={inspectingPhoto}
          orderedPhotos={sortedPhotos}
          days={days}
          profile={profile}
          unit={unit}
          lengthUnit={lengthUnit}
          compareAId={compareAId}
          compareBId={compareBId}
          onNavigate={id => setInspectingId(id)}
          onSetCompare={setCompareSlot}
          onCompareWithLatest={() => openPhotoCompareWithLatest(inspectingPhoto)}
          onSave={updated => {
            onUpdatePhoto(updated);
            flash("Updated progress photo");
          }}
          onDelete={id => {
            onDeletePhoto(id);
            setInspectingId(null);
            flash("Deleted progress photo");
          }}
          onAsk={onAsk}
          onClose={() => setInspectingId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weight & Graphs Section
// ---------------------------------------------------------------------------

function WeightAndGraphsSection({
  days,
  photos,
  analytics,
  profile,
  unit,
  lengthUnit,
  today,
  onUpdateProfile,
  onLogBodyDay,
  onInspectDatePhoto,
  onOpenPhotos,
  onOpenAddPhoto,
  onAsk,
}: {
  days: HealthDay[];
  photos: ProgressPhoto[];
  analytics: ReturnType<typeof computeBodyAnalytics>;
  profile: HealthProfile | undefined;
  unit: WeightUnit;
  lengthUnit: LengthUnit;
  today: string;
  onUpdateProfile: (patch: Partial<HealthProfile>) => void;
  onLogBodyDay: (
    date: string,
    patch: {
      weightKg?: number | null;
      bodyFatPct?: number | null;
      measurements?: Partial<Record<keyof BodyMeasurements, number | null>>;
      note?: string;
    }
  ) => void;
  onInspectDatePhoto: (date: string) => void;
  onOpenPhotos: () => void;
  onOpenAddPhoto: () => void;
  onAsk: (prompt: string, images?: PreparedImage[]) => void;
}) {
  const [range, setRange] = useState<RangeKey>("90d");
  const [changeMode, setChangeMode] = useState<ChangeMode>("weekly");
  const [showRaw, setShowRaw] = useState(true);
  const [showAvg7, setShowAvg7] = useState(true);
  const [showAvg30, setShowAvg30] = useState(false);
  const [showGoal, setShowGoal] = useState(true);
  const [showPhotos, setShowPhotos] = useState(true);
  const [compMode, setCompMode] = useState<"bf" | "mass">("bf");
  const [selectedMeas, setSelectedMeas] = useState<keyof BodyMeasurements>("waistCm");

  // Quick check-in form state
  const [entryDate, setEntryDate] = useState(today);
  const existingDay = days.find(d => d.date === entryDate);
  const [weightInput, setWeightInput] = useState(() =>
    existingDay?.metrics.weightKg !== undefined
      ? String(Math.round(toUnit(existingDay.metrics.weightKg, unit) * 10) / 10)
      : ""
  );
  const [bfInput, setBfInput] = useState(() =>
    existingDay?.metrics.bodyFatPct !== undefined ? String(existingDay.metrics.bodyFatPct) : ""
  );
  const [measInputs, setMeasInputs] = useState<Partial<Record<keyof BodyMeasurements, string>>>({});
  const [noteInput, setNoteInput] = useState("");
  const [showExtraFields, setShowExtraFields] = useState(false);

  // Sync form defaults when selected date or unit changes
  const syncFormForDate = (targetDate: string, targetUnit = unit, targetLenUnit = lengthUnit) => {
    const day = days.find(d => d.date === targetDate);
    setEntryDate(targetDate);
    setWeightInput(
      day?.metrics.weightKg !== undefined
        ? String(Math.round(toUnit(day.metrics.weightKg, targetUnit) * 10) / 10)
        : ""
    );
    setBfInput(day?.metrics.bodyFatPct !== undefined ? String(day.metrics.bodyFatPct) : "");
    const nextMeas: Partial<Record<keyof BodyMeasurements, string>> = {};
    for (const def of MEASUREMENT_DEFS) {
      const cm = day?.metrics[def.key];
      if (cm !== undefined) nextMeas[def.key] = String(Math.round(toLengthUnit(cm, targetLenUnit) * 10) / 10);
    }
    setMeasInputs(nextMeas);
    setNoteInput(day?.note || "");
  };

  useEffect(() => {
    syncFormForDate(entryDate, unit, lengthUnit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, lengthUnit]);

  // Inline targets editor (start / goal / height)
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [startInput, setStartInput] = useState("");
  const [heightInput, setHeightInput] = useState("");

  const openTargets = () => {
    setGoalInput(
      profile?.goalWeightKg !== undefined ? String(Math.round(toUnit(profile.goalWeightKg, unit) * 10) / 10) : ""
    );
    setStartInput(
      profile?.startWeightKg !== undefined ? String(Math.round(toUnit(profile.startWeightKg, unit) * 10) / 10) : ""
    );
    setHeightInput(
      profile?.heightCm !== undefined ? String(Math.round(toLengthUnit(profile.heightCm, lengthUnit) * 10) / 10) : ""
    );
    setTargetsOpen(v => !v);
  };

  const saveTargets = () => {
    const g = parseNum(goalInput);
    const s = parseNum(startInput);
    const h = parseNum(heightInput);
    onUpdateProfile({
      goalWeightKg: g !== undefined && g > 0 ? roundNum(fromUnit(g, unit), 2) : undefined,
      startWeightKg: s !== undefined && s > 0 ? roundNum(fromUnit(s, unit), 2) : undefined,
      heightCm: h !== undefined && h > 0 ? roundNum(fromLengthUnit(h, lengthUnit), 1) : undefined,
    });
    setTargetsOpen(false);
  };

  const saveCheckin = () => {
    const wVal = parseNum(weightInput);
    const bfVal = parseNum(bfInput);
    const measPatch: Partial<Record<keyof BodyMeasurements, number | null>> = {};
    let hasMeas = false;
    for (const def of MEASUREMENT_DEFS) {
      const mVal = parseNum(measInputs[def.key] || "");
      if (mVal !== undefined && mVal > 0) {
        measPatch[def.key] = roundNum(fromLengthUnit(mVal, lengthUnit), 1);
        hasMeas = true;
      }
    }
    if (wVal === undefined && bfVal === undefined && !hasMeas && !noteInput.trim()) return;
    onLogBodyDay(entryDate, {
      ...(wVal !== undefined && wVal > 0 ? { weightKg: roundNum(fromUnit(wVal, unit), 3) } : {}),
      ...(bfVal !== undefined && bfVal >= 2 && bfVal <= 70 ? { bodyFatPct: roundNum(bfVal, 1) } : {}),
      ...(hasMeas ? { measurements: measPatch } : {}),
      ...(noteInput.trim() ? { note: noteInput.trim() } : {}),
    });
    if (hasMeas) setShowExtraFields(false);
  };

  // Filtered points for the chosen date range
  const rangeStart = useMemo(() => {
    const map: Record<RangeKey, number | null> = { "14d": 14, "30d": 30, "90d": 90, "180d": 180, all: null };
    const span = map[range];
    return span ? addDays(today, -span) : null;
  }, [range, today]);

  const rangedPoints = useMemo(
    () => (rangeStart ? analytics.points.filter(p => p.date >= rangeStart) : analytics.points),
    [analytics.points, rangeStart]
  );

  const rangedWeeks = useMemo(
    () => (rangeStart ? analytics.weeklyChanges.filter(w => w.week >= rangeStart) : analytics.weeklyChanges),
    [analytics.weeklyChanges, rangeStart]
  );

  const changeItems = useMemo<WeightChangeBarItem[]>(() => {
    if (changeMode === "weekly") {
      return rangedWeeks
        .filter(w => w.changeKg !== undefined)
        .map(w => ({
          id: w.week,
          label: SHORT_DATE(w.week),
          tooltipTitle: `Week of ${SHORT_DATE(w.week)} (avg ${fmtWeight(w.avgKg, unit)})`,
          deltaKg: w.changeKg!,
          meta: `${w.weighIns} weigh-in${w.weighIns === 1 ? "" : "s"}${w.changePct !== undefined ? ` · ${fmtSigned(w.changePct, 1, "%")}` : ""}`,
        }));
    }
    if (changeMode === "cumulative") {
      return rangedPoints.map(p => ({
        id: p.date,
        label: SHORT_DATE(p.date),
        tooltipTitle: `${LONG_DATE(p.date)} · ${fmtWeight(p.kg, unit)}`,
        deltaKg: p.deltaStartKg,
        meta: `Since start (${fmtWeight(analytics.startKg, unit)})`,
      }));
    }
    return rangedPoints
      .filter(p => p.deltaPrevKg !== undefined)
      .map(p => ({
        id: p.date,
        label: SHORT_DATE(p.date),
        tooltipTitle: `${LONG_DATE(p.date)} · ${fmtWeight(p.kg, unit)}`,
        deltaKg: p.deltaPrevKg!,
        meta: "vs previous weigh-in",
      }));
  }, [changeMode, rangedWeeks, rangedPoints, unit, analytics.startKg]);

  const preferLoss = useMemo(() => {
    if (analytics.goalKg !== undefined && analytics.startKg !== undefined) {
      if (analytics.goalKg < analytics.startKg - 0.2) return true;
      if (analytics.goalKg > analytics.startKg + 0.2) return false;
    }
    return undefined;
  }, [analytics.goalKg, analytics.startKg]);

  const activeMeas = analytics.measurements.find(m => m.key === selectedMeas) || analytics.measurements[0];
  const anyMeasData = analytics.measurements.some(m => m.points.length > 0);
  const recentRows = useMemo(() => [...analytics.points].reverse(), [analytics.points]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const visibleHistory = historyExpanded ? recentRows : recentRows.slice(0, 12);

  return (
    <div className="hl-body-weight-section">
      {/* Quick Body Check-In Strip */}
      <section className="hl-card hl-checkin-card">
        <div className="hl-checkin-main">
          <div className="hl-checkin-field">
            <label htmlFor="hl-ci-date">Date</label>
            <input
              id="hl-ci-date"
              type="date"
              max={today}
              value={entryDate}
              onChange={e => syncFormForDate(e.target.value)}
            />
          </div>
          <div className="hl-checkin-field">
            <label htmlFor="hl-ci-wt">Weight ({unit})</label>
            <input
              id="hl-ci-wt"
              type="number"
              step="0.1"
              min="20"
              max="900"
              placeholder={analytics.latestKg !== undefined ? fmtWeight(analytics.latestKg, unit, false) : unit === "lb" ? "175.0" : "79.5"}
              value={weightInput}
              onChange={e => setWeightInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveCheckin()}
            />
          </div>
          <div className="hl-checkin-field hl-checkin-bf">
            <label htmlFor="hl-ci-bf">Body fat (%)</label>
            <input
              id="hl-ci-bf"
              type="number"
              step="0.1"
              min="2"
              max="70"
              placeholder="Optional"
              value={bfInput}
              onChange={e => setBfInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveCheckin()}
            />
          </div>
          <div className="hl-checkin-btns">
            <button
              type="button"
              className="ws-button ws-secondary"
              aria-expanded={showExtraFields}
              onClick={() => setShowExtraFields(v => !v)}
            >
              <Ruler size={14} /> {showExtraFields ? "Hide measurements" : "+ Measurements & note"}
            </button>
            <button type="button" className="ws-button ws-primary" onClick={saveCheckin}>
              Log check-in
            </button>
          </div>
        </div>

        {showExtraFields && (
          <div className="hl-checkin-extra">
            <div className="hl-meas-grid">
              {MEASUREMENT_DEFS.map(def => (
                <label key={def.key} className="hl-checkin-field">
                  <span>{def.label} ({lengthUnit})</span>
                  <input
                    type="number"
                    step="0.1"
                    min="5"
                    max="250"
                    placeholder="—"
                    value={measInputs[def.key] || ""}
                    onChange={e => setMeasInputs(prev => ({ ...prev, [def.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <label className="hl-checkin-field hl-checkin-note">
              <span>Day note</span>
              <input
                type="text"
                placeholder="Morning fasted, hydration, soreness, travel..."
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveCheckin()}
              />
            </label>
          </div>
        )}
      </section>

      {/* Targets & Baseline Strip */}
      <section className="hl-targets-strip">
        <div className="hl-targets-summary">
          <span>
            <strong>Start:</strong> {analytics.startKg !== undefined ? fmtWeight(analytics.startKg, unit) : "—"}
          </span>
          <span>
            <strong>Goal:</strong> {analytics.goalKg !== undefined ? fmtWeight(analytics.goalKg, unit) : "Not set"}
          </span>
          {profile?.heightCm && (
            <span>
              <strong>Height:</strong> {fmtLength(profile.heightCm, lengthUnit)}
              {lengthUnit === "in" ? ` (${fmtFeetInches(profile.heightCm)})` : ""}
              {analytics.bmi !== undefined ? ` · BMI ${analytics.bmi}` : ""}
            </span>
          )}
          {analytics.goalProgressPct !== undefined && (
            <div className="hl-goal-meter" title={`${analytics.goalProgressPct}% toward goal weight`}>
              <div className="hl-goal-meter-bar" style={{ width: `${analytics.goalProgressPct}%` }} />
              <span>{analytics.goalProgressPct}% to goal</span>
            </div>
          )}
        </div>
        <div className="hl-targets-actions">
          <button type="button" className="ws-button ws-secondary" onClick={openTargets}>
            <SlidersHorizontal size={13} /> {targetsOpen ? "Close targets" : "Edit targets"}
          </button>
          {(analytics.totalWeighIns > 0 || photos.length > 0) && (
            <button
              type="button"
              className="ws-button ws-secondary"
              onClick={() => onAsk("Analyze my body weight trend, weekly rate of change, body composition, and progress toward my goal.")}
            >
              <Sparkles size={13} /> Ask Iris
            </button>
          )}
        </div>
      </section>

      {targetsOpen && (
        <div className="hl-targets-editor">
          <label>
            Starting weight ({unit})
            <input type="number" step="0.1" value={startInput} placeholder="First weigh-in" onChange={e => setStartInput(e.target.value)} />
          </label>
          <label>
            Goal weight ({unit})
            <input type="number" step="0.1" value={goalInput} placeholder="Target" onChange={e => setGoalInput(e.target.value)} />
          </label>
          <label>
            Height ({lengthUnit}{lengthUnit === "in" && heightInput ? ` · ${fmtFeetInches(fromLengthUnit(Number(heightInput) || 0, "in"))}` : ""})
            <input type="number" step="0.5" value={heightInput} placeholder={lengthUnit === "in" ? "70" : "178"} onChange={e => setHeightInput(e.target.value)} />
          </label>
          <div className="hl-targets-save">
            <button type="button" className="ws-button ws-secondary" onClick={() => setTargetsOpen(false)}>Cancel</button>
            <button type="button" className="ws-button ws-primary" onClick={saveTargets}>Save targets</button>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      <div className="hl-stats">
        <div className="ws-stat hl-kpi">
          <span>7-day trend</span>
          <strong>{fmtWeight(analytics.trendKg ?? analytics.latestKg, unit)}</strong>
          <small>
            {analytics.latestKg !== undefined
              ? `Scale: ${fmtWeight(analytics.latestKg, unit)} (${SHORT_DATE(analytics.latestDate!)})`
              : "No weigh-ins yet"}
            {analytics.fluctuationKg !== undefined ? ` · ±${fmtWeight(analytics.fluctuationKg, unit, false)} noise` : ""}
          </small>
        </div>

        <div className="ws-stat hl-kpi">
          <span>Total shift</span>
          <strong className={analytics.totalChangeKg !== undefined && analytics.totalChangeKg < 0 ? "hl-val-down" : analytics.totalChangeKg !== undefined && analytics.totalChangeKg > 0 ? "hl-val-up" : ""}>
            {fmtDeltaWeight(analytics.totalChangeKg, unit)}
            {analytics.totalChangePct !== undefined ? ` (${fmtSigned(analytics.totalChangePct, 1, "%")})` : ""}
          </strong>
          <small>
            30d: {fmtDeltaWeight(analytics.change30Kg, unit)} · 7d: {fmtDeltaWeight(analytics.change7Kg, unit)}
          </small>
        </div>

        <div className="ws-stat hl-kpi">
          <span>{analytics.goalKg !== undefined ? "Goal pace" : "Weekly rate"}</span>
          <strong>
            {analytics.perWeekKg !== undefined
              ? `${fmtDeltaWeight(analytics.perWeekKg, unit)} / wk`
              : analytics.remainingKg !== undefined
                ? `${fmtDeltaWeight(analytics.remainingKg, unit)} left`
                : "Need ≥3 weigh-ins"}
          </strong>
          <small>
            {analytics.remainingKg !== undefined && `${fmtWeight(Math.abs(analytics.remainingKg), unit)} to goal`}
            {analytics.goalDate ? ` · Est. ${SHORT_DATE(analytics.goalDate)}` : analytics.perWeekPct !== undefined ? ` (${fmtSigned(analytics.perWeekPct, 2, "%")}/wk)` : "Set goal for ETA"}
          </small>
        </div>

        <div className="ws-stat hl-kpi">
          <span>{analytics.latestBodyFatPct !== undefined ? "Body composition" : "Progress photos"}</span>
          <strong>
            {analytics.latestBodyFatPct !== undefined
              ? `${analytics.latestBodyFatPct.toFixed(1)}% BF`
              : `${photos.length} photo${photos.length === 1 ? "" : "s"}`}
          </strong>
          <small>
            {analytics.latestLeanMassKg !== undefined
              ? `Lean ${fmtWeight(analytics.latestLeanMassKg, unit)} · Fat ${fmtWeight(analytics.latestFatMassKg, unit)}`
              : photos.length > 0
                ? analytics.daysSinceLastPhoto === 0
                  ? "Latest check-in today"
                  : `${analytics.daysSinceLastPhoto}d since last photo`
                : "Capture your baseline"}
            {" · "}
            <button type="button" className="hl-link-inline" onClick={photos.length ? onOpenPhotos : onOpenAddPhoto}>
              {photos.length ? "Gallery" : "Add photo"}
            </button>
          </small>
        </div>
      </div>

      {/* Main Body Weight Chart Card */}
      <section className="hl-card hl-wt-card">
        <header className="hl-chart-header">
          <div className="hl-chart-title">
            <span>Weight progression</span>
            {rangedPoints.length > 0 && analytics.lowestKg && analytics.highestKg && (
              <small>
                Low {fmtWeight(analytics.lowestKg.kg, unit)} ({SHORT_DATE(analytics.lowestKg.date)}) · High {fmtWeight(analytics.highestKg.kg, unit)} ({SHORT_DATE(analytics.highestKg.date)})
              </small>
            )}
          </div>
          <div className="hl-chart-controls">
            <div className="hl-range-pills" role="group" aria-label="Timeframe">
              {(["14d", "30d", "90d", "180d", "all"] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  className={`hl-chip-btn${range === r ? " is-active" : ""}`}
                  onClick={() => setRange(r)}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="hl-layer-toggles">
          <button type="button" className={`hl-layer-pill hl-lp-avg7${showAvg7 ? " is-on" : ""}`} onClick={() => setShowAvg7(v => !v)}>
            <i /> 7d trend
          </button>
          <button type="button" className={`hl-layer-pill hl-lp-raw${showRaw ? " is-on" : ""}`} onClick={() => setShowRaw(v => !v)}>
            <i /> Scale
          </button>
          <button type="button" className={`hl-layer-pill hl-lp-avg30${showAvg30 ? " is-on" : ""}`} onClick={() => setShowAvg30(v => !v)}>
            <i /> 30d avg
          </button>
          {analytics.goalKg !== undefined && (
            <button type="button" className={`hl-layer-pill hl-lp-goal${showGoal ? " is-on" : ""}`} onClick={() => setShowGoal(v => !v)}>
              <i /> Goal ({fmtWeight(analytics.goalKg, unit)})
            </button>
          )}
          {photos.length > 0 && (
            <button type="button" className={`hl-layer-pill hl-lp-photo${showPhotos ? " is-on" : ""}`} onClick={() => setShowPhotos(v => !v)}>
              <i /> Photo check-ins
            </button>
          )}
        </div>

        <BodyWeightChart
          points={rangedPoints}
          unit={unit}
          showRaw={showRaw}
          showAvg7={showAvg7}
          showAvg30={showAvg30}
          showGoal={showGoal}
          showPhotos={showPhotos}
          goalKg={analytics.goalKg}
          onSelectDate={(date, hasPhotos) => {
            if (hasPhotos) onInspectDatePhoto(date);
            else syncFormForDate(date);
          }}
        />
      </section>

      {/* Weight Change Chart + Body Composition & Measurements Grid */}
      <div className="hl-grid-2">
        <section className="hl-card">
          <header className="hl-chart-header">
            <span>Weight change</span>
            <div className="hl-range-pills" role="group" aria-label="Change view">
              <button type="button" className={`hl-chip-btn${changeMode === "weekly" ? " is-active" : ""}`} onClick={() => setChangeMode("weekly")}>Weekly Δ</button>
              <button type="button" className={`hl-chip-btn${changeMode === "cumulative" ? " is-active" : ""}`} onClick={() => setChangeMode("cumulative")}>Cumulative</button>
              <button type="button" className={`hl-chip-btn${changeMode === "daily" ? " is-active" : ""}`} onClick={() => setChangeMode("daily")}>Daily Δ</button>
            </div>
          </header>
          <WeightChangeBarChart
            items={changeItems}
            unit={unit}
            label={changeMode === "weekly" ? "Weekly weight change" : changeMode === "cumulative" ? "Cumulative weight change" : "Day-to-day weight change"}
            preferLoss={changeMode === "daily" ? undefined : preferLoss}
          />
        </section>

        <section className="hl-card">
          <header className="hl-chart-header">
            <span>Body composition</span>
            <div className="hl-range-pills" role="group" aria-label="Body composition series">
              <button type="button" className={`hl-chip-btn${compMode === "bf" ? " is-active" : ""}`} onClick={() => setCompMode("bf")}>Body fat %</button>
              <button type="button" className={`hl-chip-btn${compMode === "mass" ? " is-active" : ""}`} onClick={() => setCompMode("mass")}>Lean vs fat mass</button>
            </div>
          </header>
          {analytics.bodyFatPoints.length >= 2 ? (
            compMode === "bf" ? (
              <TimeChart
                points={analytics.bodyFatPoints.map(p => ({ date: p.date, value: p.pct }))}
                label="Body fat"
                format={v => `${v.toFixed(1)}%`}
                height={175}
              />
            ) : (
              <TimeChart
                points={analytics.bodyFatPoints.filter(p => p.leanKg !== undefined).map(p => ({ date: p.date, value: toUnit(p.leanKg!, unit) }))}
                compare={{
                  points: analytics.bodyFatPoints.filter(p => p.fatKg !== undefined).map(p => ({ date: p.date, value: toUnit(p.fatKg!, unit) })),
                  label: "Fat mass",
                }}
                label="Lean mass"
                format={v => `${v.toFixed(1)} ${unit}`}
                height={175}
              />
            )
          ) : (
            <div className="hl-chart-empty">
              {analytics.bodyFatPoints.length === 1
                ? `Latest body fat: ${analytics.bodyFatPoints[0].pct.toFixed(1)}% (${SHORT_DATE(analytics.bodyFatPoints[0].date)}). Log one more reading to plot the trend.`
                : "Log Body Fat % on a check-in or progress photo to chart lean mass and fat mass over time."}
            </div>
          )}
        </section>
      </div>

      {/* Measurements Trends */}
      <section className="hl-card">
        <header className="hl-chart-header">
          <div className="hl-chart-title">
            <span>Circumference measurements</span>
            {activeMeas?.latestCm !== undefined && (
              <small>
                Latest {activeMeas.label}: {fmtLength(activeMeas.latestCm, lengthUnit)}
                {activeMeas.changeCm !== undefined ? ` (${fmtDeltaLength(activeMeas.changeCm, lengthUnit)} total)` : ""}
              </small>
            )}
          </div>
          <div className="hl-range-pills" role="group" aria-label="Select measurement">
            {analytics.measurements.map(m => (
              <button
                key={m.key}
                type="button"
                className={`hl-chip-btn${m.key === selectedMeas ? " is-active" : ""}`}
                onClick={() => setSelectedMeas(m.key)}
              >
                {m.label}{m.latestCm !== undefined ? ` · ${fmtLength(m.latestCm, lengthUnit, false)}` : ""}
              </button>
            ))}
          </div>
        </header>
        {activeMeas && activeMeas.points.length >= 2 ? (
          <TimeChart
            points={activeMeas.points.map(p => ({ date: p.date, value: toLengthUnit(p.cm, lengthUnit) }))}
            label={activeMeas.label}
            format={v => `${v.toFixed(1)} ${lengthUnit}`}
            height={170}
          />
        ) : (
          <div className="hl-chart-empty">
            {anyMeasData && activeMeas?.points.length === 1
              ? `${activeMeas.label}: ${fmtLength(activeMeas.points[0].cm, lengthUnit)} on ${SHORT_DATE(activeMeas.points[0].date)}. Add one more check-in to graph changes.`
              : `Tap "+ Measurements & note" above to track waist, chest, arms, hips, and thighs (${lengthUnit}).`}
          </div>
        )}
      </section>

      {/* Weigh-In History Table */}
      {recentRows.length > 0 && (
        <section className="hl-card">
          <header>
            <span>Weigh-in history ({recentRows.length})</span>
            {recentRows.length > 12 && (
              <button type="button" className="hl-link" onClick={() => setHistoryExpanded(v => !v)}>
                {historyExpanded ? "Show recent 12" : `Show all ${recentRows.length}`}
              </button>
            )}
          </header>
          <div className="hl-table-wrap">
            <table className="hl-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Scale</th>
                  <th>7d trend</th>
                  <th>Shift</th>
                  <th>Body fat</th>
                  <th>Check-in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map(row => {
                  const hasDayMetric = days.some(d => d.date === row.date && d.metrics.weightKg !== undefined);
                  return (
                    <tr key={row.date}>
                      <td className="hl-td-day">{LONG_DATE(row.date)}</td>
                      <td><strong>{fmtWeight(row.kg, unit)}</strong></td>
                      <td>{fmtWeight(row.avg7, unit)}</td>
                      <td className={row.deltaPrevKg !== undefined && row.deltaPrevKg < 0 ? "hl-val-down" : row.deltaPrevKg !== undefined && row.deltaPrevKg > 0 ? "hl-val-up" : ""}>
                        {row.deltaPrevKg !== undefined ? fmtDeltaWeight(row.deltaPrevKg, unit) : "—"}
                      </td>
                      <td>{row.bodyFatPct !== undefined ? `${row.bodyFatPct.toFixed(1)}%` : "—"}</td>
                      <td>
                        <div className="hl-row-meta">
                          {row.photoCount > 0 && (
                            <button type="button" className="hl-chip-link" onClick={() => onInspectDatePhoto(row.date)}>
                              <Camera size={12} /> {row.photoCount}
                            </button>
                          )}
                          <span className="hl-source-tag">{row.source === "apple-health" ? "Health" : row.source === "photo" ? "Photo" : "Manual"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="hl-row-actions">
                          <button type="button" className="hl-icon-btn" title="Edit this date in check-in form" onClick={() => syncFormForDate(row.date)}>
                            <Edit3 size={13} />
                          </button>
                          {hasDayMetric && (
                            <button
                              type="button"
                              className="hl-icon-btn is-danger"
                              title="Remove scale weight for this date"
                              onClick={() => onLogBodyDay(row.date, { weightKg: null })}
                            >
                              <Trash2 size={13} />
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress Photos Gallery Section
// ---------------------------------------------------------------------------

function ProgressPhotosSection({
  days,
  photos,
  unit,
  compareAId,
  compareBId,
  onSetCompare,
  onClearCompare,
  onOpenCompare,
  onInspect,
  onToggleMilestone,
  onOpenAddPhoto,
}: {
  days: HealthDay[];
  photos: ProgressPhoto[];
  unit: WeightUnit;
  lengthUnit: LengthUnit;
  compareAId: string | null;
  compareBId: string | null;
  onSetCompare: (slot: "A" | "B", id: string) => void;
  onClearCompare: () => void;
  onOpenCompare: () => void;
  onInspect: (id: string) => void;
  onToggleMilestone: (photo: ProgressPhoto) => void;
  onOpenAddPhoto: (presetDate?: string) => void;
}) {
  const [poseFilter, setPoseFilter] = useState<ProgressPhotoPose | "all">("all");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [milestonesOnly, setMilestonesOnly] = useState(false);
  const [layout, setLayout] = useState<PhotoLayout>("timeline");

  const phases = useMemo(
    () => Array.from(new Set(photos.map(p => p.phase).filter((x): x is string => !!x))),
    [photos]
  );

  const poseCounts = useMemo(() => {
    const counts: Record<string, number> = { all: photos.length };
    for (const p of photos) counts[p.pose] = (counts[p.pose] || 0) + 1;
    return counts;
  }, [photos]);

  const filtered = useMemo(
    () =>
      photos.filter(p => {
        if (poseFilter !== "all" && p.pose !== poseFilter) return false;
        if (phaseFilter !== "all" && p.phase !== phaseFilter) return false;
        if (milestonesOnly && !p.milestone) return false;
        return true;
      }),
    [photos, poseFilter, phaseFilter, milestonesOnly]
  );

  const groupedByDate = useMemo(() => {
    const groups: Array<{ date: string; items: ProgressPhoto[] }> = [];
    for (const p of filtered) {
      const last = groups[groups.length - 1];
      if (last && last.date === p.date) last.items.push(p);
      else groups.push({ date: p.date, items: [p] });
    }
    return groups;
  }, [filtered]);

  const firstWeightKg = useMemo(() => {
    const oldestFirst = [...photos].reverse();
    for (const p of oldestFirst) {
      const w = photoWeightContext(p, days).kg;
      if (w !== undefined) return w;
    }
    return undefined;
  }, [photos, days]);

  const compA = compareAId ? photos.find(p => p.id === compareAId) : undefined;
  const compB = compareBId ? photos.find(p => p.id === compareBId) : undefined;

  const pickCompareNext = (id: string) => {
    if (compareAId === id) { onSetCompare("A", ""); return; }
    if (compareBId === id) { onSetCompare("B", ""); return; }
    if (!compA) onSetCompare("A", id);
    else if (!compB) onSetCompare("B", id);
    else onSetCompare("B", id);
  };

  if (!photos.length) {
    return (
      <section className="hl-card hl-photos-empty">
        <Camera size={28} />
        <h3>Start tracking your progress photos</h3>
        <p>
          Log Front, Side, Back, or Flexed check-ins alongside your weight, body fat %, measurements, phase, and notes.
          Compare any two dates side-by-side, with an interactive split slider, or with Iris visual analysis.
        </p>
        <button type="button" className="ws-button ws-primary" onClick={() => onOpenAddPhoto()}>
          <Plus size={15} /> Upload first progress photo
        </button>
      </section>
    );
  }

  const renderCard = (photo: ProgressPhoto) => {
    const wCtx = photoWeightContext(photo, days);
    const deltaFirst =
      wCtx.kg !== undefined && firstWeightKg !== undefined ? wCtx.kg - firstWeightKg : undefined;
    const isA = compA?.id === photo.id;
    const isB = compB?.id === photo.id;

    return (
      <article key={photo.id} data-record-id={photo.id} className={`hl-photo-card${isA || isB ? " is-selected" : ""}`}>
        <div
          className="hl-photo-frame"
          role="button"
          tabIndex={0}
          onClick={() => onInspect(photo.id)}
          onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onInspect(photo.id))}
        >
          <StoredPhotoImg imageRef={photo.imageRef} alt={`${poseLabel(photo.pose)} progress photo from ${photo.date}`} />
          <div className="hl-photo-top-badges">
            <span className="hl-pose-badge">{poseLabel(photo.pose)}</span>
            {photo.phase && <span className="hl-phase-badge">{photo.phase}</span>}
          </div>
          <div className="hl-photo-top-actions" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className={`hl-card-pin${isA ? " is-a" : isB ? " is-b" : ""}`}
              title={isA ? "Selected as Before (A)" : isB ? "Selected as After (B)" : "Select to compare"}
              onClick={() => pickCompareNext(photo.id)}
            >
              {isA ? "A" : isB ? "B" : <Columns2 size={13} />}
            </button>
            <button
              type="button"
              className={`hl-card-star${photo.milestone ? " is-on" : ""}`}
              title={photo.milestone ? "Unstar milestone" : "Mark as milestone"}
              onClick={() => onToggleMilestone(photo)}
            >
              <Star size={13} fill={photo.milestone ? "currentColor" : "none"} />
            </button>
          </div>
          {(wCtx.kg !== undefined || photo.bodyFatPct !== undefined) && (
            <div className="hl-photo-overlay-metrics">
              {wCtx.kg !== undefined && <strong>{fmtWeight(wCtx.kg, unit)}</strong>}
              {photo.bodyFatPct !== undefined && <span>{photo.bodyFatPct.toFixed(1)}% BF</span>}
            </div>
          )}
        </div>

        <div className="hl-photo-meta" onClick={() => onInspect(photo.id)}>
          <div className="hl-photo-meta-row">
            <span className="hl-photo-date">{SHORT_DATE(photo.date)}{photo.time ? ` · ${photo.time}` : ""}</span>
            {deltaFirst !== undefined && Math.abs(deltaFirst) >= 0.05 && (
              <span className={`hl-photo-delta${deltaFirst < 0 ? " hl-val-down" : " hl-val-up"}`}>
                {fmtDeltaWeight(deltaFirst, unit)} vs start
              </span>
            )}
          </div>
          {photo.tags && photo.tags.length > 0 && (
            <div className="hl-photo-tags">
              {photo.tags.slice(0, 3).map(t => <span key={t}>#{t}</span>)}
            </div>
          )}
          {photo.note && <p className="hl-photo-note">{photo.note}</p>}
        </div>
      </article>
    );
  };

  return (
    <div className="hl-photos-section">
      {/* Filter & Layout Controls */}
      <div className="hl-photos-toolbar">
        <div className="hl-pose-filters" role="group" aria-label="Filter by pose">
          <button
            type="button"
            className={`hl-chip-btn${poseFilter === "all" ? " is-active" : ""}`}
            onClick={() => setPoseFilter("all")}
          >
            All ({poseCounts.all || 0})
          </button>
          {PROGRESS_POSES.map(pose => (
            <button
              key={pose.id}
              type="button"
              className={`hl-chip-btn${poseFilter === pose.id ? " is-active" : ""}`}
              onClick={() => setPoseFilter(pose.id)}
            >
              {pose.label} ({poseCounts[pose.id] || 0})
            </button>
          ))}
        </div>

        <div className="hl-photos-filters-right">
          {phases.length > 0 && (
            <select
              aria-label="Filter by phase"
              value={phaseFilter}
              onChange={e => setPhaseFilter(e.target.value)}
            >
              <option value="all">All phases</option>
              {phases.map(ph => <option key={ph} value={ph}>{ph}</option>)}
            </select>
          )}
          <button
            type="button"
            className={`hl-chip-btn${milestonesOnly ? " is-active" : ""}`}
            onClick={() => setMilestonesOnly(v => !v)}
          >
            <Star size={12} fill={milestonesOnly ? "currentColor" : "none"} /> Milestones
          </button>
          <div className="hl-unit-group" role="group" aria-label="Gallery layout">
            <button type="button" className={`hl-seg-btn${layout === "timeline" ? " is-active" : ""}`} onClick={() => setLayout("timeline")}>
              Timeline
            </button>
            <button type="button" className={`hl-seg-btn${layout === "grid" ? " is-active" : ""}`} onClick={() => setLayout("grid")}>
              Grid
            </button>
          </div>
        </div>
      </div>

      {/* Compare Tray when A or B selected */}
      {(compA || compB) && (
        <div className="hl-compare-tray">
          <div className="hl-compare-tray-slots">
            <div className="hl-tray-slot">
              <span className="hl-tray-badge is-a">Before (A)</span>
              {compA ? (
                <>
                  <StoredPhotoImg imageRef={compA.imageRef} alt="Compare A" className="hl-tray-thumb" />
                  <span>{SHORT_DATE(compA.date)} · {poseLabel(compA.pose)}</span>
                </>
              ) : (
                <em>Pick a photo</em>
              )}
            </div>
            <div className="hl-tray-slot">
              <span className="hl-tray-badge is-b">After (B)</span>
              {compB ? (
                <>
                  <StoredPhotoImg imageRef={compB.imageRef} alt="Compare B" className="hl-tray-thumb" />
                  <span>{SHORT_DATE(compB.date)} · {poseLabel(compB.pose)}</span>
                </>
              ) : (
                <em>Pick a second photo</em>
              )}
            </div>
          </div>
          <div className="hl-compare-tray-btns">
            <button type="button" className="ws-button ws-secondary" onClick={onClearCompare}>Clear</button>
            <button type="button" className="ws-button ws-primary" disabled={!compA || !compB} onClick={onOpenCompare}>
              <Columns2 size={14} /> Open comparison
            </button>
          </div>
        </div>
      )}

      {!filtered.length ? (
        <section className="hl-card hl-photos-empty">
          <p>No progress photos match these filters.</p>
          <button
            type="button"
            className="ws-button ws-secondary"
            onClick={() => { setPoseFilter("all"); setPhaseFilter("all"); setMilestonesOnly(false); }}
          >
            Reset filters
          </button>
        </section>
      ) : layout === "grid" ? (
        <div className="hl-photo-grid">{filtered.map(renderCard)}</div>
      ) : (
        <div className="hl-photo-timeline">
          {groupedByDate.map(group => {
            const wDay = days.find(d => d.date === group.date);
            const firstPhoto = group.items[0];
            const wCtx = photoWeightContext(firstPhoto, days);
            const dayWeight = wDay?.metrics.weightKg ?? wCtx.kg;
            const dayBf = wDay?.metrics.bodyFatPct ?? firstPhoto.bodyFatPct;
            return (
              <section key={group.date} className="hl-checkin-group">
                <header className="hl-checkin-group-head">
                  <div>
                    <strong>{LONG_DATE(group.date)}</strong>
                    <span className="hl-group-stats">
                      {dayWeight !== undefined && <span>{fmtWeight(dayWeight, unit)}</span>}
                      {dayBf !== undefined && <span>{dayBf.toFixed(1)}% BF</span>}
                      <span>{group.items.length} photo{group.items.length === 1 ? "" : "s"}</span>
                    </span>
                  </div>
                  <button type="button" className="hl-link" onClick={() => onOpenAddPhoto(group.date)}>
                    + Add angle to this date
                  </button>
                </header>
                <div className="hl-photo-grid">{group.items.map(renderCard)}</div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison Studio
// ---------------------------------------------------------------------------

interface AlignState {
  zoom: number;
  x: number;
  y: number;
}
const DEFAULT_ALIGN: AlignState = { zoom: 1, x: 0, y: 0 };

function CompareStudio({
  days,
  photos,
  unit,
  lengthUnit,
  compareAId,
  compareBId,
  onChangeA,
  onChangeB,
  onSwap,
  onOpenAddPhoto,
  onInspect,
  onAsk,
}: {
  days: HealthDay[];
  photos: ProgressPhoto[];
  unit: WeightUnit;
  lengthUnit: LengthUnit;
  compareAId: string | null;
  compareBId: string | null;
  onChangeA: (id: string) => void;
  onChangeB: (id: string) => void;
  onSwap: () => void;
  onOpenAddPhoto: () => void;
  onInspect: (id: string) => void;
  onAsk: (prompt: string, images?: PreparedImage[]) => void;
}) {
  const [poseFilter, setPoseFilter] = useState<ProgressPhotoPose | "all">("all");
  const [mode, setMode] = useState<CompareMode>("side");
  const [splitPct, setSplitPct] = useState(50);
  const [fadePct, setFadePct] = useState(50);
  const [showAlign, setShowAlign] = useState(false);
  const [alignA, setAlignA] = useState<AlignState>(DEFAULT_ALIGN);
  const [alignB, setAlignB] = useState<AlignState>(DEFAULT_ALIGN);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const sliderBoxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const orderedAsc = useMemo(
    () => [...photos].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "")),
    [photos]
  );

  const pool = useMemo(
    () => (poseFilter === "all" ? orderedAsc : orderedAsc.filter(p => p.pose === poseFilter)),
    [orderedAsc, poseFilter]
  );

  // Pick smart defaults when no explicit IDs are active.
  const defaultPair = useMemo(() => {
    const front = orderedAsc.filter(p => p.pose === "front");
    const list = front.length >= 2 ? front : orderedAsc;
    return {
      a: list[0]?.id || null,
      b: list.length >= 2 ? list[list.length - 1].id : list[0]?.id || null,
    };
  }, [orderedAsc]);

  const photoA =
    (compareAId ? photos.find(p => p.id === compareAId) : undefined) ||
    (defaultPair.a ? photos.find(p => p.id === defaultPair.a) : undefined);
  const photoB =
    (compareBId ? photos.find(p => p.id === compareBId) : undefined) ||
    (defaultPair.b ? photos.find(p => p.id === defaultPair.b) : undefined);

  const applyPreset = (kind: "first" | "30d" | "90d" | "milestone") => {
    const base = pool.length >= 2 ? pool : orderedAsc;
    if (base.length < 2) return;
    const latest = base[base.length - 1];
    if (kind === "first") {
      onChangeA(base[0].id);
      onChangeB(latest.id);
    } else if (kind === "milestone") {
      const ms = base.filter(p => p.milestone);
      if (ms.length >= 2) {
        onChangeA(ms[0].id);
        onChangeB(ms[ms.length - 1].id);
      } else if (ms.length === 1) {
        onChangeA(ms[0].id);
        onChangeB(latest.id);
      }
    } else {
      const targetDays = kind === "30d" ? 30 : 90;
      const targetDate = addDays(latest.date, -targetDays);
      let best = base[0], bestDist = Infinity;
      for (const p of base) {
        if (p.id === latest.id) continue;
        const d = Math.abs(daysBetween(p.date, targetDate));
        if (d < bestDist) { best = p; bestDist = d; }
      }
      onChangeA(best.id);
      onChangeB(latest.id);
    }
  };

  if (photos.length < 2) {
    return (
      <section className="hl-card hl-photos-empty">
        <Columns2 size={28} />
        <h3>Upload at least two photos to compare</h3>
        <p>Once you have two progress photos (e.g., Week 1 vs Week 4), compare them side-by-side, with an interactive split slider, or with fade overlay.</p>
        <button type="button" className="ws-button ws-primary" onClick={onOpenAddPhoto}>
          <Plus size={15} /> Add progress photo
        </button>
      </section>
    );
  }

  const cmp = photoA && photoB ? compareProgressPhotos(photoA, photoB, days) : undefined;
  const ctxA = photoA ? photoWeightContext(photoA, days) : undefined;
  const ctxB = photoB ? photoWeightContext(photoB, days) : undefined;

  const transformOf = (a: AlignState): CSSProperties => ({
    transform: `scale(${a.zoom}) translate(${a.x}%, ${a.y}%)`,
  });

  const updateSplitFromClientX = (clientX: number) => {
    const rect = sliderBoxRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const pct = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    setSplitPct(Math.round(pct * 10) / 10);
  };

  const askIrisCompare = async () => {
    if (!photoA || !photoB || asking) return;
    setAskError(null);
    setAsking(true);
    try {
      const [imgA, imgB] = await Promise.all([
        photoToPreparedImage(photoA, `before-${photoA.date}-${photoA.pose}.jpg`),
        photoToPreparedImage(photoB, `after-${photoB.date}-${photoB.pose}.jpg`),
      ]);
      const measText = cmp?.measurementDeltas.length
        ? ` Measurement shifts: ${cmp.measurementDeltas.map(m => `${m.label} ${fmtDeltaLength(m.deltaCm, lengthUnit)}`).join(", ")}.`
        : "";
      const prompt = `Compare my progress photos (image 1 is Before on ${photoA.date}, ${poseLabel(photoA.pose)}${ctxA?.kg !== undefined ? ` at ${fmtWeight(ctxA.kg, unit)}` : ""}; image 2 is After on ${photoB.date}, ${poseLabel(photoB.pose)}${ctxB?.kg !== undefined ? ` at ${fmtWeight(ctxB.kg, unit)}` : ""}). ${Math.abs(cmp?.daysElapsed || 0)} days apart${cmp?.weightDeltaKg !== undefined ? `, weight change ${fmtDeltaWeight(cmp.weightDeltaKg, unit)}` : ""}${cmp?.bodyFatDeltaPct !== undefined ? `, body fat change ${fmtSigned(cmp.bodyFatDeltaPct, 1, "%")}` : ""}.${measText} Give objective feedback on posture/physique progression, lighting/pose consistency, and practical next steps.`;
      onAsk(prompt, [imgA, imgB]);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Could not load images for comparison.");
    } finally {
      setAsking(false);
    }
  };

  const selectOptions = pool.length >= 2 ? pool : orderedAsc;
  const formatOption = (p: ProgressPhoto) => {
    const w = photoWeightContext(p, days).kg;
    return `${LONG_DATE(p.date)} · ${poseLabel(p.pose)}${w !== undefined ? ` · ${fmtWeight(w, unit)}` : ""}${p.milestone ? " ★" : ""}`;
  };

  return (
    <div className="hl-compare-view">
      {/* Top Controls */}
      <section className="hl-card hl-compare-controls">
        <div className="hl-compare-pickers">
          <div className="hl-compare-select">
            <label htmlFor="hl-cmp-a"><span className="hl-tray-badge is-a">Before</span></label>
            <select id="hl-cmp-a" value={photoA?.id || ""} onChange={e => onChangeA(e.target.value)}>
              {selectOptions.map(p => <option key={p.id} value={p.id}>{formatOption(p)}</option>)}
            </select>
          </div>
          <button type="button" className="hl-icon-btn hl-swap-btn" title="Swap Before and After" onClick={onSwap}>
            <ArrowLeftRight size={15} />
          </button>
          <div className="hl-compare-select">
            <label htmlFor="hl-cmp-b"><span className="hl-tray-badge is-b">After</span></label>
            <select id="hl-cmp-b" value={photoB?.id || ""} onChange={e => onChangeB(e.target.value)}>
              {selectOptions.map(p => <option key={p.id} value={p.id}>{formatOption(p)}</option>)}
            </select>
          </div>
        </div>

        <div className="hl-compare-bar2">
          <div className="hl-range-pills" role="group" aria-label="Comparison mode">
            <button type="button" className={`hl-chip-btn${mode === "side" ? " is-active" : ""}`} onClick={() => setMode("side")}>
              <Columns2 size={13} /> Side by side
            </button>
            <button type="button" className={`hl-chip-btn${mode === "slider" ? " is-active" : ""}`} onClick={() => setMode("slider")}>
              <SlidersHorizontal size={13} /> Split slider
            </button>
            <button type="button" className={`hl-chip-btn${mode === "overlay" ? " is-active" : ""}`} onClick={() => setMode("overlay")}>
              <Layers size={13} /> Fade overlay
            </button>
          </div>

          <div className="hl-compare-presets">
            <select aria-label="Filter pose in selectors" value={poseFilter} onChange={e => setPoseFilter(e.target.value as ProgressPhotoPose | "all")}>
              <option value="all">All poses</option>
              {PROGRESS_POSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button type="button" className="hl-chip-btn" onClick={() => applyPreset("first")}>First → Latest</button>
            <button type="button" className="hl-chip-btn" onClick={() => applyPreset("30d")}>~30d ago</button>
            <button type="button" className="hl-chip-btn" onClick={() => applyPreset("90d")}>~90d ago</button>
            {photos.some(p => p.milestone) && (
              <button type="button" className="hl-chip-btn" onClick={() => applyPreset("milestone")}>Milestones ★</button>
            )}
            <button type="button" className={`hl-chip-btn${showAlign ? " is-active" : ""}`} onClick={() => setShowAlign(v => !v)}>
              Align &amp; zoom
            </button>
            <button type="button" className="ws-button ws-primary" disabled={asking || !photoA || !photoB} onClick={askIrisCompare}>
              <Sparkles size={13} /> {asking ? "Preparing…" : "Ask Iris"}
            </button>
          </div>
        </div>

        {showAlign && (
          <div className="hl-align-panel">
            <div className="hl-align-col">
              <strong>Before alignment</strong>
              <label>Zoom ({alignA.zoom.toFixed(2)}x) <input type="range" min="1" max="2" step="0.05" value={alignA.zoom} onChange={e => setAlignA(s => ({ ...s, zoom: Number(e.target.value) }))} /></label>
              <label>Shift X ({alignA.x}%) <input type="range" min="-25" max="25" step="1" value={alignA.x} onChange={e => setAlignA(s => ({ ...s, x: Number(e.target.value) }))} /></label>
              <label>Shift Y ({alignA.y}%) <input type="range" min="-25" max="25" step="1" value={alignA.y} onChange={e => setAlignA(s => ({ ...s, y: Number(e.target.value) }))} /></label>
            </div>
            <div className="hl-align-col">
              <strong>After alignment</strong>
              <label>Zoom ({alignB.zoom.toFixed(2)}x) <input type="range" min="1" max="2" step="0.05" value={alignB.zoom} onChange={e => setAlignB(s => ({ ...s, zoom: Number(e.target.value) }))} /></label>
              <label>Shift X ({alignB.x}%) <input type="range" min="-25" max="25" step="1" value={alignB.x} onChange={e => setAlignB(s => ({ ...s, x: Number(e.target.value) }))} /></label>
              <label>Shift Y ({alignB.y}%) <input type="range" min="-25" max="25" step="1" value={alignB.y} onChange={e => setAlignB(s => ({ ...s, y: Number(e.target.value) }))} /></label>
            </div>
            <button type="button" className="ws-button ws-secondary" onClick={() => { setAlignA(DEFAULT_ALIGN); setAlignB(DEFAULT_ALIGN); }}>
              Reset
            </button>
          </div>
        )}
        {askError && <p className="hl-error-note">{askError}</p>}
      </section>

      {/* Comparison Viewport */}
      {photoA && photoB && (
        <section className="hl-compare-stage">
          {mode === "side" && (
            <div className="hl-cmp-side-grid">
              {[{ photo: photoA, ctx: ctxA, role: "Before", align: alignA }, { photo: photoB, ctx: ctxB, role: "After", align: alignB }].map(side => (
                <div key={side.role} className="hl-cmp-frame" onClick={() => onInspect(side.photo.id)}>
                  <div className="hl-cmp-img-clip">
                    <StoredPhotoImg imageRef={side.photo.imageRef} alt={`${side.role} ${side.photo.date}`} style={transformOf(side.align)} />
                  </div>
                  <div className="hl-cmp-caption">
                    <span className={`hl-tray-badge ${side.role === "Before" ? "is-a" : "is-b"}`}>{side.role}</span>
                    <strong>{LONG_DATE(side.photo.date)}</strong>
                    <span>{poseLabel(side.photo.pose)}</span>
                    {side.ctx?.kg !== undefined && <span>{fmtWeight(side.ctx.kg, unit)}</span>}
                    {side.ctx?.bodyFatPct !== undefined && <span>{side.ctx.bodyFatPct.toFixed(1)}% BF</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {mode === "slider" && (
            <div className="hl-cmp-slider-wrap">
              <div
                ref={sliderBoxRef}
                className="hl-cmp-slider-stage"
                onPointerDown={e => {
                  draggingRef.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  updateSplitFromClientX(e.clientX);
                }}
                onPointerMove={e => {
                  if (draggingRef.current) updateSplitFromClientX(e.clientX);
                }}
                onPointerUp={() => { draggingRef.current = false; }}
                onPointerCancel={() => { draggingRef.current = false; }}
              >
                <div className="hl-cmp-layer">
                  <StoredPhotoImg imageRef={photoB.imageRef} alt={`After ${photoB.date}`} style={transformOf(alignB)} />
                </div>
                <div className="hl-cmp-layer hl-cmp-layer-before" style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}>
                  <StoredPhotoImg imageRef={photoA.imageRef} alt={`Before ${photoA.date}`} style={transformOf(alignA)} />
                </div>
                <div className="hl-cmp-divider" style={{ left: `${splitPct}%` }}>
                  <div className="hl-cmp-handle" aria-hidden="true">⇄</div>
                </div>
                <div className="hl-cmp-corner-lbl is-left">
                  Before · {SHORT_DATE(photoA.date)}{ctxA?.kg !== undefined ? ` · ${fmtWeight(ctxA.kg, unit)}` : ""}
                </div>
                <div className="hl-cmp-corner-lbl is-right">
                  After · {SHORT_DATE(photoB.date)}{ctxB?.kg !== undefined ? ` · ${fmtWeight(ctxB.kg, unit)}` : ""}
                </div>
              </div>
              <label className="hl-cmp-range-control">
                <span>Split position ({Math.round(splitPct)}%)</span>
                <input type="range" min="2" max="98" value={splitPct} onChange={e => setSplitPct(Number(e.target.value))} />
              </label>
            </div>
          )}

          {mode === "overlay" && (
            <div className="hl-cmp-slider-wrap">
              <div className="hl-cmp-slider-stage">
                <div className="hl-cmp-layer">
                  <StoredPhotoImg imageRef={photoA.imageRef} alt={`Before ${photoA.date}`} style={transformOf(alignA)} />
                </div>
                <div className="hl-cmp-layer" style={{ opacity: fadePct / 100 }}>
                  <StoredPhotoImg imageRef={photoB.imageRef} alt={`After ${photoB.date}`} style={transformOf(alignB)} />
                </div>
                <div className="hl-cmp-corner-lbl is-left">Before · {SHORT_DATE(photoA.date)}</div>
                <div className="hl-cmp-corner-lbl is-right">After · {SHORT_DATE(photoB.date)} ({fadePct}%)</div>
              </div>
              <label className="hl-cmp-range-control">
                <span>After photo opacity ({fadePct}%)</span>
                <input type="range" min="0" max="100" value={fadePct} onChange={e => setFadePct(Number(e.target.value))} />
              </label>
            </div>
          )}
        </section>
      )}

      {/* Deltas Strip */}
      {cmp && photoA && photoB && (
        <section className="hl-card hl-cmp-deltas">
          <div className="hl-stats">
            <div className="ws-stat">
              <span>Time span</span>
              <strong>{Math.abs(cmp.daysElapsed)} day{Math.abs(cmp.daysElapsed) === 1 ? "" : "s"}</strong>
              <small>{(Math.abs(cmp.daysElapsed) / 7).toFixed(1)} weeks between photos</small>
            </div>
            <div className="ws-stat">
              <span>Weight change</span>
              <strong>{cmp.weightDeltaKg !== undefined ? fmtDeltaWeight(cmp.weightDeltaKg, unit) : "—"}</strong>
              <small>
                {ctxA?.kg !== undefined ? fmtWeight(ctxA.kg, unit) : "—"} → {ctxB?.kg !== undefined ? fmtWeight(ctxB.kg, unit) : "—"}
                {cmp.perWeekKg !== undefined ? ` (${fmtDeltaWeight(cmp.perWeekKg, unit)}/wk)` : ""}
              </small>
            </div>
            <div className="ws-stat">
              <span>Body fat change</span>
              <strong>{cmp.bodyFatDeltaPct !== undefined ? fmtSigned(cmp.bodyFatDeltaPct, 1, "%") : "—"}</strong>
              <small>
                {ctxA?.bodyFatPct !== undefined ? `${ctxA.bodyFatPct.toFixed(1)}%` : "—"} → {ctxB?.bodyFatPct !== undefined ? `${ctxB.bodyFatPct.toFixed(1)}%` : "—"}
              </small>
            </div>
            <div className="ws-stat">
              <span>Measurements</span>
              <strong>
                {cmp.measurementDeltas.length
                  ? `${cmp.measurementDeltas[0].label} ${fmtDeltaLength(cmp.measurementDeltas[0].deltaCm, lengthUnit)}`
                  : "—"}
              </strong>
              <small>
                {cmp.measurementDeltas.length > 1
                  ? cmp.measurementDeltas.slice(1).map(m => `${m.label} ${fmtDeltaLength(m.deltaCm, lengthUnit)}`).join(" · ")
                  : cmp.measurementDeltas.length === 1
                    ? `${fmtLength(cmp.measurementDeltas[0].beforeCm, lengthUnit)} → ${fmtLength(cmp.measurementDeltas[0].afterCm, lengthUnit)}`
                    : "Add waist/chest/arm measurements to track"}
              </small>
            </div>
          </div>
          {(photoA.note || photoB.note) && (
            <div className="hl-cmp-notes">
              <div><strong>Before note:</strong> {photoA.note || "—"}</div>
              <div><strong>After note:</strong> {photoB.note || "—"}</div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Progress Photo(s) Dialog
// ---------------------------------------------------------------------------

interface QueuedPhoto {
  id: string;
  file: File;
  previewUrl: string;
  pose: ProgressPhotoPose;
}

const DEFAULT_POSE_SEQUENCE: ProgressPhotoPose[] = ["front", "side", "back", "flexed", "other"];

function AddPhotoDialog({
  today,
  presetDate,
  days,
  unit,
  lengthUnit,
  defaultPhase,
  onSave,
  onClose,
}: {
  today: string;
  presetDate?: string;
  days: HealthDay[];
  unit: WeightUnit;
  lengthUnit: LengthUnit;
  defaultPhase?: string;
  onSave: (
    photos: ProgressPhoto[],
    alsoLogDay?: {
      date: string;
      weightKg?: number;
      bodyFatPct?: number;
      measurements?: BodyMeasurements;
    }
  ) => void;
  onClose: () => void;
}) {
  const initialDate = presetDate || today;
  const matchingDay = days.find(d => d.date === initialDate);

  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(() => localTimeNow());
  const [weight, setWeight] = useState(() =>
    matchingDay?.metrics.weightKg !== undefined
      ? String(Math.round(toUnit(matchingDay.metrics.weightKg, unit) * 10) / 10)
      : ""
  );
  const [bodyFat, setBodyFat] = useState(() =>
    matchingDay?.metrics.bodyFatPct !== undefined ? String(matchingDay.metrics.bodyFatPct) : ""
  );
  const [phase, setPhase] = useState(defaultPhase || "");
  const [tags, setTags] = useState<string[]>(["fasted"]);
  const [customTag, setCustomTag] = useState("");
  const [showMeas, setShowMeas] = useState(false);
  const [meas, setMeas] = useState<Partial<Record<keyof BodyMeasurements, string>>>(() => {
    const out: Partial<Record<keyof BodyMeasurements, string>> = {};
    for (const def of MEASUREMENT_DEFS) {
      const v = matchingDay?.metrics[def.key];
      if (v !== undefined) out[def.key] = String(Math.round(toLengthUnit(v, lengthUnit) * 10) / 10);
    }
    return out;
  });
  const [milestone, setMilestone] = useState(false);
  const [note, setNote] = useState("");
  const [syncToDay, setSyncToDay] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      queue.forEach(item => URL.revokeObjectURL(item.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appendFiles = (list: FileList | File[]) => {
    setError(null);
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setQueue(prev => {
      const next = [...prev];
      for (const file of incoming) {
        if (next.length >= 6) break;
        const pose = DEFAULT_POSE_SEQUENCE[next.length % DEFAULT_POSE_SEQUENCE.length];
        next.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          pose,
        });
      }
      return next;
    });
  };

  const removeQueued = (id: string) => {
    setQueue(prev => {
      const target = prev.find(q => q.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(q => q.id !== id);
    });
  };

  const toggleTag = (t: string) => {
    setTags(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));
  };

  const addCustomTag = () => {
    const cleaned = customTag.trim().toLowerCase().slice(0, 30);
    if (cleaned && !tags.includes(cleaned)) setTags(prev => [...prev, cleaned]);
    setCustomTag("");
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) appendFiles(e.dataTransfer.files);
  };

  const handleSave = async () => {
    if (!queue.length || saving) return;
    setError(null);
    setSaving(true);
    try {
      const wParsed = parseNum(weight);
      const weightKg = wParsed !== undefined && wParsed > 0 ? roundNum(fromUnit(wParsed, unit), 3) : undefined;
      const bfParsed = parseNum(bodyFat);
      const bodyFatPct = bfParsed !== undefined && bfParsed >= 2 && bfParsed <= 70 ? roundNum(bfParsed, 1) : undefined;
      const cleanMeas: BodyMeasurements = {};
      for (const def of MEASUREMENT_DEFS) {
        const mParsed = parseNum(meas[def.key] || "");
        if (mParsed !== undefined && mParsed > 0) cleanMeas[def.key] = roundNum(fromLengthUnit(mParsed, lengthUnit), 1);
      }
      const measurements = Object.keys(cleanMeas).length ? cleanMeas : undefined;
      const now = new Date().toISOString();

      const prepared = await Promise.all(
        queue.map(async item => {
          const { blob, width, height } = await prepareProgressPhotoImage(item.file, item.file.name);
          const imageRef = await storeNoteImage(blob);
          const record: ProgressPhoto = {
            id: `photo-${crypto.randomUUID()}`,
            date,
            ...(time ? { time } : {}),
            pose: item.pose,
            imageRef,
            width,
            height,
            ...(weightKg !== undefined ? { weightKg } : {}),
            ...(bodyFatPct !== undefined ? { bodyFatPct } : {}),
            ...(measurements ? { measurements } : {}),
            ...(phase.trim() ? { phase: phase.trim().slice(0, 40) } : {}),
            ...(tags.length ? { tags } : {}),
            ...(note.trim() ? { note: note.trim().slice(0, 2000) } : {}),
            ...(milestone ? { milestone: true } : {}),
            createdAt: now,
            updatedAt: now,
          };
          return record;
        })
      );

      onSave(
        prepared,
        syncToDay && (weightKg !== undefined || bodyFatPct !== undefined || measurements)
          ? { date, weightKg, bodyFatPct, measurements }
          : undefined
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save progress photo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogBackdrop label="Add progress photos" onClose={onClose} className="ws-overlay">
      <div className="ws-dialog hl-dialog hl-dialog-wide">
        <div className="ws-dialog-heading">
          <div>
            <h2>Log progress photos</h2>
            <p>Upload up to 6 angles for a check-in with weight, body fat, measurements, and notes.</p>
          </div>
          <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="ws-form-body hl-add-photo-body">
          {/* Dropzone / Queue */}
          <div
            className={`hl-photo-dropzone${dragging ? " is-drag" : ""}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={e => e.target.files && appendFiles(e.target.files)}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={e => e.target.files && appendFiles(e.target.files)}
            />
            <div className="hl-drop-prompt">
              <Upload size={22} />
              <div>
                <strong>Drop up to 6 photos for one check-in</strong>
                <span>JPEG, PNG, WebP, or HEIC · Front, Side, Back, or Flexed</span>
              </div>
              <div className="hl-drop-btns">
                <button type="button" className="ws-button ws-primary" onClick={() => fileRef.current?.click()}>Choose files</button>
                <button type="button" className="ws-button ws-secondary" onClick={() => cameraRef.current?.click()}>
                  <Camera size={14} /> Camera
                </button>
              </div>
            </div>

            {queue.length > 0 && (
              <div className="hl-queue-grid">
                {queue.map(item => (
                  <div key={item.id} className="hl-queue-item">
                    <img src={item.previewUrl} alt="Queued progress upload" />
                    <button
                      type="button"
                      className="hl-queue-rm"
                      aria-label="Remove photo"
                      onClick={() => removeQueued(item.id)}
                    >
                      <X size={13} />
                    </button>
                    <select
                      aria-label="Pose"
                      value={item.pose}
                      onChange={e => setQueue(prev => prev.map(q => q.id === item.id ? { ...q, pose: e.target.value as ProgressPhotoPose } : q))}
                    >
                      {PROGRESS_POSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Check-in Details */}
          <div className="hl-form-grid-2">
            <label>
              Check-in date
              <input type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />
            </label>
            <label>
              Time
              <input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </label>
            <label>
              Weight ({unit})
              <input type="number" step="0.1" min="20" max="900" placeholder="Optional" value={weight} onChange={e => setWeight(e.target.value)} />
            </label>
            <label>
              Body fat (%)
              <input type="number" step="0.1" min="2" max="70" placeholder="Optional" value={bodyFat} onChange={e => setBodyFat(e.target.value)} />
            </label>
          </div>

          <div className="hl-form-block">
            <span className="hl-field-lbl">Phase</span>
            <div className="hl-chip-row">
              {PHOTO_PHASES.map(p => (
                <button
                  key={p}
                  type="button"
                  className={`hl-chip-btn${phase === p ? " is-active" : ""}`}
                  onClick={() => setPhase(phase === p ? "" : p)}
                >
                  {p}
                </button>
              ))}
              <input
                type="text"
                className="hl-chip-input"
                placeholder="Custom phase…"
                value={PHOTO_PHASES.includes(phase as (typeof PHOTO_PHASES)[number]) ? "" : phase}
                onChange={e => setPhase(e.target.value)}
              />
            </div>
          </div>

          <div className="hl-form-block">
            <span className="hl-field-lbl">Context tags</span>
            <div className="hl-chip-row">
              {QUICK_PHOTO_TAGS.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`hl-chip-btn${tags.includes(t) ? " is-active" : ""}`}
                  onClick={() => toggleTag(t)}
                >
                  #{t}
                </button>
              ))}
              {tags.filter(t => !(QUICK_PHOTO_TAGS as readonly string[]).includes(t)).map(t => (
                <button key={t} type="button" className="hl-chip-btn is-active" onClick={() => toggleTag(t)}>
                  #{t} ×
                </button>
              ))}
              <input
                type="text"
                className="hl-chip-input"
                placeholder="+ tag + Enter"
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCustomTag())}
              />
            </div>
          </div>

          <div className="hl-form-block">
            <button type="button" className="hl-link" onClick={() => setShowMeas(v => !v)}>
              <Ruler size={13} /> {showMeas ? "Hide body measurements" : "Add circumference measurements (waist, chest, arms…)"}
            </button>
            {showMeas && (
              <div className="hl-meas-grid">
                {MEASUREMENT_DEFS.map(def => (
                  <label key={def.key}>
                    {def.label} ({lengthUnit})
                    <input
                      type="number"
                      step="0.1"
                      placeholder="—"
                      value={meas[def.key] || ""}
                      onChange={e => setMeas(prev => ({ ...prev, [def.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="hl-form-block">
            <span className="hl-field-lbl">Check-in notes</span>
            <textarea
              rows={2}
              placeholder="Lighting, hydration, soreness, pump, what changed since last check-in…"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </label>

          <div className="hl-check-row">
            <label className="hl-checkbox">
              <input type="checkbox" checked={milestone} onChange={e => setMilestone(e.target.checked)} />
              <span><Star size={13} /> Mark as milestone photo</span>
            </label>
            <label className="hl-checkbox">
              <input type="checkbox" checked={syncToDay} onChange={e => setSyncToDay(e.target.checked)} />
              <span>Also log weight / BF% / measurements to {SHORT_DATE(date)} health day</span>
            </label>
          </div>

          {error && <p className="hl-error-note">{error}</p>}
        </div>

        <div className="ws-dialog-actions">
          <button type="button" className="ws-button ws-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="ws-button ws-primary" disabled={!queue.length || saving} onClick={handleSave}>
            {saving ? "Compressing & saving…" : `Save ${queue.length || ""} photo${queue.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </DialogBackdrop>
  );
}

// ---------------------------------------------------------------------------
// Photo Inspector & Editor Lightbox
// ---------------------------------------------------------------------------

function PhotoInspectorDialog({
  photo,
  orderedPhotos,
  days,
  profile,
  unit,
  lengthUnit,
  compareAId,
  compareBId,
  onNavigate,
  onSetCompare,
  onCompareWithLatest,
  onSave,
  onDelete,
  onAsk,
  onClose,
}: {
  photo: ProgressPhoto;
  orderedPhotos: ProgressPhoto[];
  days: HealthDay[];
  profile: HealthProfile | undefined;
  unit: WeightUnit;
  lengthUnit: LengthUnit;
  compareAId: string | null;
  compareBId: string | null;
  onNavigate: (id: string) => void;
  onSetCompare: (slot: "A" | "B", id: string) => void;
  onCompareWithLatest: () => void;
  onSave: (updated: ProgressPhoto) => void;
  onDelete: (id: string) => void;
  onAsk: (prompt: string, images?: PreparedImage[]) => void;
  onClose: () => void;
}) {
  const idx = orderedPhotos.findIndex(p => p.id === photo.id);
  const prevPhoto = idx > 0 ? orderedPhotos[idx - 1] : undefined;
  const nextPhoto = idx >= 0 && idx < orderedPhotos.length - 1 ? orderedPhotos[idx + 1] : undefined;
  const wCtx = photoWeightContext(photo, days);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [asking, setAsking] = useState(false);

  // Edit state
  const [date, setDate] = useState(photo.date);
  const [time, setTime] = useState(photo.time || "");
  const [pose, setPose] = useState<ProgressPhotoPose>(photo.pose);
  const [weight, setWeight] = useState(() =>
    photo.weightKg !== undefined ? String(Math.round(toUnit(photo.weightKg, unit) * 10) / 10) : ""
  );
  const [bodyFat, setBodyFat] = useState(() => (photo.bodyFatPct !== undefined ? String(photo.bodyFatPct) : ""));
  const [phase, setPhase] = useState(photo.phase || "");
  const [tagsText, setTagsText] = useState((photo.tags || []).join(", "));
  const [note, setNote] = useState(photo.note || "");
  const [milestone, setMilestone] = useState(!!photo.milestone);
  const [meas, setMeas] = useState<Partial<Record<keyof BodyMeasurements, string>>>(() => {
    const out: Partial<Record<keyof BodyMeasurements, string>> = {};
    for (const def of MEASUREMENT_DEFS) {
      const v = photo.measurements?.[def.key];
      if (v !== undefined) out[def.key] = String(Math.round(toLengthUnit(v, lengthUnit) * 10) / 10);
    }
    return out;
  });

  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setDate(photo.date);
    setTime(photo.time || "");
    setPose(photo.pose);
    setWeight(photo.weightKg !== undefined ? String(Math.round(toUnit(photo.weightKg, unit) * 10) / 10) : "");
    setBodyFat(photo.bodyFatPct !== undefined ? String(photo.bodyFatPct) : "");
    setPhase(photo.phase || "");
    setTagsText((photo.tags || []).join(", "));
    setNote(photo.note || "");
    setMilestone(!!photo.milestone);
    const out: Partial<Record<keyof BodyMeasurements, string>> = {};
    for (const def of MEASUREMENT_DEFS) {
      const v = photo.measurements?.[def.key];
      if (v !== undefined) out[def.key] = String(Math.round(toLengthUnit(v, lengthUnit) * 10) / 10);
    }
    setMeas(out);
  }, [photo, unit, lengthUnit]);

  const handleSaveEdit = () => {
    const wParsed = parseNum(weight);
    const weightKg = wParsed !== undefined && wParsed > 0 ? roundNum(fromUnit(wParsed, unit), 3) : undefined;
    const bfParsed = parseNum(bodyFat);
    const bodyFatPct = bfParsed !== undefined && bfParsed >= 2 && bfParsed <= 70 ? roundNum(bfParsed, 1) : undefined;
    const cleanMeas: BodyMeasurements = {};
    for (const def of MEASUREMENT_DEFS) {
      const mParsed = parseNum(meas[def.key] || "");
      if (mParsed !== undefined && mParsed > 0) cleanMeas[def.key] = roundNum(fromLengthUnit(mParsed, lengthUnit), 1);
    }
    const tags = tagsText
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    const updated: ProgressPhoto = {
      id: photo.id,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : photo.date,
      ...(time.trim() && /^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim()) ? { time: time.trim() } : {}),
      pose,
      imageRef: photo.imageRef,
      ...(photo.width ? { width: photo.width } : {}),
      ...(photo.height ? { height: photo.height } : {}),
      ...(weightKg !== undefined ? { weightKg } : {}),
      ...(bodyFatPct !== undefined ? { bodyFatPct } : {}),
      ...(Object.keys(cleanMeas).length ? { measurements: cleanMeas } : {}),
      ...(phase.trim() ? { phase: phase.trim().slice(0, 40) } : {}),
      ...(tags.length ? { tags } : {}),
      ...(note.trim() ? { note: note.trim().slice(0, 2000) } : {}),
      ...(milestone ? { milestone: true } : {}),
      createdAt: photo.createdAt,
      updatedAt: new Date().toISOString(),
    };
    onSave(updated);
    setEditing(false);
  };

  const askIris = async () => {
    if (asking) return;
    setAsking(true);
    try {
      const img = await photoToPreparedImage(photo, `progress-${photo.date}-${photo.pose}.jpg`);
      const prompt = `Review this ${poseLabel(photo.pose)} progress photo from ${photo.date}${wCtx.kg !== undefined ? ` at ${fmtWeight(wCtx.kg, unit)}` : ""}${wCtx.bodyFatPct !== undefined ? ` (${wCtx.bodyFatPct.toFixed(1)}% body fat)` : ""}${photo.phase ? ` during ${photo.phase}` : ""}. Give grounded observations on posture/lighting/physique and relate it to my health & training data.`;
      onAsk(prompt, [img]);
      onClose();
    } finally {
      setAsking(false);
    }
  };

  return (
    <DialogBackdrop
      label={`Progress photo from ${photo.date}`}
      onClose={onClose}
      className="ws-overlay"
      onKeyDown={e => {
        if (editing) return;
        if (e.key === "ArrowLeft" && prevPhoto) onNavigate(prevPhoto.id);
        if (e.key === "ArrowRight" && nextPhoto) onNavigate(nextPhoto.id);
      }}
    >
      <div className="ws-dialog hl-inspector-dialog">
        {/* Left: Full Photo Stage */}
        <div className="hl-inspector-stage">
          <StoredPhotoImg imageRef={photo.imageRef} alt={`${poseLabel(photo.pose)} progress photo ${photo.date}`} />
          {prevPhoto && (
            <button type="button" className="hl-nav-arrow is-prev" aria-label="Previous photo" onClick={() => onNavigate(prevPhoto.id)}>
              <ChevronLeft size={20} />
            </button>
          )}
          {nextPhoto && (
            <button type="button" className="hl-nav-arrow is-next" aria-label="Next photo" onClick={() => onNavigate(nextPhoto.id)}>
              <ChevronRight size={20} />
            </button>
          )}
        </div>

        {/* Right: Metadata & Editor */}
        <div className="hl-inspector-side">
          <header>
            <div>
              <h3>{LONG_DATE(photo.date)}{photo.time ? ` · ${photo.time}` : ""}</h3>
              <span className="hl-inspector-sub">
                {poseLabel(photo.pose)}
                {photo.phase ? ` · ${photo.phase}` : ""}
                {photo.milestone ? " · ★ Milestone" : ""}
              </span>
            </div>
            <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </header>

          {!editing ? (
            <div className="hl-inspector-details">
              <div className="hl-inspector-stats">
                <div className="ws-stat">
                  <span>Weight</span>
                  <strong>{wCtx.kg !== undefined ? fmtWeight(wCtx.kg, unit) : "—"}</strong>
                  <small>
                    {profile?.goalWeightKg !== undefined && wCtx.kg !== undefined
                      ? `${fmtWeight(Math.abs(profile.goalWeightKg - wCtx.kg), unit)} to goal`
                      : wCtx.kg !== undefined && !wCtx.exact
                        ? "Nearest log within 3d"
                        : "Check-in scale"}
                  </small>
                </div>
                <div className="ws-stat">
                  <span>Body fat</span>
                  <strong>{wCtx.bodyFatPct !== undefined ? `${wCtx.bodyFatPct.toFixed(1)}%` : "—"}</strong>
                  <small>
                    {wCtx.kg !== undefined && wCtx.bodyFatPct !== undefined
                      ? `Lean ${fmtWeight(wCtx.kg * (1 - wCtx.bodyFatPct / 100), unit)}`
                      : "Optional BF%"}
                  </small>
                </div>
              </div>

              {photo.measurements && (
                <div className="hl-inspector-section">
                  <h4>Measurements</h4>
                  <div className="hl-meas-pills">
                    {MEASUREMENT_DEFS.map(def => {
                      const v = photo.measurements?.[def.key];
                      if (v === undefined) return null;
                      return (
                        <span key={def.key} className="hl-meas-pill">
                          {def.label}: <strong>{fmtLength(v, lengthUnit)}</strong>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {photo.tags && photo.tags.length > 0 && (
                <div className="hl-inspector-section">
                  <h4>Tags</h4>
                  <div className="hl-photo-tags">
                    {photo.tags.map(t => <span key={t}>#{t}</span>)}
                  </div>
                </div>
              )}

              <div className="hl-inspector-section">
                <h4>Notes</h4>
                <p className="hl-inspector-note">{photo.note || "No notes recorded for this check-in."}</p>
              </div>

              <div className="hl-inspector-actions">
                <div className="hl-cmp-btn-row">
                  <button
                    type="button"
                    className={`ws-button ws-secondary${compareAId === photo.id ? " is-active" : ""}`}
                    onClick={() => onSetCompare("A", photo.id)}
                  >
                    Set Before (A)
                  </button>
                  <button
                    type="button"
                    className={`ws-button ws-secondary${compareBId === photo.id ? " is-active" : ""}`}
                    onClick={() => onSetCompare("B", photo.id)}
                  >
                    Set After (B)
                  </button>
                  {orderedPhotos.length >= 2 && (
                    <button type="button" className="ws-button ws-secondary" onClick={onCompareWithLatest}>
                      <Columns2 size={14} /> Compare
                    </button>
                  )}
                </div>

                <button type="button" className="ws-button ws-primary" disabled={asking} onClick={askIris}>
                  <Sparkles size={14} /> {asking ? "Preparing…" : "Ask Iris about this photo"}
                </button>

                <div className="hl-inspector-bottom-row">
                  <button type="button" className="ws-button ws-secondary" onClick={() => setEditing(true)}>
                    <Edit3 size={14} /> Edit details
                  </button>
                  {!confirmDelete ? (
                    <button type="button" className="ws-button ws-secondary hl-danger-btn" onClick={() => setConfirmDelete(true)}>
                      <Trash2 size={14} /> Delete
                    </button>
                  ) : (
                    <span className="hl-confirm-del">
                      <button type="button" className="ws-button hl-danger-fill" onClick={() => onDelete(photo.id)}>Confirm delete</button>
                      <button type="button" className="ws-button ws-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="hl-inspector-edit">
              <div className="hl-form-grid-2">
                <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
                <label>Time <input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
                <label>
                  Pose
                  <select value={pose} onChange={e => setPose(e.target.value as ProgressPhotoPose)}>
                    {PROGRESS_POSES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                <label>Phase <input type="text" placeholder="Cut / Bulk / Recomp" value={phase} onChange={e => setPhase(e.target.value)} /></label>
                <label>Weight ({unit}) <input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} /></label>
                <label>Body fat (%) <input type="number" step="0.1" value={bodyFat} onChange={e => setBodyFat(e.target.value)} /></label>
              </div>

              <div className="hl-meas-grid">
                {MEASUREMENT_DEFS.map(def => (
                  <label key={def.key}>
                    {def.label} ({lengthUnit})
                    <input
                      type="number"
                      step="0.1"
                      value={meas[def.key] || ""}
                      onChange={e => setMeas(prev => ({ ...prev, [def.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>

              <label>Tags (comma-separated) <input type="text" value={tagsText} onChange={e => setTagsText(e.target.value)} /></label>
              <label>Notes <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
              <label className="hl-checkbox">
                <input type="checkbox" checked={milestone} onChange={e => setMilestone(e.target.checked)} />
                <span><Star size={13} /> Starred milestone</span>
              </label>

              <div className="hl-targets-save">
                <button type="button" className="ws-button ws-secondary" onClick={() => setEditing(false)}>Cancel</button>
                <button type="button" className="ws-button ws-primary" onClick={handleSaveEdit}>Save changes</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogBackdrop>
  );
}
