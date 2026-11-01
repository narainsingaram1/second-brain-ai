// Decorative, recolorable vector artwork. Kept out of the accessibility tree.
export function TaskHeaderVisual({
  visual,
  className = "",
}: {
  visual: string;
  className?: string;
}) {
  if (visual === "none") return null;
  return (
    <svg
      className={`task-header-visual ${className}`}
      viewBox="0 0 320 120"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="task-art-sweep"
        d="M35 120C105 112 74 27 181 0H320C265 80 199 126 35 120Z"
        fill="currentColor"
        opacity=".22"
      />
      {visual === "circuit" && (
        <g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect
            x="147"
            y="39"
            width="48"
            height="48"
            rx="9"
            fill="currentColor"
            fillOpacity=".13"
          />
          <rect x="158" y="50" width="26" height="26" rx="4" />
          <path d="M155 39V19L140 4M170 39V0M184 39V17L202 1M195 48H217L231 30H253M195 62H240L254 76H284M195 77H218L238 99H266M184 87V107L197 120M170 87V120M155 87V106L139 119M147 78H121L103 100H74M147 63H110L91 49H63M147 49H126L112 25H88" />
          {[
            [140, 4],
            [202, 1],
            [253, 30],
            [284, 76],
            [266, 99],
            [74, 100],
            [63, 49],
            [88, 25],
          ].map(([cx, cy]) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r="4"
              fill="var(--task-art-base, #fff)"
            />
          ))}
        </g>
      )}
      {visual === "book" && (
        <g
          transform="translate(105 13) rotate(10 65 55)"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        >
          <path
            d="M9 22Q40 5 69 20Q99 2 136 17L128 98Q97 85 67 104Q37 86 0 100Z"
            fill="currentColor"
            fillOpacity=".2"
            strokeOpacity=".2"
            transform="translate(7 7)"
          />
          <path
            d="M7 14Q38 0 68 16Q100 0 135 12L128 91Q99 79 67 97Q37 80 0 94Z"
            fill="var(--task-art-base, #fff)"
            fillOpacity=".8"
          />
          <path d="M68 16L67 97M15 29Q39 20 56 32M13 42Q36 33 55 45M11 55Q34 46 53 58M9 68Q33 59 52 71M81 31Q102 20 122 26M80 44Q100 33 121 39M79 57Q99 46 119 52M78 70Q97 59 117 65" />
        </g>
      )}
      {visual === "network" && (
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M81 69L134 25L182 72L224 33L271 77L226 112L182 72L132 111L81 69M134 25L132 111M134 25L224 33M132 111L226 112M81 69L182 72M224 33L226 112" />
          {[
            [81, 69],
            [134, 25],
            [182, 72],
            [224, 33],
            [271, 77],
            [226, 112],
            [132, 111],
          ].map(([cx, cy]) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r="8"
              fill="var(--task-art-base, #fff)"
              strokeWidth="3"
            />
          ))}
        </g>
      )}
      {visual === "botanical" && (
        <g
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M164 123Q145 66 204 1M157 87Q123 94 105 61Q145 48 157 87ZM163 66Q159 31 130 21Q119 53 163 66ZM174 48Q217 59 235 26Q200 11 174 48ZM156 106Q196 116 220 82Q184 70 156 106Z"
            fill="currentColor"
            fillOpacity=".14"
          />
          <path d="M117 67L152 85M139 31L160 61M188 43L222 30M168 100L207 87" />
        </g>
      )}
      {visual === "orbit" && (
        <g stroke="currentColor" strokeWidth="2.3">
          <circle
            cx="171"
            cy="62"
            r="29"
            fill="currentColor"
            fillOpacity=".13"
          />
          <ellipse
            cx="171"
            cy="62"
            rx="91"
            ry="22"
            transform="rotate(-25 171 62)"
          />
          <ellipse
            cx="171"
            cy="62"
            rx="72"
            ry="43"
            transform="rotate(28 171 62)"
            strokeOpacity=".45"
          />
          <circle cx="252" cy="24" r="7" fill="var(--task-art-base, #fff)" />
          <path
            d="M106 15V29M99 22H113M235 98V112M228 105H242"
            strokeLinecap="round"
          />
        </g>
      )}
      {visual === "mountains" && (
        <g stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
          <circle
            cx="228"
            cy="25"
            r="15"
            fill="currentColor"
            fillOpacity=".14"
          />
          <path
            d="M53 120L134 21L211 120M159 120L217 53L282 120"
            fill="currentColor"
            fillOpacity=".1"
          />
          <path d="M109 51L130 61L145 51L160 57M199 74L215 86L231 76" />
          <path d="M35 117H298" />
        </g>
      )}
      {visual === "waves" && (
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          {[24, 44, 64, 84, 104].map((y, i) => (
            <path
              key={y}
              d={`M54 ${y}C100 ${y - 40} 133 ${y + 40} 177 ${y}S251 ${y - 40} 297 ${y}`}
              opacity={1 - i * 0.12}
            />
          ))}
        </g>
      )}
    </svg>
  );
}

export function TaskEmptyVisual() {
  return (
    <svg
      className="task-empty-art"
      viewBox="0 0 110 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="53" cy="53" r="39" fill="currentColor" opacity=".09" />
      <g transform="rotate(-10 53 53)">
        <rect
          x="30"
          y="23"
          width="51"
          height="67"
          rx="9"
          fill="currentColor"
          opacity=".18"
        />
        <rect
          x="25"
          y="18"
          width="51"
          height="67"
          rx="8"
          fill="var(--task-art-base, #fff)"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="39"
          y="14"
          width="24"
          height="13"
          rx="4"
          fill="var(--task-art-base, #fff)"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path
          d="M35 43L39 47L46 38M52 43H66M35 62L39 66L46 57M52 62H66"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <path
        d="M89 26L91 31L96 33L91 35L89 40L87 35L82 33L87 31ZM15 64L17 68L21 70L17 72L15 76L13 72L9 70L13 68Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M85 9L87 6M91 13L94 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
