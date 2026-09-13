// Liquid glass orb for the Arena's agent avatar. Shader and uniform layout come from LerSent001/orb (MIT,
// see LICENSE-orb.txt); this file is Oathra's small runtime around it: four states (idle / listening / thinking /
// speaking), eased transitions, and a no-WebGPU fallback (the caller keeps its text glyph).
(() => {
  const CONFIG = {"activationSeconds":0.22,"settleSeconds":0.65,"thinking":{"style":"siri","glassEnabled":true,"speed":0.82,"radius":0.72,"contourDeform":0.0,"bandDensity":2.0,"chromaticShift":0.42,"metalScale":0.77,"metalStretch":0.23,"metalAngle":65.0,"metalOffset":0.0,"metalPhase":0.0,"metalEvolution":1.0,"metalRoughness":0.22,"metalDepth":0.25,"particleDensity":0.72,"ribbonCount":5.0,"ribbonWidth":0.42,"ribbonTwist":1.25,"ribbonFold":0.55,"ribbonBreath":0.3,"particleSize":1.2,"particleBloom":0.7,"zoom":0.36,"warp":3.2,"ridgeAmt":0.5,"sharp":2.2,"shade":0.12,"sheen":0.28,"gloss":0.24,"glassOpacity":0.44,"shellMidAlpha":0.18,"shellEdgeAlpha":0.18,"exposure":2.0,"edgeSoftness":0.005,"edgeGlow":0.0,"colorA":"#FFD86B","colorB":"#82F4FF","colorC":"#FF7BD5","colorD":"#8E6CFF","highlightColor":"#FFFFFF","shellInner":"#FFFFFF","shellMid":"#9BF4FF","shellEdge":"#C5A9FF","sheenColor":"#EAF4FF","specColor":"#DCEAFF","canvasColor":"#030409","glowColor":"#956CFF"},"idle":{"style":"siri","glassEnabled":true,"speed":0.24599999999999997,"radius":0.72,"contourDeform":0.0,"bandDensity":2.0,"chromaticShift":0.42,"metalScale":0.77,"metalStretch":0.23,"metalAngle":65.0,"metalOffset":0.0,"metalPhase":0.0,"metalEvolution":1.0,"metalRoughness":0.22,"metalDepth":0.25,"particleDensity":0.72,"ribbonCount":5.0,"ribbonWidth":0.42,"ribbonTwist":1.25,"ribbonFold":0.55,"ribbonBreath":0.3,"particleSize":1.2,"particleBloom":0.7,"zoom":0.3384,"warp":1.6640000000000001,"ridgeAmt":0.24,"sharp":1.9800000000000002,"shade":0.12,"sheen":0.28,"gloss":0.24,"glassOpacity":0.44,"shellMidAlpha":0.18,"shellEdgeAlpha":0.18,"exposure":1.36,"edgeSoftness":0.005,"edgeGlow":0.0,"colorA":"#B5A674","colorB":"#5E8794","colorC":"#9A648A","colorD":"#635B8A","highlightColor":"#B6C4D2","shellInner":"#FFFFFF","shellMid":"#9BF4FF","shellEdge":"#C5A9FF","sheenColor":"#EAF4FF","specColor":"#DCEAFF","canvasColor":"#030409","glowColor":"#6C688F"}};
  const NUMERIC = ["speed","radius","zoom","warp","ridgeAmt","sharp","shade","sheen","gloss","shellMidAlpha","shellEdgeAlpha","exposure","__style__","edgeSoftness","edgeGlow","__zero__","__glass__","glassOpacity","contourDeform","bandDensity","chromaticShift","metalScale","metalStretch","metalAngle","metalOffset","metalPhase","metalEvolution","metalRoughness","metalDepth","particleDensity","ribbonCount","ribbonWidth","ribbonTwist","ribbonFold","ribbonBreath","particleSize","particleBloom"];
  const COLORS = ["colorA","colorB","colorC","colorD","highlightColor","shellInner","shellMid","shellEdge","sheenColor","specColor","canvasColor","glowColor"];
  const PALETTE = ["#F7FBFF","#EFF6FD","#E0EEF9","#D4E6F7","#BBD5F3","#A6C7F0","#87B0EB","#6F9EE8","#6F9EE8","#6F9EE8","#6F9EE8","#6F9EE8"];
  const STYLE_INDEX = { siri: 9, voiceWave: 19, aurora: 10, plasma: 11, chrome: 12, opal: 13, spectrum: 14, frost: 15, blueDrop: 20, violetEmber: 21, refractiveBlob: 23, particleRibbon: 24, chromaticMetal: 22 };
  const FLOATS = 136, COLOR_OFFSET = 40, RIBBON_STYLE = 24, RIBBON_INSTANCES = 384 * 96 * 6;

  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, 1];
  const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const mixC = (a, b, p) => toSrgb(toLin(a) + (toLin(b) - toLin(a)) * p);
  const mixHex = (a, b, p) => { const x = rgb(a), y = rgb(b); return "#" + [0, 1, 2].map((i) => Math.round(Math.min(1, Math.max(0, mixC(x[i], y[i], p))) * 255).toString(16).padStart(2, "0")).join(""); };

  function seed(params) {
    const v = new Float32Array(FLOATS);
    NUMERIC.forEach((k, i) => { v[3 + i] = k === "__style__" ? STYLE_INDEX[params.style] ?? 9 : k === "__zero__" ? 0 : k === "__glass__" ? (params.glassEnabled ? 1 : 0) : Number(params[k]) || 0; });
    [...COLORS.map((k) => params[k]), ...PALETTE].forEach((hex, i) => v.set(rgb(hex), COLOR_OFFSET + i * 4));
    return v;
  }
  // Four states from the two the editor exports: listening sits between idle and thinking; speaking is thinking with more drive.
  function states(cfg) {
    const idle = cfg.idle, thinking = cfg.thinking;
    const listening = { ...idle, speed: idle.speed * 1.6, warp: idle.warp * 1.15, exposure: idle.exposure + (thinking.exposure - idle.exposure) * 0.3 };
    for (const k of ["colorA", "colorB", "colorC", "colorD", "highlightColor", "glowColor"]) listening[k] = mixHex(idle[k], thinking[k], 0.4);
    const speaking = { ...thinking, speed: thinking.speed * 1.25, ridgeAmt: thinking.ridgeAmt + 0.08, warp: thinking.warp * 1.08 };
    return { idle: seed(idle), listening: seed(listening), thinking: seed(thinking), speaking: seed(speaking) };
  }

  const supported = typeof navigator !== "undefined" && !!navigator.gpu;
  let shaderPromise = null;
  const loadShader = (url) => (shaderPromise ??= fetch(url).then((r) => { if (!r.ok) throw new Error(`orb shader ${r.status}`); return r.text(); }));

  async function mount(canvas, opts = {}) {
    if (!supported) throw new Error("WebGPU is not available");
    const cfg = opts.config || CONFIG;
    const seeds = states(cfg);
    const activationMs = (cfg.activationSeconds ?? 0.22) * 1000, settleMs = (cfg.settleSeconds ?? 0.65) * 1000;
    let state = opts.state || "idle", target = state;
    let from = new Float32Array(seeds[state]), to = new Float32Array(seeds[state]);
    const shown = new Float32Array(seeds[state]);
    let startedAt = 0, duration = 0, lastAt = null, phase = 0, stopped = false, raf = 0, device = null, ribbonTex = null;

    const progress = (now) => { if (!duration) return 1; const r = Math.min(1, Math.max(0, (now - startedAt) / duration)); return target === "thinking" || target === "speaking" ? 1 - (1 - r) ** 3 : r * r * (3 - 2 * r); };
    function sample(now) {
      const p = progress(now);
      for (let i = 3; i < FLOATS; i++) { const color = i >= COLOR_OFFSET && (i - COLOR_OFFSET) % 4 < 3; shown[i] = color ? mixC(from[i], to[i], p) : from[i] + (to[i] - from[i]) * p; }
      return shown;
    }
    function setState(next) {
      if (!seeds[next] || next === state) return;
      const now = performance.now(); sample(now);
      from = new Float32Array(shown); to = new Float32Array(seeds[next]); target = next; startedAt = now;
      duration = next === "thinking" || next === "speaking" ? activationMs : settleMs; state = next;
    }
    function destroy() { stopped = true; cancelAnimationFrame(raf); ribbonTex?.destroy(); device?.destroy(); }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    device = await adapter.requestDevice();
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("no webgpu canvas context");
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "premultiplied" });
    const shader = device.createShaderModule({ code: await loadShader(opts.shaderUrl || "orb/orb.wgsl") });
    const info = await shader.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === "error");
    if (errs.length) throw new Error(errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));
    const blendOver = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };
    const mk = (vs, fs, blend) => device.createRenderPipeline({ layout: "auto", vertex: { module: shader, entryPoint: vs }, fragment: { module: shader, entryPoint: fs, targets: [{ format, blend }] }, primitive: { topology: "triangle-list" } });
    const pipeline = mk("vs_main", "fs_main", blendOver);
    const ribbonPipeline = mk("ribbon_vs_main", "ribbon_fs_main", { color: { srcFactor: "one", dstFactor: "one", operation: "add" }, alpha: blendOver.alpha });
    const compositePipeline = mk("vs_main", "ribbon_composite_fs_main", blendOver);
    const values = new Float32Array(shown);
    const ubo = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }] });
    const ribbonBind = device.createBindGroup({ layout: ribbonPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }] });
    const sampler = device.createSampler({ addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", magFilter: "linear", minFilter: "linear" });
    let compositeBind = null;
    device.lost.then(() => { if (!stopped) { destroy(); opts.onLost?.(); } });

    function frame(now) {
      if (stopped) return;
      try {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; ribbonTex?.destroy(); ribbonTex = null; compositeBind = null; }
        values.set(sample(now));
        const dt = lastAt === null ? 0 : Math.min(0.1, Math.max(0, (now - lastAt) / 1000)); lastAt = now;
        phase += dt * Math.max(values[3], 0);
        values[0] = w; values[1] = h; values[2] = phase / Math.max(values[3], 0.001);
        device.queue.writeBuffer(ubo, 0, values);
        const ribbon = Math.round(values[15]) === RIBBON_STYLE;
        const enc = device.createCommandEncoder();
        if (ribbon) {
          if (!ribbonTex || !compositeBind) {
            ribbonTex = device.createTexture({ size: { width: w, height: h }, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
            compositeBind = device.createBindGroup({ layout: compositePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: ribbonTex.createView() }, { binding: 2, resource: sampler }] });
          }
          const p = enc.beginRenderPass({ colorAttachments: [{ view: ribbonTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
          p.setPipeline(ribbonPipeline); p.setBindGroup(0, ribbonBind); p.draw(6, RIBBON_INSTANCES); p.end();
        }
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
        if (ribbon) { pass.setPipeline(compositePipeline); pass.setBindGroup(0, compositeBind); } else { pass.setPipeline(pipeline); pass.setBindGroup(0, bind); }
        pass.draw(3); pass.end();
        device.queue.submit([enc.finish()]);
        raf = requestAnimationFrame(frame);
      } catch (e) { destroy(); opts.onLost?.(e); }
    }
    raf = requestAnimationFrame(frame);
    return { setState, getState: () => state, destroy };
  }

  window.OathraOrb = { supported, mount, config: CONFIG };
})();
