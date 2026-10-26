import React from "react";
import { LifeDomain } from "../types";
import { Sparkles, Briefcase, Heart, Brain, GraduationCap, Layers } from "lucide-react";

interface DomainBarProps {
  selectedDomain: LifeDomain | "all";
  onSelectDomain: (domain: LifeDomain | "all") => void;
  domainCounts: Record<LifeDomain, number>;
}

export const DomainBar: React.FC<DomainBarProps> = ({
  selectedDomain,
  onSelectDomain,
  domainCounts,
}) => {
  const domains: { id: LifeDomain; label: string; avatar: string; color: string; badgeColor: string; icon: any }[] = [
    {
      id: "career",
      label: "Career & Projects",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
      color: "from-blue-500 to-indigo-600",
      badgeColor: "bg-blue-500",
      icon: Briefcase,
    },
    {
      id: "health",
      label: "Health & Vitality",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
      color: "from-emerald-500 to-teal-600",
      badgeColor: "bg-emerald-500",
      icon: Heart,
    },
    {
      id: "mindset",
      label: "Mindset & Habits",
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80",
      color: "from-rose-500 to-pink-600",
      badgeColor: "bg-rose-500",
      icon: Brain,
    },
    {
      id: "learning",
      label: "Deep Learning",
      avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80",
      color: "from-amber-500 to-orange-600",
      badgeColor: "bg-amber-500",
      icon: GraduationCap,
    },
    {
      id: "ai",
      label: "AI Neural Agent",
      avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80",
      color: "from-purple-500 to-violet-600",
      badgeColor: "bg-purple-600",
      icon: Sparkles,
    },
  ];

  return (
    <div className="flex items-center gap-3">
      {/* "All" Life Domains Pill */}
      <button
        onClick={() => onSelectDomain("all")}
        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shadow-sm ${
          selectedDomain === "all"
            ? "bg-slate-900 dark:bg-white text-white dark:text-slate-950 scale-105"
            : "bg-white/80 dark:bg-[#141721]/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 border border-slate-200 dark:border-slate-800"
        }`}
      >
        <Layers className="w-3.5 h-3.5" />
        <span>All Domains</span>
      </button>

      {/* Life Domains Avatars with Number Badges (matching screenshot) */}
      <div className="flex items-center -space-x-1 hover:space-x-1.5 transition-all duration-300">
        {domains.map((dom) => {
          const isSelected = selectedDomain === dom.id;
          const count = domainCounts[dom.id] || 0;
          return (
            <button
              key={dom.id}
              onClick={() => onSelectDomain(isSelected ? "all" : dom.id)}
              title={`${dom.label} (${count} active)`}
              className={`relative group transition-transform ${isSelected ? "scale-110 z-10" : "hover:scale-105"}`}
            >
              <div
                className={`w-9 h-9 rounded-full overflow-hidden p-0.5 border-2 transition-all ${
                  isSelected
                    ? "border-slate-900 dark:border-white shadow-md ring-2 ring-blue-400"
                    : "border-white dark:border-slate-800 shadow-sm"
                }`}
              >
                <img src={dom.avatar} alt={dom.label} className="w-full h-full object-cover rounded-full" />
              </div>
              {/* Numbered badge pill at the bottom */}
              <span
                className={`absolute -bottom-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow-sm ${dom.badgeColor}`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
