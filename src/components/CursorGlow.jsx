import { useEffect, useState } from 'react'
import { m, useMotionValue, useReducedMotion, useSpring } from 'motion/react'

// A soft cyan glow that trails the pointer: one fixed element, two spring
// motion values, no canvas, no WebGL. Only for mouse-style pointers (never on
// touch), off under prefers-reduced-motion, and hidden while the pointer is
// outside the window. Motion writes the transform straight to the node, so
// moving the mouse never re-renders React.
export default function CursorGlow() {
  const x = useMotionValue(-400)
  const y = useMotionValue(-400)
  const sx = useSpring(x, { stiffness: 320, damping: 32, mass: 0.5 })
  const sy = useSpring(y, { stiffness: 320, damping: 32, mass: 0.5 })
  const reduced = useReducedMotion()
  const [fine, setFine] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia('(pointer: fine)')
    const sync = () => setFine(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!fine || reduced) return undefined
    const move = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return
      x.set(e.clientX)
      y.set(e.clientY)
      setShown(true)
    }
    const leave = () => setShown(false)
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    window.addEventListener('blur', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      window.removeEventListener('blur', leave)
    }
  }, [fine, reduced, x, y])

  if (!fine || reduced) return null
  return (
    <m.div
      className="cursor-glow"
      aria-hidden="true"
      style={{ x: sx, y: sy }}
      animate={{ opacity: shown ? 1 : 0 }}
      transition={{ duration: 0.25 }}
    />
  )
}
