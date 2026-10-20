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

export function CloseIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...stroke(size, '0 0 16 16', 1.8, rest)}>
      <path d="M4 4l8 8M12 4l-8 8" />
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

/** The product mark. Its two greens are fixed, so it only goes on light grounds. */
export function SheepMark({ size = 26, ...rest }: IconProps) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 32 32" focusable={false} {...rest}>
      <g fill="#3b6e4f">
        <circle cx="10" cy="14" r="5" />
        <circle cx="16" cy="11.5" r="5.5" />
        <circle cx="22" cy="14" r="5" />
        <circle cx="13" cy="18.5" r="5" />
        <circle cx="20" cy="18.5" r="5" />
      </g>
      <g fill="#2d5a3f">
        <ellipse cx="27" cy="15.5" rx="3.2" ry="3.8" />
        <rect x="11.5" y="22" width="2.2" height="6.5" rx="1.1" />
        <rect x="19" y="22" width="2.2" height="6.5" rx="1.1" />
      </g>
      <circle cx="28" cy="14.6" r=".9" fill="#fff" />
    </svg>
  )
}
