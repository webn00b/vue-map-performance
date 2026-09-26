import { Status } from './simulation/fleet'

/**
 * The one place colors are defined. CSS reads them as custom properties
 * (`accent` → `--accent`), while canvas and MapLibre, which can't read CSS
 * variables, use the values directly.
 */
export const COLORS = {
  text: '#1f2328',
  muted: '#656d76',
  border: '#d0d7de',
  divider: '#eaeef2',
  hover: '#f6f8fa',
  surface: '#ffffff',
  panelBg: 'rgb(255 255 255 / 0.94)',
  shadow: 'rgb(0 0 0 / 0.08)',
  accent: '#0969da',
  good: '#1a7f37',
  warn: '#9a6700',
  warnBg: '#fff8c5',
  bad: '#cf222e',
  idle: '#8c959f',
} as const

export const STATUS_COLORS: Record<Status, string> = {
  [Status.Idle]: COLORS.idle,
  [Status.Delivering]: COLORS.accent,
  [Status.Returning]: COLORS.good,
}

export function applyColorVariables(root: HTMLElement): void {
  for (const [name, value] of Object.entries(COLORS)) {
    root.style.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value)
  }
}
