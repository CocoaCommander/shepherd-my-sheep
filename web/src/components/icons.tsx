import type { SVGProps } from 'react'

/** Stroke icons from the design system: currentColor, round caps, always beside text or labelled. */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & { size?: number }

function stroke(size: number, viewBox: string, strokeWidth: number, rest: IconProps) {
  return {
    'aria-hidden': true,
    width: size,
    height: size,
    viewBox,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    focusable: false,
    ...rest,
  }
}

export function PlusIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 2, rest)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function ClockIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 1.6, rest)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.2 1.5" />
    </svg>
  )
}

export function WarningIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 1.8, rest)}>
      <path d="M8 2.5L14.5 13.5h-13L8 2.5zM8 7v3M8 12v.01" />
    </svg>
  )
}

export function CheckIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 1.8, rest)}>
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  )
}

/** A dash, for "not tracked". */
export function MinusIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 2, rest)}>
      <path d="M4 8h8" />
    </svg>
  )
}

/** The grip dots on a draggable card. Filled, unlike the stroke icons. */
export function GripIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg
      aria-hidden
      width={(size * 10) / 16}
      height={size}
      viewBox="0 0 10 16"
      fill="currentColor"
      focusable={false}
      {...rest}
    >
      {[3, 8, 13].map((cy) => (
        <g key={cy}>
          <circle cx="2.5" cy={cy} r="1.4" />
          <circle cx="7.5" cy={cy} r="1.4" />
        </g>
      ))}
    </svg>
  )
}

export function CloseIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 1.8, rest)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

export function ChevronLeftIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 2, rest)}>
      <path d="M10 3L5 8l5 5" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 2, rest)}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  )
}

/** Three columns, for the board view. */
export function BoardIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 1.6, rest)}>
      <rect x="1.8" y="2" width="3.4" height="12" rx="1" />
      <rect x="6.3" y="2" width="3.4" height="8" rx="1" />
      <rect x="10.8" y="2" width="3.4" height="10" rx="1" />
    </svg>
  )
}

export function HeartIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 1.6, rest)}>
      <path d="M8 13.5S2.5 10 2.5 6.2A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.2C13.5 10 8 13.5 8 13.5z" />
    </svg>
  )
}

export function SearchIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 1.6, rest)}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  )
}

export function GridIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 18 18', 1.6, rest)}>
      <rect x="2" y="2" width="6" height="6" rx="1.5" />
      <rect x="10" y="2" width="6" height="6" rx="1.5" />
      <rect x="2" y="10" width="6" height="6" rx="1.5" />
      <rect x="10" y="10" width="6" height="6" rx="1.5" />
    </svg>
  )
}

export function ListIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 18 18', 1.6, rest)}>
      <path d="M3 4.5h12M3 9h12M3 13.5h12" />
    </svg>
  )
}

export function BellIcon({ size = 20, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 20 20', 1.6, rest)}>
      <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8z" />
      <path d="M8.5 16a1.7 1.7 0 0 0 3 0" />
    </svg>
  )
}

/** The theme toggle while the light theme is on. */
export function MoonIcon({ size = 20, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 20 20', 1.6, rest)}>
      <path d="M16 12.2A6.5 6.5 0 0 1 7.8 4 6.5 6.5 0 1 0 16 12.2z" />
    </svg>
  )
}

/** The theme toggle while the dark theme is on. */
export function SunIcon({ size = 20, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 20 20', 1.6, rest)}>
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M4.3 15.7l1.3-1.3M14.4 5.6l1.3-1.3" />
    </svg>
  )
}

/**
 * The product mark: Option A on the Sheep Icon Options canvas (public/favicon.svg mirrors it).
 * Its greens, eye and the gap line around the head come from tokens, so it works on any ground.
 */
export function SheepMark({ size = 26, ...rest }: IconProps) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 64 64" focusable={false} {...rest}>
      <g transform="translate(-3.6 -2.5)">
        <g style={{ fill: 'var(--sms-logo-shade)' }}>
          <rect x="25.5" y="44" width="4.4" height="12" rx="2.2" />
          <rect x="37.5" y="44" width="4.4" height="12" rx="2.2" />
        </g>
        <g style={{ fill: 'var(--sms-logo-body)' }}>
          <circle cx="22" cy="28" r="10" />
          <circle cx="32" cy="24" r="11" />
          <circle cx="43" cy="28" r="10" />
          <circle cx="26" cy="38" r="10" />
          <circle cx="39" cy="38" r="10" />
        </g>
        <ellipse
          cx="52"
          cy="36"
          rx="7.2"
          ry="8.4"
          style={{ fill: 'var(--sms-logo-shade)', stroke: 'var(--sms-logo-gap)', strokeWidth: 1.6 }}
        />
        <ellipse
          cx="44.4"
          cy="38.3"
          rx="7.4"
          ry="3.3"
          transform="rotate(-65 44.4 38.3)"
          style={{ fill: 'var(--sms-logo-shade)', stroke: 'var(--sms-logo-gap)', strokeWidth: 1.4 }}
        />
        <circle cx="54.5" cy="33.5" r="1.7" style={{ fill: 'var(--sms-surface)' }} />
      </g>
    </svg>
  )
}
