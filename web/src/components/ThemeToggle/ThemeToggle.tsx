import { useTheme } from '../../theme'
import { MoonIcon, SunIcon } from '../icons'
import { cx } from '../utils'
import styles from './ThemeToggle.module.css'

/**
 * Switches between the light and dark themes. Until it is first clicked the app follows the
 * OS; after that the stored choice wins. Pressed while dark is on. Not on the canvas: its look
 * matches the Bell beside it.
 */
export function ThemeToggle({
  showLabel = false,
  className,
}: {
  /** Shows "Dark mode" beside the icon, as in the phone menu. */
  showLabel?: boolean
  className?: string
}) {
  const { theme, setTheme } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      aria-pressed={dark}
      aria-label={showLabel ? undefined : 'Dark mode'}
      title={showLabel ? undefined : 'Dark mode'}
      className={cx(styles.toggle, showLabel && styles.labelled, className)}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
      {showLabel && 'Dark mode'}
    </button>
  )
}
