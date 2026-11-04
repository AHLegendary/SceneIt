import { useEffect, useRef } from 'react'

// Blue fire for the losing card in a head-to-head: a canvas particle flame
// drawn over the card while its body erodes from the bottom up (the CSS
// mask in .pick--burn). Flames spawn along the burn line as it climbs, so
// the fire looks like it's eating the card, with embers drifting up off it.
//
// Procedural, no assets: soft sprites blended additively give the white-hot
// core / sky-blue / deep-blue falloff of the flame. One canvas, one rAF loop,
// gone when the burn ends.
const PAD = 48 // room around the card for flames to spill into
const ABOVE = 140 // extra room above for rising embers

function makeSprite(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(236, 251, 255, 1)')
  grad.addColorStop(0.2, 'rgba(160, 230, 255, 0.85)')
  grad.addColorStop(0.5, 'rgba(70, 180, 255, 0.35)')
  grad.addColorStop(0.8, 'rgba(20, 90, 200, 0.12)')
  grad.addColorStop(1, 'rgba(0, 40, 120, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

export default function BlueFire({ duration = 900 }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const host = canvas.parentElement
    if (!canvas || !host) return undefined
    const box = host.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = box.width + PAD * 2
    const H = box.height + PAD * 2 + ABOVE
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    canvas.style.left = `${-PAD}px`
    canvas.style.top = `${-(PAD + ABOVE)}px`
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    const sprite = makeSprite(64)

    const left = PAD
    const right = PAD + box.width
    const top = PAD + ABOVE
    const bottom = top + box.height
    const particles = []
    const rand = (a, b) => a + Math.random() * (b - a)
    const start = performance.now()
    let last = start
    let raf = 0

    function spawn(lineY, count, kind) {
      for (let i = 0; i < count; i++) {
        // more flame toward the middle of the card than its edges
        const u = (Math.random() + Math.random()) / 2
        const x = left - 6 + (right - left + 12) * u
        if (kind === 'flame') {
          particles.push({
            x, y: lineY + rand(-6, 12),
            vx: rand(-24, 24), vy: -rand(180, 380),
            size: rand(20, 44), life: rand(320, 560), age: 0,
            wobble: rand(0, Math.PI * 2), kind,
          })
        } else {
          particles.push({
            x, y: lineY + rand(-10, 4),
            vx: rand(-60, 60), vy: -rand(220, 420),
            size: rand(3, 7), life: rand(420, 760), age: 0,
            wobble: rand(0, Math.PI * 2), kind,
          })
        }
      }
    }

    function frame(now) {
      const dt = Math.min(40, now - last)
      last = now
      const t = Math.min(1, (now - start) / duration)
      // The CSS mask edge climbs the card between 25% and 75% of the burn.
      const eaten = Math.min(1, Math.max(0, 2 * t - 0.5))
      const lineY = bottom - (bottom - top) * eaten

      if (t < 1) {
        spawn(lineY, 12, 'flame')
        spawn(lineY, 3, 'ember')
      }

      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'

      // the burning edge itself: a soft white-blue line where the card is going
      if (t < 1) {
        const edge = ctx.createLinearGradient(0, lineY - 18, 0, lineY + 10)
        edge.addColorStop(0, 'rgba(120, 210, 255, 0)')
        edge.addColorStop(0.6, 'rgba(210, 245, 255, 0.9)')
        edge.addColorStop(1, 'rgba(120, 210, 255, 0)')
        ctx.fillStyle = edge
        ctx.fillRect(left - 4, lineY - 18, right - left + 8, 28)
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.age += dt
        if (p.age >= p.life) {
          particles.splice(i, 1)
          continue
        }
        const k = p.age / p.life
        const s = dt / 1000
        p.wobble += s * 9
        p.x += (p.vx + Math.sin(p.wobble) * (p.kind === 'flame' ? 55 : 25)) * s
        p.y += p.vy * s
        if (p.kind === 'flame') p.vy *= 0.985
        const size = p.kind === 'flame' ? p.size * (1 - k * 0.65) : p.size * (1 - k * 0.4)
        // flames are tongues: taller than wide, stretching as they rise
        const tall = p.kind === 'flame' ? size * (1.4 + k * 0.8) : size
        ctx.globalAlpha = p.kind === 'flame' ? (1 - k) * 0.85 : 1 - k
        ctx.drawImage(sprite, p.x - size / 2, p.y - tall / 2, size, tall)
      }
      ctx.globalAlpha = 1

      if (t < 1 || particles.length) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [duration])

  return <canvas ref={ref} className="pick__flames" aria-hidden="true" />
}
