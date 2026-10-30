import { useEffect, useRef, type ReactNode } from 'react'
import styles from './RunMonthDialog.module.css'

type Props = {
  headingId: string
  onCancel: () => void
  /** Focus returns to the first button whenever this changes (a new step). */
  focusKey?: string
  children: ReactNode
}

// A modal overlay, not <dialog>: role, aria-modal and the label are explicit,
// focus lands on the first button, Escape is Cancel and Tab stays inside.
// The child supplies the element carrying `headingId`.
export function DialogShell({ headingId, onCancel, focusKey, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Document-level, so Escape and Tab behave the same wherever focus is -- a
  // click on the heading or padding must not strand the keyboard on <body>.
  const cancelRef = useRef(onCancel)
  useEffect(() => {
    cancelRef.current = onCancel
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = ref.current
      if (!dialog) return
      const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!dialog.contains(active) || (active === dialog && event.shiftKey)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [focusKey])

  return (
    <div className={styles.overlay}>
      <div
        aria-labelledby={headingId}
        aria-modal="true"
        className={styles.dialog}
        ref={ref}
        tabIndex={-1}
        role="dialog"
      >
        {children}
      </div>
    </div>
  )
}
