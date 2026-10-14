'use client'

import { useEffect, useRef } from 'react'

// Original flowing blue pigment; fixed grain is composited separately. No catalogue source.
const vertex = `attribute vec2 position;
void main(){gl_Position=vec4(position,0.0,1.0);}`
const fragment = `precision highp float;
uniform vec2 size;
uniform float time;
uniform float footer;
uniform float dark;
uniform float safe;
uniform float blendBottom;
uniform float fullColor;
void main(){
 vec2 uv=gl_FragCoord.xy/size;
 float x=uv.x*2.2;
 float flow=uv.y + .19*sin(x*2.0+time*.15) + .09*sin(x*4.2-time*.11);
 float ribbon=.5+.5*sin(flow*9.0+time*.09);
 ribbon=smoothstep(.05,.95,ribbon);
 vec3 deep=vec3(.025,.085,.24);
 vec3 blue=vec3(.10,.30,.78);
 vec3 pale=vec3(.67,.82,.98);
 deep=mix(deep,mix(vec3(.05,.13,.35),vec3(.24,.41,.76),dark),fullColor);
 blue=mix(blue,mix(vec3(.12,.30,.72),vec3(.25,.44,.86),dark),fullColor);
 pale=mix(pale,mix(vec3(.25,.44,.86),pale,dark),fullColor);
 vec3 color=mix(deep,blue,smoothstep(.0,.55,ribbon));
 color=mix(color,pale,smoothstep(.58,1.0,ribbon)*(1.0-footer*.76));
 // Footer navigation sits on a darker field; the texture emerges towards its close.
 color=mix(color,vec3(.075,.19,.48),footer*smoothstep(.28,.95,uv.y)*.78);
 vec3 base=mix(vec3(.957),vec3(.09),dark);
 color=mix(color,base,(1.0-footer)*(1.0-fullColor)*smoothstep(1.0-safe-.05,1.0-safe,uv.y)*.97);
 // Let pigment settle into the following page surface, without a hard cut.
 color=mix(color,base,blendBottom*(1.0-smoothstep(0.0,.16,uv.y)));
 gl_FragColor=vec4(color,1.0);
}`

export function PublicMaterial({
    footer = false,
    blendBottom = false,
    fullColor = false,
}: {
    footer?: boolean
    blendBottom?: boolean
    fullColor?: boolean
}) {
    const canvas = useRef<HTMLCanvasElement>(null)
    useEffect(() => {
        const node = canvas.current
        if (!node) return
        const gl = node.getContext('webgl', { alpha: false, antialias: false, depth: false })
        if (!gl) return
        const shaders: WebGLShader[] = []
        function compile(type: number, source: string) {
            const shader = gl!.createShader(type)
            if (!shader) return null
            gl!.shaderSource(shader, source)
            gl!.compileShader(shader)
            if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
                gl!.deleteShader(shader)
                return null
            }
            shaders.push(shader)
            return shader
        }
        const v = compile(gl.VERTEX_SHADER, vertex)
        const f = compile(gl.FRAGMENT_SHADER, fragment)
        const program = gl.createProgram()
        if (!v || !f || !program) {
            shaders.forEach(shader => gl.deleteShader(shader))
            if (program) gl.deleteProgram(program)
            return
        }
        gl.attachShader(program, v)
        gl.attachShader(program, f)
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            shaders.forEach(shader => gl.deleteShader(shader))
            gl.deleteProgram(program)
            return
        }
        gl.useProgram(program)
        const buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
            gl.STATIC_DRAW
        )
        const position = gl.getAttribLocation(program, 'position')
        gl.enableVertexAttribArray(position)
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
        const size = gl.getUniformLocation(program, 'size')
        const time = gl.getUniformLocation(program, 'time')
        gl.uniform1f(gl.getUniformLocation(program, 'footer'), footer ? 1 : 0)
        gl.uniform1f(gl.getUniformLocation(program, 'blendBottom'), blendBottom ? 1 : 0)
        gl.uniform1f(gl.getUniformLocation(program, 'fullColor'), fullColor ? 1 : 0)
        const dark = gl.getUniformLocation(program, 'dark')
        const safe = gl.getUniformLocation(program, 'safe')
        const preference = matchMedia('(prefers-reduced-motion: reduce)')
        let frame = 0
        let visible = false
        let last = 0
        let elapsed = 0
        let lost = false
        function draw() {
            if (lost) return
            gl!.uniform1f(dark, document.documentElement.classList.contains('dark') ? 1 : 0)
            gl!.uniform2f(size, node!.width, node!.height)
            gl!.uniform1f(time, elapsed)
            gl!.drawArrays(gl!.TRIANGLES, 0, 6)
            node!.dataset.ready = 'true'
        }
        function tick(now: number) {
            if (now - last >= 33) {
                elapsed += Math.min((now - last) / 1000, 0.1)
                last = now
                draw()
            }
            frame = requestAnimationFrame(tick)
        }
        function update() {
            cancelAnimationFrame(frame)
            last = performance.now()
            draw()
            if (visible && !document.hidden && !preference.matches && !lost)
                frame = requestAnimationFrame(tick)
        }
        const resize = new ResizeObserver(() => {
            const rect = node.getBoundingClientRect()
            const ratio = Math.min(1, 1400 / Math.max(rect.width, 1))
            node.width = Math.max(1, Math.round(rect.width * ratio))
            node.height = Math.max(1, Math.round(rect.height * ratio))
            const scene = node.closest<HTMLElement>('.home-hero, .home-error-main')
            const intro = scene?.querySelector<HTMLElement>('.home-intro')
            gl.uniform1f(
                safe,
                intro
                    ? Math.min(
                          0.9,
                          (intro.offsetTop + intro.offsetHeight + 24) / Math.max(rect.height, 1)
                      )
                    : scene?.classList.contains('home-error-main')
                      ? 0.9
                      : 0.4
            )
            gl.viewport(0, 0, node.width, node.height)
            draw()
        })
        resize.observe(node)
        const theme = new MutationObserver(draw)
        theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
        const observer = new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? false
            update()
        })
        observer.observe(node)
        function contextLost() {
            lost = true
            cancelAnimationFrame(frame)
            delete node!.dataset.ready
        }
        node.addEventListener('webglcontextlost', contextLost)
        preference.addEventListener('change', update)
        document.addEventListener('visibilitychange', update)
        return () => {
            cancelAnimationFrame(frame)
            resize.disconnect()
            theme.disconnect()
            observer.disconnect()
            preference.removeEventListener('change', update)
            document.removeEventListener('visibilitychange', update)
            node.removeEventListener('webglcontextlost', contextLost)
            gl.deleteBuffer(buffer)
            gl.deleteProgram(program)
            shaders.forEach(shader => gl.deleteShader(shader))
        }
    }, [footer, blendBottom, fullColor])
    return (
        <div className="home-material-layer" aria-hidden="true">
            <canvas ref={canvas} className="home-material" />
            <div className="home-material-grain" />
        </div>
    )
}
