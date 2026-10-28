/** Decorative silk surfaces; gradients stay local and adapt to the active theme. */
export function RibbonBackdrop() {
  return <div className="ribbon-backdrop" aria-hidden="true">
    <svg className="ribbon-art" viewBox="0 0 1440 1100" fill="none" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="silk-body" x1="150" y1="170" x2="850" y2="800" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a8ceff" stopOpacity=".08"/><stop offset=".25" stopColor="#8daaff" stopOpacity=".45"/><stop offset=".48" stopColor="#bb9df5" stopOpacity=".22"/><stop offset=".72" stopColor="#fff" stopOpacity=".03"/><stop offset="1" stopColor="#b2c5ff" stopOpacity=".02"/>
        </linearGradient>
        <linearGradient id="silk-edge" x1="270" y1="0" x2="570" y2="990" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0"/><stop offset=".23" stopColor="#d9e7ff" stopOpacity=".9"/><stop offset=".48" stopColor="#fff" stopOpacity=".8"/><stop offset="1" stopColor="#c3c9ff" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="silk-fold" x1="310" y1="130" x2="600" y2="450" gradientUnits="userSpaceOnUse">
          <stop stopColor="#789eff" stopOpacity=".5"/><stop offset=".35" stopColor="#a5acff" stopOpacity=".18"/><stop offset=".7" stopColor="#d4b8ff" stopOpacity=".25"/><stop offset="1" stopColor="#fff" stopOpacity="0"/>
        </linearGradient>
        <filter id="silk-blur"><feGaussianBlur stdDeviation="15"/></filter>
      </defs>
      <path d="M670 -160C615 30 269 91 230 308C183 575 515 714 647 1118L355 1190C355 848 73 613 132 333C173 138 477 25 491-160Z" fill="url(#silk-body)"/>
      <path d="M670 -160C615 30 269 91 230 308C183 575 515 714 647 1118" stroke="url(#silk-edge)" strokeWidth="2"/>
      <path d="M491-160C477 25 173 138 132 333C73 613 355 848 355 1190" stroke="url(#silk-edge)" strokeWidth="1.5"/>
      <path d="M251 301C303 62 576 47 715 266C546 103 367 143 371 329C375 526 535 591 644 731C404 615 207 505 251 301Z" fill="url(#silk-fold)"/>
      <path d="M251 301C303 62 576 47 715 266C546 103 367 143 371 329C375 526 535 591 644 731" stroke="url(#silk-edge)" strokeWidth="2"/>
      <path d="M281 327C248 476 380 584 464 680" stroke="#b7a7ff" strokeOpacity=".25" strokeWidth="44" filter="url(#silk-blur)"/>
      <path d="M1300-170C1010 170 1395 338 1127 729C1014 894 1196 1023 1470 1155" stroke="url(#silk-body)" strokeWidth="110"/>
      <path d="M1267-170C977 170 1362 338 1094 729C981 894 1163 1023 1437 1155" stroke="url(#silk-edge)" strokeOpacity=".35" strokeWidth="1.5"/>
    </svg>
  </div>;
}
