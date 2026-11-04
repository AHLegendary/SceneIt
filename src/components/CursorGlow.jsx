import { useEffect, useRef } from 'react'

// A short liquid trail of sky-blue light behind the cursor. The head sits
// exactly on the pointer (no lag); a chain of links behind it each eases
// toward the one in front, so the trail bends and settles like a drop of
// water. Each link is a soft radial blob and they blend additively, which
// gives the fluid, merged look without any expensive blur filters.
// Drawn on a small canvas that rides along with the cursor (moved with a
// GPU transform), so each frame is a few tiny sprite draws and the rest of
// the page never repaints. pointer-events: none. Off on touch devices and
// when the user prefers reduced motion.

const LINKS = 10 // trail length, in links
const EASE = 0.5 // how fast each link catches the one ahead (0..1)
const HEAD_RADIUS = 15
const SPRITE = 64 // px, the pre-rendered glow blob
const SIZE = 240 // px, the moving canvas (big enough for the trail at full speed)

// One soft blob drawn once; every link is a scaled copy of it (drawImage is
// far cheaper than building a gradient per blob per frame).
function makeSprite() {
  const c = document.createElement('canvas')
  c.width = SPRITE
  c.height = SPRITE
  const g = c.getContext('2d')
  const r = SPRITE / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, 'rgba(225, 248, 255, 1)')
  grad.addColorStop(0.35, 'rgba(120, 215, 255, 0.7)')
  grad.addColorStop(1, 'rgba(102, 209, 255, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, SPRITE, SPRITE)
  return c
}

export default function CursorGlow() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!fine.matches || reduced.matches) return undefined

    // desynchronized: lets the browser present the canvas with less latency
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })
    const sprite = makeSprite()
    let frame = 0
    let visible = false
    let slowFrames = 0 // consecutive frames over budget; the trail turns itself off if this builds up
    let last = 0
    let fade = 0 // 0..1, eases in when the pointer arrives and out when it leaves
    const pointer = { x: -100, y: -100 }
    const chain = Array.from({ length: LINKS }, () => ({ x: -100, y: -100 }))

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    canvas.style.width = `${SIZE}px`
    canvas.style.height = `${SIZE}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let originX = 0 // page position of the canvas's top-left corner
    let originY = 0

    function blob(x, y, r, alpha) {
      ctx.globalAlpha = alpha
      ctx.drawImage(sprite, x - originX - r, y - originY - r, r * 2, r * 2)
    }

    function disable() {
      cleanup()
      canvas.style.display = 'none'
    }

    function draw(now) {
      frame = 0
      // Safety: this must never cost frames. If the page is consistently
      // missing 60fps while the trail is on, switch it off for this visit.
      if (last && now - last > 34) {
        if (++slowFrames > 45) return disable()
      } else slowFrames = Math.max(0, slowFrames - 1)
      last = now
      // head is pinned to the pointer; every other link chases the one ahead
      chain[0].x = pointer.x
      chain[0].y = pointer.y
      let settled = true
      for (let i = 1; i < LINKS; i++) {
        const ahead = chain[i - 1]
        const link = chain[i]
        link.x += (ahead.x - link.x) * EASE
        link.y += (ahead.y - link.y) * EASE
        if (Math.abs(ahead.x - link.x) + Math.abs(ahead.y - link.y) > 0.3) settled = false
      }
      fade += ((visible ? 1 : 0) - fade) * 0.18

      // move the canvas so the head sits at its centre, then draw relative to it
      originX = chain[0].x - SIZE / 2
      originY = chain[0].y - SIZE / 2
      canvas.style.transform = `translate3d(${originX}px, ${originY}px, 0)`
      ctx.clearRect(0, 0, SIZE, SIZE)
      if (fade > 0.01) {
        ctx.globalCompositeOperation = 'lighter'
        // tail → head, with a midpoint blob between links so fast moves stay continuous
        for (let i = LINKS - 1; i >= 0; i--) {
          const k = 1 - i / LINKS // 1 at the head → small at the tail
          const r = HEAD_RADIUS * (0.3 + 0.7 * k)
          const a = (0.1 + 0.5 * k * k) * fade
          if (i > 0) blob((chain[i].x + chain[i - 1].x) / 2, (chain[i].y + chain[i - 1].y) / 2, r, a * 0.8)
          blob(chain[i].x, chain[i].y, r, a)
        }
        blob(chain[0].x, chain[0].y, HEAD_RADIUS * 2.4, 0.1 * fade) // soft halo
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }

      const fading = Math.abs((visible ? 1 : 0) - fade) > 0.01
      if (!settled || fading) frame = requestAnimationFrame(draw)
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    function onMove(e) {
      if (e.pointerType && e.pointerType !== 'mouse') return
      if (!visible) {
        // first appearance: start the whole chain at the pointer, no streak from offscreen
        for (const link of chain) {
          link.x = e.clientX
          link.y = e.clientY
        }
      }
      pointer.x = e.clientX
      pointer.y = e.clientY
      visible = true
      schedule()
    }
    function onLeave() {
      visible = false
      schedule()
    }
    function onVisibility() {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('mouseleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    function cleanup() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    return cleanup
  }, [])

  return <canvas ref={canvasRef} className="cursor-glow" aria-hidden="true" />
}
