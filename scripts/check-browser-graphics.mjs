import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { bounded, browserChildEnvironment } from "./check-browser-runtime.mjs";

// Only this authored synthetic function executes. No URL, file, caller script,
// repository source or provider credential is accepted by this guard.
export function syntheticGraphicsFixture() {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D unavailable");
  ctx.fillStyle = "rgb(17,34,51)";
  ctx.fillRect(0, 0, 8, 8);
  const canvasPixel = Array.from(ctx.getImageData(4, 4, 1, 1).data);
  const surface = document.createElement("canvas");
  surface.width = 8;
  surface.height = 8;
  document.body.append(surface);
  const gl = surface.getContext("webgl", {
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL unavailable");
  const shader = (type, source) => {
    const object = gl.createShader(type);
    gl.shaderSource(object, source);
    gl.compileShader(object);
    if (!gl.getShaderParameter(object, gl.COMPILE_STATUS))
      throw new Error("Synthetic shader compile failed");
    return object;
  };
  const vertex = shader(
    gl.VERTEX_SHADER,
    "attribute vec2 position; void main(){ gl_Position=vec4(position,0.0,1.0); }",
  );
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    "precision mediump float; void main(){ gl_FragColor=vec4(0.0,1.0,0.0,1.0); }",
  );
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("Synthetic shader link failed");
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, 8, 8);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const webglPixel = new Uint8Array(4);
  gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, webglPixel);
  const webglError = gl.getError();
  gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return { canvasPixel, webglPixel: Array.from(webglPixel), webglError };
}

export function validateGraphicsResult(result) {
  if (
    !result ||
    JSON.stringify(result.canvasPixel) !== "[17,34,51,255]" ||
    JSON.stringify(result.webglPixel) !== "[0,255,0,255]" ||
    result.webglError !== 0
  )
    throw new Error("Synthetic Canvas/WebGL pixel or error mismatch");
}

export async function checkBrowserGraphics({
  chromium,
  env = process.env,
  signal,
  timeout = 10_000,
} = {}) {
  if (!chromium)
    chromium = createRequire(
      new URL("../apps/api/package.json", import.meta.url),
    )("playwright").chromium;
  const options = { signal, timeout };
  const lateClose = (resource) =>
    bounded(() => resource.close(), { timeout: 5_000 });
  let browser;
  let context;
  let attemptedRequests = 0;
  try {
    // No graphics-disable, unsafe shader, renderer-selection or TLS bypass args.
    browser = await bounded(
      () =>
        chromium.launch({
          headless: true,
          timeout,
          env: browserChildEnvironment(env),
        }),
      { ...options, onLateResolve: lateClose },
    );
    context = await bounded(
      () =>
        browser.newContext({
          offline: true,
          serviceWorkers: "block",
          javaScriptEnabled: true,
          viewport: { width: 64, height: 64 },
        }),
      { ...options, onLateResolve: lateClose },
    );
    await bounded(
      () =>
        context.route("**/*", (route) => {
          attemptedRequests++;
          return route.abort("blockedbyclient");
        }),
      options,
    );
    const page = await bounded(() => context.newPage(), options);
    page.setDefaultTimeout(timeout);
    await bounded(
      () =>
        page.setContent("<!doctype html><html><body></body></html>", {
          waitUntil: "domcontentloaded",
          timeout,
        }),
      options,
    );
    validateGraphicsResult(
      await bounded(() => page.evaluate(syntheticGraphicsFixture), options),
    );
    if (attemptedRequests !== 0)
      throw new Error("Synthetic graphics attempted network access");
    return "network-free authored synthetic Canvas2D/WebGL shader/pixel readback";
  } finally {
    const failures = [];
    for (const resource of [context, browser]) {
      if (resource)
        failures.push(...(await Promise.allSettled([lateClose(resource)])));
    }
    const failure = failures.find((value) => value.status === "rejected");
    if (failure) throw failure.reason;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const deadline = setTimeout(() => process.exit(1), 30_000);
  try {
    console.log(
      `Browser graphics verified: ${await checkBrowserGraphics({ signal: controller.signal })}`,
    );
  } catch (error) {
    const classification = /WebGL unavailable/.test(error?.message)
      ? "WebGL unavailable"
      : /Canvas2D unavailable/.test(error?.message)
        ? "Canvas2D unavailable"
        : "synthetic graphics check did not pass";
    console.error(
      `Browser graphics verification failed: ${classification}; no customer scripts or credentials used.`,
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
  if (process.exitCode) process.exit(process.exitCode);
}
