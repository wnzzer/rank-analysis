/**
 * useEmberField —— 「熔炉余烬」粒子场（Home 标杆页背景）
 *
 * 视觉：金色菱形微粒上浮 + 少量巨型六边形描边环旋转；
 * 物理：鼠标斥力场，粒子被推开后阻尼回归漂移轨道；
 * 工程：jsdom/无 canvas 环境静默降级；prefers-reduced-motion 只绘一帧；
 * 主题：运行时读取 documentElement 品牌token，class 变化自动换色。
 */
import { onBeforeUnmount, onMounted, type Ref } from 'vue'

export interface EmberFieldOptions {
  /** 冷却态（离线）：粒子减量并转灰烬色 */
  cold?: Ref<boolean>
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  phase: number
  speed: number
  sway: number
  cyan: boolean
}

interface HexRing {
  x: number
  y: number
  r: number
  angle: number
  spin: number
  alpha: number
}

export function useEmberField(
  canvas: Ref<HTMLCanvasElement | null>,
  options: EmberFieldOptions = {}
) {
  let ctx: CanvasRenderingContext2D | null = null
  let raf = 0
  let width = 0
  let height = 0
  const particles: Particle[] = []
  const rings: HexRing[] = []
  const mouse = { x: -9999, y: -9999 }
  let reduced = false
  let palette = { main: '240,201,107', accent: '76,194,255' }
  let themeObs: MutationObserver | null = null
  let ro: ResizeObserver | null = null
  const cold = options.cold

  function readPalette() {
    if (typeof getComputedStyle !== 'function') return
    const cs = getComputedStyle(document.documentElement)
    const pick = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    const light = document.documentElement.classList.contains('theme-light')
    palette = {
      main: pick(light ? '--hx-gold-700' : '--hx-gold-300', light ? '138,100,32' : '240,201,107'),
      accent: pick('--hx-cyan-300', '76,194,255')
    }
  }

  function targetCount() {
    const base = Math.round((width * height) / 16000)
    return cold?.value ? Math.max(10, Math.round(base * 0.45)) : Math.max(18, base)
  }

  function seed() {
    particles.length = 0
    const n = targetCount()
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: 0,
        vy: -(5 + Math.random() * 11),
        size: 1 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.2,
        sway: 12 + Math.random() * 26,
        cyan: !cold?.value && Math.random() < 0.08
      })
    }
    rings.length = 0
    for (let i = 0; i < 3; i++) {
      rings.push({
        x: width * (0.22 + 0.28 * i),
        y: height * (0.35 + 0.2 * (i % 2)),
        r: 60 + i * 52,
        angle: Math.random() * Math.PI,
        spin: (i % 2 === 0 ? -1 : 1) * (0.02 + 0.015 * i),
        alpha: 0.055 - i * 0.012
      })
    }
  }

  function resize() {
    const el = canvas.value
    if (!el) return
    ctx = el.getContext('2d')
    if (!ctx) return
    const rect = el.getBoundingClientRect()
    width = Math.max(1, Math.floor(rect.width))
    height = Math.max(1, Math.floor(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    el.width = width * dpr
    el.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    seed()
    if (reduced) drawFrame(16)
  }

  function drawHexRing(h: HexRing) {
    if (!ctx) return
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = h.angle + (i * Math.PI) / 3
      const px = h.x + Math.cos(a) * h.r
      const py = h.y + Math.sin(a) * h.r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.strokeStyle = `rgba(${palette.main},${h.alpha})`
    ctx.lineWidth = 1
    ctx.stroke()
  }

  function drawFrame(dtMs: number) {
    if (!ctx) return
    const dt = Math.min(dtMs, 50) / 1000
    const now = performance.now()
    ctx.clearRect(0, 0, width, height)

    // 补齐/回收粒子（离线冷却态减量）
    const want = targetCount()
    while (particles.length > want) particles.pop()
    while (particles.length < want) {
      particles.push({
        x: Math.random() * width,
        y: height + Math.random() * 20,
        vx: 0,
        vy: -(5 + Math.random() * 11),
        size: 1 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.2,
        sway: 12 + Math.random() * 26,
        cyan: !cold?.value && Math.random() < 0.08
      })
    }

    for (const p of particles) {
      // 鼠标斥力：半径内推离，速度阻尼回轨
      const dx = p.x - mouse.x
      const dy = p.y - mouse.y
      const d2 = dx * dx + dy * dy
      if (d2 < 10000 && d2 > 0.01) {
        const d = Math.sqrt(d2)
        const f = ((100 - d) / 100) * 46
        p.vx += (dx / d) * f * dt
        p.vy += (dy / d) * f * dt
      }
      p.vx *= 0.9
      const driftVx = Math.sin(p.phase + now * 0.0004 * p.speed) * p.sway * 0.02
      p.x += (p.vx + driftVx) * dt * 60 * 0.55
      p.y += (p.vy + (cold?.value ? 3 : 0)) * dt * 60 * 0.55
      if (p.y < -8) {
        p.y = height + 8
        p.x = Math.random() * width
        p.vy = -(5 + Math.random() * 11)
      }
      if (p.x < -10) p.x = width + 8
      if (p.x > width + 10) p.x = -8

      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.001 * p.speed + p.phase))
      const rgb = p.cyan ? palette.accent : palette.main
      ctx.fillStyle = `rgba(${rgb},${(cold?.value ? 0.28 : 0.55) * twinkle})`
      // 菱形微粒：与切角几何同语
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size)
      ctx.restore()
    }

    for (const h of rings) {
      h.angle += h.spin * dt
      drawHexRing(h)
    }
  }

  function loop(ts: number) {
    drawFrame(lastTs ? ts - lastTs : 16)
    lastTs = ts
    raf = requestAnimationFrame(loop)
  }
  let lastTs = 0

  function start() {
    if (raf || reduced) return
    lastTs = 0
    raf = requestAnimationFrame(loop)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  function onMove(e: PointerEvent) {
    const el = canvas.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    mouse.x = e.clientX - rect.left
    mouse.y = e.clientY - rect.top
  }
  function onLeave() {
    mouse.x = -9999
    mouse.y = -9999
  }
  function onVisibility() {
    document.hidden ? stop() : start()
  }

  onMounted(() => {
    // jsdom 测试环境：无 canvas 实现（getContext 触发 Not implemented 噪音），整段跳过
    if (/jsdom/i.test(window.navigator?.userAgent ?? '')) return
    reduced =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false
    readPalette()
    resize()
    if (!ctx) return
    if (reduced) {
      // 减弱动效：只绘一帧静态余烬，保留氛围但零动画
      drawFrame(16)
      return
    }
    start()
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    themeObs = new MutationObserver(() => {
      readPalette()
      if (reduced) drawFrame(16)
    })
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => resize())
      ro.observe(canvas.value as Element)
    } else {
      window.addEventListener('resize', resize)
    }
  })

  onBeforeUnmount(() => {
    stop()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerleave', onLeave)
    document.removeEventListener('visibilitychange', onVisibility)
    themeObs?.disconnect()
    if (ro) ro.disconnect()
    else window.removeEventListener('resize', resize)
  })
}
