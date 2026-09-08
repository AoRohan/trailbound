import { useEffect, useRef } from 'react'
import type { Biome, Expedition } from '../game/types'

const NODE_STYLE: Record<string, { glyph: string; color: string }> = {
  encounter: { glyph: '⚔', color: '#ff8f6b' },
  cache: { glyph: '◈', color: '#ffc861' },
  shrine: { glyph: '✦', color: '#8fd6ff' },
  rest: { glyph: '⌂', color: '#9db4c8' },
  boss: { glyph: '☠', color: '#ff6b6b' },
}

/** How much road either side of the party is visible. */
const WINDOW_PACES = 2600

/**
 * The road, drawn as a side-on strip around the party's current position.
 *
 * Deliberately a window rather than the whole route: 20,000 paces squeezed into
 * 350 pixels is a line with dots on it, while a window makes the next encounter
 * feel like it is actually coming.
 */
export function RouteCanvas({
  expedition,
  biome,
}: {
  expedition: Expedition
  biome: Biome
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, rect.width)
      const h = Math.max(1, rect.height)

      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const [sky, ground, accent] = biome.colors
      const horizon = h * 0.62

      // Sky and ground.
      const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon)
      skyGrad.addColorStop(0, sky)
      skyGrad.addColorStop(1, ground)
      ctx.fillStyle = skyGrad
      ctx.fillRect(0, 0, w, horizon)

      ctx.fillStyle = ground
      ctx.fillRect(0, horizon, w, h - horizon)

      // Map paces to x, centred on the party but clamped at both ends of the road.
      const half = WINDOW_PACES / 2
      let from = expedition.paces - half
      let to = expedition.paces + half
      if (from < 0) {
        to -= from
        from = 0
      }
      if (to > expedition.length) {
        from = Math.max(0, from - (to - expedition.length))
        to = expedition.length
      }
      const span = Math.max(1, to - from)
      const x = (pace: number) => ((pace - from) / span) * w

      // Distant hills, seeded off the biome so each one looks like itself.
      ctx.fillStyle = accent
      ctx.globalAlpha = 0.13
      ctx.beginPath()
      ctx.moveTo(0, horizon)
      for (let i = 0; i <= w; i += 8) {
        const n =
          Math.sin((i + from * 0.02) * 0.013) * 12 + Math.sin((i + from * 0.02) * 0.031) * 6
        ctx.lineTo(i, horizon - 18 - n)
      }
      ctx.lineTo(w, horizon)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1

      // The road.
      const roadY = horizon + (h - horizon) * 0.42
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, roadY)
      ctx.lineTo(w, roadY)
      ctx.stroke()

      // Travelled portion.
      ctx.strokeStyle = accent
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, roadY)
      ctx.lineTo(Math.max(0, Math.min(w, x(expedition.paces))), roadY)
      ctx.stroke()

      // Nodes still ahead, plus a few just behind for a sense of motion.
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif'

      for (const node of expedition.route) {
        if (node.atPace < from - 40 || node.atPace > to + 40) continue
        const nx = x(node.atPace)
        const passed = node.atPace <= expedition.paces
        const style = NODE_STYLE[node.kind] ?? NODE_STYLE.cache!

        ctx.globalAlpha = passed ? 0.3 : 1
        ctx.fillStyle = style.color
        ctx.beginPath()
        ctx.arc(nx, roadY, node.kind === 'boss' ? 9 : 6.5, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = 'rgba(0,0,0,0.75)'
        ctx.fillText(style.glyph, nx, roadY + 0.5)
        ctx.globalAlpha = 1
      }

      // The party.
      const px = Math.max(0, Math.min(w, x(expedition.paces)))
      ctx.fillStyle = 'rgba(255,255,255,0.22)'
      ctx.beginPath()
      ctx.arc(px, roadY, 13, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(px, roadY, 5.5, 0, Math.PI * 2)
      ctx.fill()
    }

    draw()

    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [expedition, biome])

  return <canvas ref={ref} className="routecanvas" aria-label="The road ahead" />
}
