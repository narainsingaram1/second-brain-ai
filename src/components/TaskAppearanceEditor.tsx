import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  GraduationCap,
  BookOpen,
  Library,
  NotebookPen,
  Pencil,
  School,
  Languages,
  Calculator,
  Microscope,
  FlaskConical,
  Atom,
  Brain,
  Globe,
  Landmark,
  Cpu,
  Laptop,
  Code,
  Terminal,
  Database,
  Monitor,
  Smartphone,
  Wifi,
  GitBranch,
  Bug,
  Braces,
  Bot,
  BriefcaseBusiness,
  Building2,
  Presentation,
  ChartNoAxesCombined,
  Calendar,
  ClipboardList,
  Target,
  Flag,
  Users,
  Mail,
  Phone,
  MessageCircle,
  Handshake,
  Award,
  House,
  Heart,
  HeartPulse,
  Dumbbell,
  Bike,
  Footprints,
  Activity,
  Apple,
  Coffee,
  CookingPot,
  Bed,
  Moon,
  Sun,
  Leaf,
  Flower2,
  Sprout,
  Rocket,
  Lightbulb,
  Wrench,
  Hammer,
  Settings,
  Layers,
  Folder,
  FolderOpen,
  FileText,
  Archive,
  Package,
  Puzzle,
  ListTodo,
  CheckSquare,
  Clock,
  Timer,
  Bell,
  Palette,
  Paintbrush,
  Camera,
  Image,
  Film,
  Music,
  Headphones,
  Guitar,
  Mic,
  PenTool,
  Scissors,
  Sparkles,
  Star,
  Gem,
  Wallet,
  CreditCard,
  Banknote,
  PiggyBank,
  ShoppingBag,
  ShoppingCart,
  Gift,
  Store,
  Receipt,
  Plane,
  Car,
  TrainFront,
  Bus,
  Map,
  MapPin,
  Compass,
  Mountain,
  Tent,
  Trees,
  Umbrella,
  Ship,
  Gamepad2,
  Trophy,
  Medal,
  Swords,
  Crown,
  Flame,
  Zap,
  Shield,
  Key,
  Lock,
  Bookmark,
  Search,
  X,
  Check,
  RotateCcw,
} from "lucide-react";
import { TaskHeaderVisual } from "./TaskHeaderVisual";
import type { TaskAppearance, TaskSubsectionStyle } from "../types";
import {
  TASK_ACCENTS,
  TASK_VISUALS,
  taskAccentStyle,
} from "../utils/taskAppearance";

const groups = {
  Study: {
    GraduationCap,
    BookOpen,
    Library,
    NotebookPen,
    Pencil,
    School,
    Languages,
    Calculator,
    Microscope,
    FlaskConical,
    Atom,
    Brain,
    Globe,
    Landmark,
  },
  Technology: {
    Cpu,
    Laptop,
    Code,
    Terminal,
    Database,
    Monitor,
    Smartphone,
    Wifi,
    GitBranch,
    Bug,
    Braces,
    Bot,
  },
  Work: {
    BriefcaseBusiness,
    Building2,
    Presentation,
    ChartNoAxesCombined,
    Calendar,
    ClipboardList,
    Target,
    Flag,
    Users,
    Mail,
    Phone,
    MessageCircle,
    Handshake,
    Award,
  },
  Life: {
    House,
    Heart,
    HeartPulse,
    Dumbbell,
    Bike,
    Footprints,
    Activity,
    Apple,
    Coffee,
    CookingPot,
    Bed,
    Moon,
    Sun,
    Leaf,
    Flower2,
    Sprout,
  },
  Essentials: {
    Rocket,
    Lightbulb,
    Wrench,
    Hammer,
    Settings,
    Layers,
    Folder,
    FolderOpen,
    FileText,
    Archive,
    Package,
    Puzzle,
    ListTodo,
    CheckSquare,
    Clock,
    Timer,
    Bell,
    Star,
    Flame,
    Zap,
    Shield,
    Key,
    Lock,
    Bookmark,
  },
  Creative: {
    Palette,
    Paintbrush,
    Camera,
    Image,
    Film,
    Music,
    Headphones,
    Guitar,
    Mic,
    PenTool,
    Scissors,
    Sparkles,
    Gem,
    Gamepad2,
    Trophy,
    Medal,
    Swords,
    Crown,
  },
  Money: {
    Wallet,
    CreditCard,
    Banknote,
    PiggyBank,
    ShoppingBag,
    ShoppingCart,
    Gift,
    Store,
    Receipt,
  },
  Travel: {
    Plane,
    Car,
    TrainFront,
    Bus,
    Map,
    MapPin,
    Compass,
    Mountain,
    Tent,
    Trees,
    Umbrella,
    Ship,
  },
};
export const taskIcons = Object.assign({}, ...Object.values(groups)) as Record<
  string,
  typeof Folder
>;
const readable = (name: string) => name.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
export function TaskIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = Object.prototype.hasOwnProperty.call(taskIcons, name)
    ? taskIcons[name]
    : Folder;
  return <Icon className={className} aria-hidden="true" strokeWidth={1.8} />;
}

export function TaskAppearanceEditor({
  appearance,
  iconTarget,
  selectedIcon,
  selectedStyle,
  initialTab = "icons",
  onStyleChange,
  onIcon,
  onChange,
  onClose,
}: {
  appearance: TaskAppearance;
  iconTarget?: string;
  selectedIcon?: string;
  selectedStyle?: TaskSubsectionStyle;
  initialTab?: "style" | "icons";
  onStyleChange?: (style: TaskSubsectionStyle) => void;
  onIcon: (icon?: string) => void;
  onChange: (appearance: TaskAppearance) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (
      dialog.current?.querySelector<HTMLElement>("input") ||
      dialog.current?.querySelector<HTMLElement>("button")
    )?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key === "Tab") {
        const items = [
          ...(dialog.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input",
          ) || []),
        ];
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [onClose]);
  const pool =
    category === "All" ? taskIcons : groups[category as keyof typeof groups];
  const matches = Object.keys(pool).filter((name) =>
    readable(name).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selectedAccent = selectedStyle?.accent || appearance.accent;
  const showingIcons = Boolean(
    iconTarget && (!selectedStyle || tab === "icons"),
  );
  return createPortal(
    <div
      style={taskAccentStyle(selectedAccent)}
      className="task-editor-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className={`task-editor ${selectedStyle ? "task-style-editor" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
      >
        <header>
          <div>
            <h2 id="task-editor-title">
              {selectedStyle
                ? "Customize subsection"
                : iconTarget
                  ? "Choose an icon"
                  : "Default appearance"}
            </h2>
            <p>
              {iconTarget || "A little color. A workspace that feels like you."}
            </p>
          </div>
          <button
            type="button"
            className="task-icon-action"
            onClick={onClose}
            aria-label="Close appearance editor"
          >
            <X size={19} />
          </button>
        </header>
        {selectedStyle && (
          <div className="task-editor-tabs" aria-label="Customize subsection">
            <button
              type="button"
              aria-pressed={tab === "style"}
              onClick={() => setTab("style")}
            >
              <Palette size={15} /> Color & artwork
            </button>
            <button
              type="button"
              aria-pressed={tab === "icons"}
              onClick={() => setTab("icons")}
            >
              <Layers size={15} /> Icon
            </button>
          </div>
        )}
        <div
          className={`task-editor-body ${showingIcons ? "task-editor-body-icons" : ""}`}
        >
          {showingIcons ? (
            <>
              <label className="task-icon-search">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${Object.keys(taskIcons).length} icons…`}
                  aria-label="Search icons"
                />
              </label>
              <div
                className="task-icon-categories"
                aria-label="Icon categories"
              >
                {["All", ...Object.keys(groups)].map((group) => (
                  <button
                    key={group}
                    type="button"
                    aria-pressed={category === group}
                    onClick={() => setCategory(group)}
                  >
                    {group}
                  </button>
                ))}
              </div>
              <div className="task-icon-grid">
                {matches.map((name) => (
                  <button
                    type="button"
                    key={name}
                    title={readable(name)}
                    aria-label={readable(name)}
                    aria-pressed={selectedIcon === name}
                    onClick={() => {
                      onIcon(name);
                      onClose();
                    }}
                  >
                    <TaskIcon name={name} />
                    <span>{readable(name)}</span>
                  </button>
                ))}
                {matches.length === 0 && (
                  <p className="task-no-icons">
                    No icons found. Try “book”, “heart”, or “code”.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div
                className="task-accent-options"
                aria-label="Task accent color"
              >
                {TASK_ACCENTS.map((accent) => (
                  <button
                    type="button"
                    key={accent.id}
                    aria-pressed={selectedAccent === accent.id}
                    onClick={() =>
                      selectedStyle && onStyleChange
                        ? onStyleChange({ ...selectedStyle, accent: accent.id })
                        : onChange({ ...appearance, accent: accent.id })
                    }
                  >
                    <span style={{ background: accent.light }}>
                      {selectedAccent === accent.id && (
                        <Check size={17} color="white" />
                      )}
                    </span>
                    {accent.label}
                  </button>
                ))}
              </div>
              {selectedStyle && (
                <>
                  <div className="task-style-label">
                    <h3>Header artwork</h3>
                    <span>Choose a visual for this subsection</span>
                  </div>
                  <div className="task-visual-options">
                    {TASK_VISUALS.map((visual) => (
                      <button
                        type="button"
                        key={visual.id}
                        aria-label={`${visual.label} artwork`}
                        aria-pressed={selectedStyle.visual === visual.id}
                        onClick={() =>
                          onStyleChange?.({
                            ...selectedStyle,
                            visual: visual.id,
                          })
                        }
                      >
                        <span className="task-visual-sample">
                          {visual.id === "none" ? (
                            <span className="task-minimal-lines">
                              <i />
                              <i />
                              <i />
                            </span>
                          ) : (
                            <TaskHeaderVisual visual={visual.id} />
                          )}
                        </span>
                        <span>{visual.label}</span>
                        {selectedStyle.visual === visual.id && (
                          <Check className="task-visual-check" size={13} />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="task-style-label">
                    <h3>Live preview</h3>
                  </div>
                  <div
                    className="task-subsection task-style-preview"
                    style={taskAccentStyle(selectedAccent)}
                  >
                    <div className="task-subsection-header">
                      <TaskHeaderVisual visual={selectedStyle.visual} />
                      <div className="task-subsection-heading">
                        <div className="task-icon-tile">
                          <TaskIcon name={selectedIcon || "Folder"} />
                        </div>
                        <h3>{iconTarget}</h3>
                        <span className="task-count">2 tasks</span>
                      </div>
                    </div>
                    <div className="task-preview-row">
                      <span className="task-completion" />
                      <span>Your next task</span>
                      <span className="task-count">Not started</span>
                    </div>
                  </div>
                </>
              )}
              {!selectedStyle && (
                <div className="task-appearance-preview">
                  <div className="task-icon-tile">
                    <GraduationCap />
                  </div>
                  <div>
                    <strong>Your next chapter</strong>
                    <p>Soft accents. Clear focus.</p>
                  </div>
                  <span className="task-count">3 tasks</span>
                </div>
              )}
              <p className="task-editor-hint">
                {selectedStyle
                  ? "Only this subsection changes. Your other subsections keep their own colors and artwork."
                  : "The default for task views and new subsections. Use the palette button on any subsection to choose its own color and artwork."}
              </p>
            </>
          )}
        </div>
        {showingIcons ? (
          <footer>
            <span>
              {matches.length} {matches.length === 1 ? "icon" : "icons"}
            </span>
            <button
              type="button"
              onClick={() => {
                onIcon();
                onClose();
              }}
            >
              <RotateCcw size={14} /> Use default icon
            </button>
          </footer>
        ) : (
          <footer>
            <span>Saved automatically</span>
            <button type="button" onClick={onClose}>
              Done <Check size={14} />
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
