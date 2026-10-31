import React from "react";

interface MountainHeroIllustrationProps {
  theme?: "light" | "dark";
  className?: string;
}

export const MountainHeroIllustration: React.FC<MountainHeroIllustrationProps> = ({
  theme = "dark",
  className = "",
}) => {
  const isDark = theme === "dark";

  return (
    <div
      className={`relative w-full h-full overflow-hidden pointer-events-none select-none ${className}`}
    >
      <svg
        viewBox="0 0 540 220"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMaxYMid meet"
        className="w-full h-full object-cover"
      >
        <defs>
          {/* Radial Aurora Glow behind Summit */}
          <radialGradient
            id="summitGlow"
            cx="72%"
            cy="26%"
            r="48%"
            fx="72%"
            fy="26%"
          >
            <stop
              offset="0%"
              stopColor={isDark ? "#a855f7" : "#818cf8"}
              stopOpacity={isDark ? 0.75 : 0.55}
            />
            <stop
              offset="40%"
              stopColor={isDark ? "#4f46e5" : "#c084fc"}
              stopOpacity={isDark ? 0.35 : 0.25}
            />
            <stop
              offset="80%"
              stopColor={isDark ? "#1e1b4b" : "#e0e7ff"}
              stopOpacity={isDark ? 0.15 : 0.1}
            />
            <stop
              offset="100%"
              stopColor={isDark ? "#090b14" : "#ffffff"}
              stopOpacity="0"
            />
          </radialGradient>

          {/* Glowing Winding Path Gradient */}
          <linearGradient id="pathGradient" x1="0%" y1="100%" x2="72%" y2="25%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
            <stop offset="40%" stopColor="#a855f7" stopOpacity="0.95" />
            <stop offset="85%" stopColor="#c084fc" stopOpacity="1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>

          {/* Mountain Facet Gradients */}
          <linearGradient id="peakLit" x1="50%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#2e2a58" : "#93c5fd"} />
            <stop offset="100%" stopColor={isDark ? "#12142a" : "#cbd5e1"} />
          </linearGradient>

          <linearGradient id="peakShadow" x1="50%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#1a1835" : "#64748b"} />
            <stop offset="100%" stopColor={isDark ? "#0c0d1c" : "#334155"} />
          </linearGradient>

          <linearGradient id="midSlope" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#1d2042" : "#a5b4fc"} />
            <stop offset="100%" stopColor={isDark ? "#0e1022" : "#475569"} />
          </linearGradient>

          <linearGradient id="foreRidge" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#121528" : "#cbd5e1"} />
            <stop offset="100%" stopColor={isDark ? "#090b14" : "#f1f5f9"} />
          </linearGradient>

          {/* Smooth left-edge fade mask */}
          <linearGradient id="edgeFade" x1="0%" y1="0%" x2="45%" y2="0%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>

          <mask id="heroMask">
            <rect width="540" height="220" fill="url(#edgeFade)" />
          </mask>

          {/* Glow filter for the Summit Star & Path */}
          <filter id="starBloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="pathBloom" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g mask="url(#heroMask)">
          {/* 1. Aurora Atmosphere Glow behind Peak */}
          <rect width="540" height="220" fill="url(#summitGlow)" />

          {/* 2. Distant Soft Mountain Ridges */}
          <path
            d="M 120 220 L 210 145 L 260 165 L 320 120 L 390 150 L 450 110 L 520 160 L 540 220 Z"
            fill={isDark ? "#141630" : "#dbeafe"}
            opacity={isDark ? 0.6 : 0.7}
          />

          {/* 3. The Main Central Summit Mountain */}
          {/* Lit Face (Left side of peak at 390, 52) */}
          <path
            d="M 390 52 L 310 185 L 350 220 L 390 160 Z"
            fill="url(#peakLit)"
          />
          {/* Shadowed Face (Right side of peak) */}
          <path
            d="M 390 52 L 480 170 L 540 220 L 390 160 Z"
            fill="url(#peakShadow)"
          />

          {/* 4. Left Supporting Ridge Peak */}
          <path
            d="M 280 110 L 220 220 L 340 220 L 310 180 Z"
            fill="url(#midSlope)"
            opacity={0.9}
          />

          {/* 5. Right Supporting Ridge */}
          <path
            d="M 450 95 L 390 160 L 440 220 L 540 200 Z"
            fill="url(#midSlope)"
            opacity={0.85}
          />

          {/* 6. Foreground Valleys & Slope Ridges */}
          <path
            d="M 160 220 L 240 180 L 330 200 L 420 175 L 500 205 L 540 220 Z"
            fill="url(#foreRidge)"
          />

          {/* 7. The Radiant Winding Summit Path / Trail (Iconic S-Curve) */}
          {/* Base outer glow ribbon */}
          <path
            d="M 230 220 C 275 198, 290 190, 310 176 C 330 160, 345 142, 360 118 C 372 98, 384 75, 390 52"
            fill="none"
            stroke="url(#pathGradient)"
            strokeWidth="10"
            strokeLinecap="round"
            opacity={isDark ? 0.35 : 0.25}
            filter="url(#pathBloom)"
          />
          {/* Core bright path */}
          <path
            d="M 230 220 C 275 198, 290 190, 310 176 C 330 160, 345 142, 360 118 C 372 98, 384 75, 390 52"
            fill="none"
            stroke="url(#pathGradient)"
            strokeWidth="3.5"
            strokeLinecap="round"
            filter="url(#pathBloom)"
          />
          {/* Inner intense neon highlight core */}
          <path
            d="M 230 220 C 275 198, 290 190, 310 176 C 330 160, 345 142, 360 118 C 372 98, 384 75, 390 52"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.9"
          />

          {/* 8. Radiant Summit Star Beacon at Peak (390, 52) */}
          {/* Outer glowing halo circle */}
          <circle
            cx="390"
            cy="52"
            r="16"
            fill={isDark ? "#c084fc" : "#818cf8"}
            opacity={isDark ? 0.5 : 0.4}
            filter="url(#starBloom)"
          />
          <circle
            cx="390"
            cy="52"
            r="8"
            fill="#ffffff"
            opacity="0.8"
            filter="url(#starBloom)"
          />

          {/* 4-Point Diamond Star */}
          <polygon
            points="390,38 393,49 404,52 393,55 390,66 387,55 376,52 387,49"
            fill="#ffffff"
            filter="url(#starBloom)"
          />

          {/* Secondary celestial star specks */}
          <circle
            cx="340"
            cy="42"
            r="1.2"
            fill="#ffffff"
            opacity={isDark ? 0.8 : 0.5}
          />
          <circle
            cx="435"
            cy="36"
            r="1.5"
            fill="#ffffff"
            opacity={isDark ? 0.9 : 0.6}
          />
          <circle
            cx="470"
            cy="65"
            r="1"
            fill="#c084fc"
            opacity={isDark ? 0.7 : 0.4}
          />
          <circle
            cx="310"
            cy="70"
            r="1.2"
            fill="#818cf8"
            opacity={isDark ? 0.75 : 0.4}
          />
        </g>
      </svg>
    </div>
  );
};
