import burgundyAutumnFloral from "./media/burgundy-autumn-floral.png"

export const ASSET_CATEGORIES = [
  "花艺",
  "家具",
  "标识",
  "绿植",
  "地面",
  "灯具",
  "布艺",
  "其他",
] as const

export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export type DemoAsset = {
  readonly id: string
  readonly name: string
  readonly category: AssetCategory
  readonly src: string
  readonly width: number
  readonly height: number
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

const floralArch = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 300">
  <path d="M62 274V143C62 70 102 28 160 28s98 42 98 115v131" fill="none" stroke="#D9C8A5" stroke-width="12" stroke-linecap="round"/>
  <path d="M45 278h44M231 278h44" fill="none" stroke="#A98F66" stroke-width="10" stroke-linecap="round"/>
  <g fill="#6D9961">
    <ellipse cx="69" cy="151" rx="22" ry="9" transform="rotate(-58 69 151)"/>
    <ellipse cx="82" cy="104" rx="22" ry="9" transform="rotate(-28 82 104)"/>
    <ellipse cx="112" cy="62" rx="23" ry="9" transform="rotate(-22 112 62)"/>
    <ellipse cx="153" cy="38" rx="24" ry="9" transform="rotate(8 153 38)"/>
    <ellipse cx="203" cy="58" rx="23" ry="9" transform="rotate(32 203 58)"/>
    <ellipse cx="241" cy="99" rx="22" ry="9" transform="rotate(52 241 99)"/>
    <ellipse cx="253" cy="149" rx="22" ry="9" transform="rotate(70 253 149)"/>
  </g>
  <g fill="#F7F0E5" stroke="#E8D4C5" stroke-width="2">
    <circle cx="65" cy="132" r="17"/><circle cx="91" cy="91" r="19"/>
    <circle cx="127" cy="55" r="18"/><circle cx="171" cy="37" r="20"/>
    <circle cx="213" cy="66" r="18"/><circle cx="246" cy="112" r="19"/>
    <circle cx="253" cy="164" r="17"/>
  </g>
  <g fill="#DFA6A9">
    <circle cx="64" cy="132" r="7"/><circle cx="91" cy="91" r="8"/>
    <circle cx="127" cy="55" r="7"/><circle cx="171" cy="37" r="8"/>
    <circle cx="213" cy="66" r="7"/><circle cx="246" cy="112" r="8"/>
    <circle cx="253" cy="164" r="7"/>
  </g>
</svg>`)

const flowerColumn = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 300">
  <path d="M56 274h48l-8-115H64z" fill="#E8E1D6" stroke="#BDAE98" stroke-width="4"/>
  <path d="M46 278h68" stroke="#A98F66" stroke-width="9" stroke-linecap="round"/>
  <g fill="#658D59">
    <ellipse cx="44" cy="111" rx="31" ry="12" transform="rotate(-38 44 111)"/>
    <ellipse cx="111" cy="101" rx="31" ry="12" transform="rotate(38 111 101)"/>
    <ellipse cx="78" cy="67" rx="13" ry="35"/>
  </g>
  <g fill="#F8F2E9" stroke="#E3C9C4" stroke-width="2">
    <circle cx="42" cy="101" r="25"/><circle cx="78" cy="76" r="28"/>
    <circle cx="115" cy="101" r="25"/><circle cx="61" cy="127" r="23"/>
    <circle cx="97" cy="128" r="23"/>
  </g>
  <g fill="#D89A9E">
    <circle cx="42" cy="101" r="9"/><circle cx="78" cy="76" r="10"/>
    <circle cx="115" cy="101" r="9"/><circle cx="61" cy="127" r="8"/>
    <circle cx="97" cy="128" r="8"/>
  </g>
</svg>`)

const welcomeSign = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 280">
  <path d="M95 137 50 268M95 137l45 131M63 227h64" fill="none" stroke="#7D6248" stroke-width="8" stroke-linecap="round"/>
  <rect x="28" y="22" width="134" height="166" rx="8" fill="#F4EFE5" stroke="#B89B72" stroke-width="7"/>
  <path d="M44 42h102v126H44z" fill="#FFFDF8" stroke="#D8C9AF" stroke-width="2"/>
  <path d="M53 61c18-13 31-11 45-3M136 145c-17 13-33 12-48 4" fill="none" stroke="#78916D" stroke-width="5" stroke-linecap="round"/>
  <text x="95" y="102" text-anchor="middle" font-family="serif" font-size="25" fill="#6B5747">欢迎</text>
  <text x="95" y="129" text-anchor="middle" font-family="sans-serif" font-size="10" letter-spacing="2" fill="#9A846F">WELCOME</text>
</svg>`)

const accentChair = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 240">
  <path d="M49 89c0-37 16-62 41-62s41 25 41 62v47H49z" fill="#D7B6A1" stroke="#8F6A58" stroke-width="6"/>
  <path d="M61 91c0-27 11-45 29-45s29 18 29 45v27H61z" fill="#EFE1D7"/>
  <path d="M40 128c0-9 7-16 16-16h68c9 0 16 7 16 16v27H40z" fill="#C9977C" stroke="#8F6A58" stroke-width="6"/>
  <path d="m52 154-10 69M128 154l10 69M47 190h86" fill="none" stroke="#765444" stroke-width="8" stroke-linecap="round"/>
  <path d="M40 135H24v52M140 135h16v52" fill="none" stroke="#8F6A58" stroke-width="7" stroke-linecap="round"/>
</svg>`)

const pottedPlant = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 280">
  <path d="M95 190V78M95 151 48 103M96 135l45-57M95 164l57-25" fill="none" stroke="#496D47" stroke-width="7" stroke-linecap="round"/>
  <g fill="#6E9B68" stroke="#4D784D" stroke-width="3">
    <ellipse cx="49" cy="97" rx="21" ry="38" transform="rotate(-42 49 97)"/>
    <ellipse cx="75" cy="62" rx="20" ry="39" transform="rotate(-18 75 62)"/>
    <ellipse cx="111" cy="58" rx="20" ry="40" transform="rotate(18 111 58)"/>
    <ellipse cx="142" cy="82" rx="21" ry="38" transform="rotate(42 142 82)"/>
    <ellipse cx="150" cy="137" rx="21" ry="38" transform="rotate(68 150 137)"/>
    <ellipse cx="50" cy="147" rx="21" ry="38" transform="rotate(-68 50 147)"/>
  </g>
  <path d="M54 186h82l-12 76H66z" fill="#B97855" stroke="#85533E" stroke-width="5"/>
  <path d="M48 181h94v22H48z" fill="#D18A62" stroke="#85533E" stroke-width="5"/>
</svg>`)

const aisleRunner = svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 180">
  <path d="M130 18h140l122 148H8z" fill="#EEE5DC" stroke="#C7B6A8" stroke-width="5"/>
  <path d="M146 28h108l93 124H53z" fill="#D7A6A7" opacity=".72"/>
  <path d="m134 26-99 132M266 26l99 132" stroke="#F9F5F0" stroke-width="5"/>
  <path d="M107 58h186M78 95h244M45 135h310" stroke="#F7ECE9" stroke-width="3" opacity=".8"/>
</svg>`)

export const DEMO_ASSETS = [
  {
    id: "floral-arch",
    name: "奶油花艺拱门",
    category: "花艺",
    src: floralArch,
    width: 320,
    height: 300,
  },
  {
    id: "flower-column",
    name: "柔粉花柱",
    category: "花艺",
    src: flowerColumn,
    width: 160,
    height: 300,
  },
  {
    id: "welcome-sign",
    name: "木质迎宾牌",
    category: "标识",
    src: welcomeSign,
    width: 190,
    height: 280,
  },
  {
    id: "accent-chair",
    name: "豆沙单椅",
    category: "家具",
    src: accentChair,
    width: 180,
    height: 240,
  },
  {
    id: "potted-plant",
    name: "阔叶绿植",
    category: "绿植",
    src: pottedPlant,
    width: 190,
    height: 280,
  },
  {
    id: "burgundy-autumn-floral",
    name: "酒红秋色花艺",
    category: "花艺",
    src: burgundyAutumnFloral,
    width: 1448,
    height: 1086,
  },
  {
    id: "aisle-runner",
    name: "粉色仪式地毯",
    category: "地面",
    src: aisleRunner,
    width: 400,
    height: 180,
  },
] as const satisfies readonly DemoAsset[]
