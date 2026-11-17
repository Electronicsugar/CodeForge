// Generic code runner used by every language.
//
// Docker is required by default; direct mode requires an explicit development opt-in.
// Two modes, chosen once per process:
//   * Docker  – each compile/run happens in a throw-away container with no
//               network, memory/CPU/pid limits, read-only root FS.
//   * Direct  – (cloud/demo fallback, e.g. Render without Docker) runs the
//               toolchain on the host. This is NOT a real sandbox, so it is
//               hardened as far as plain Node allows: no shell, scrubbed
//               environment (server secrets are NOT visible to user code),
//               private working dir, process-group kill on timeout, capped
//               output and ulimit file-size / address-space limits.
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { getLanguage } = require("./languages");

const execFileAsync = promisify(execFile);

const RUNNER_IMAGE = process.env.RUNNER_IMAGE || "codeforge-runner:2.0";
const MAX_OUTPUT_BYTES = 1024 * 1024;

// ─── environment detection (cached) ──────────────────────────────────────────
let dockerReady = null;
const checkDocker = async () => {
    if (dockerReady !== null) return dockerReady;
    if (process.env.FORCE_DIRECT_EXECUTION === "true") {
        if (process.env.NODE_ENV === 'production') throw new Error('Direct execution is disabled in production; Docker is required');
        console.warn("[runner] FORCE_DIRECT_EXECUTION=true — using direct execution");
        return (dockerReady = false);
    }
    try {
        await execFileAsync("docker", ["info"], { timeout: 5000 });
        await execFileAsync("docker", ["image", "inspect", RUNNER_IMAGE], { timeout: 5000 });
        console.log(`[runner] Docker available, image ${RUNNER_IMAGE} found — sandboxed execution`);
        dockerReady = true;
    } catch {
        throw new Error(
            "[runner] Docker or image " + RUNNER_IMAGE + " unavailable; direct execution " +
            "is disabled. Build the image with: docker build -t " + RUNNER_IMAGE +
            " backend/src/services/executor/docker"
        );
    }
    return dockerReady;
};

// javac is missing on some JRE-only hosts even though the compiler module exists.
let javacCommand = null;
const resolveJavac = async () => {
    if (javacCommand) return javacCommand;
    try {
        await execFileAsync("javac", ["-version"], { timeout: 8000 });
        javacCommand = ["javac"];
    } catch {
        javacCommand = ["java", "-Xmx256m", "--module", "jdk.compiler/com.sun.tools.javac.Main"];
    }
    return javacCommand;
};

const resolveCompile = async (lang) => {
    if (!lang.compile) return null;
    if (lang.id === "java") {
        const [, ...rest] = lang.compile; // drop "javac", keep flags
        const base = await resolveJavac();
        return [...base, ...rest.filter((a) => !a.startsWith("-J"))];
    }
    return lang.compile;
};

// ─── process helper (direct mode) ────────────────────────────────────────────
const scrubbedEnv = (home) => ({
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    TMPDIR: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONIOENCODING: "utf-8"
});

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const runProcess = (command, args, { cwd, input = "", timeoutMs, env, virtualKb } = {}) =>
    new Promise((resolve) => {
        // ulimit lives in a tiny fixed `sh -c` wrapper; user-controlled values are
        // only ever passed as positional parameters, never interpolated.
        const limits = ["ulimit -f 20480"];
        if (virtualKb) limits.push(`ulimit -v ${Number(virtualKb)}`);
        limits.push('exec "$@"');

        const started = Date.now();
        // Docker already supplies the sandbox; invoke its CLI directly so the
        // Windows host does not require a POSIX shell.
        const docker = command === 'docker';
        const child = spawn(docker ? command : "sh", docker ? args : ["-c", limits.join("; "), "sh", command, ...args], {
            cwd, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
        });

        let stdout = "", stderr = "", outBytes = 0, timedOut = false, overflow = false, settled = false;

        const killGroup = () => {
            try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
        };
        const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);

        const take = (chunk, which) => {
            outBytes += chunk.length;
            if (outBytes > MAX_OUTPUT_BYTES) { overflow = true; killGroup(); return; }
            if (which === "out") stdout += chunk.toString("utf8");
            else stderr += chunk.toString("utf8");
        };
        child.stdout.on("data", (c) => take(c, "out"));
        child.stderr.on("data", (c) => take(c, "err"));
        child.stdin.on("error", () => {});
        child.stdin.end(input);

        const finish = (code, signal, spawnError) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            killGroup(); // reap anything the program forked
            resolve({
                code, signal, stdout, stderr: spawnError ? String(spawnError.message) : stderr,
                timedOut, overflow, ms: Date.now() - started
            });
        };
        child.on("error", (e) => finish(null, null, e));
        child.on("close", (code, signal) => finish(code, signal));
    });

const tidy = (text, dir) =>
    String(text || "").split(dir).join(".").replace(/\u0000/g, "").slice(0, 4000).trim();

// ─── direct mode ─────────────────────────────────────────────────────────────
const prepareDirect = async (lang, dir) => {
    const compile = await resolveCompile(lang);
    if (!compile) return { ok: true };
    const [cmd, ...args] = compile;
    const r = await runProcess(cmd, args, {
        cwd: dir, timeoutMs: lang.compileTimeMs, env: scrubbedEnv(dir),
        virtualKb: lang.id === "cpp" ? 2 * 1024 * 1024 : null
    });
    if (r.code !== 0) {
        return { ok: false, error: tidy(r.stderr || r.stdout || (r.timedOut ? "Compilation timed out" : "Compilation failed"), dir) };
    }
    return { ok: true };
};

const runDirect = async (lang, dir, input) => {
    const [cmd, ...args] = lang.run;
    const r = await runProcess(cmd, args, {
        cwd: dir, input, timeoutMs: lang.timeMs, env: scrubbedEnv(dir), virtualKb: lang.virtualKb
    });
    return r;
};

// ─── docker mode ─────────────────────────────────────────────────────────────
const dockerBase = (dir, mem, extra = []) => [
    "run", "--rm", "-i",
    "--network", "none",
    "--memory", `${mem}m`, "--memory-swap", `${mem}m`,
    "--cpus", "1",
    "--pids-limit", "128",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:rw,size=64m",
    "-v", `${dir}:/workspace:rw`,
    "-w", "/workspace",
    ...extra,
    RUNNER_IMAGE
];

const prepareDocker = async (lang, dir) => {
    if (!lang.compile) return { ok: true };
    const args = [...dockerBase(dir, 512), ...lang.compile];
    const r = await runProcess("docker", args, {
        cwd: dir, timeoutMs: lang.compileTimeMs + 10000, env: { PATH: process.env.PATH, HOME: dir }
    });
    if (r.code !== 0) {
        return { ok: false, error: tidy(r.stderr || r.stdout || "Compilation failed", "/workspace") };
    }
    return { ok: true };
};

const runDocker = async (lang, dir, input) => {
    const seconds = Math.ceil(lang.timeMs / 1000);
    const args = [
        ...dockerBase(dir, lang.memMb),
        "/usr/bin/time", "-f", "__MEMORY__%M",
        "timeout", "--signal=KILL", `${seconds}s`, ...lang.run
    ];
    const r = await runProcess("docker", args, {
        cwd: dir, input, timeoutMs: lang.timeMs + 6000, env: { PATH: process.env.PATH, HOME: dir }
    });
    const mem = r.stderr.match(/__MEMORY__(\d+)/);
    const cleanErr = r.stderr.replace(/__MEMORY__\d+\s*/g, "");
    // `timeout --signal=KILL` ends the child with 137 (128+9).
    const killedByLimit = r.code === 137 || r.code === 124;
    return {
        ...r,
        stderr: cleanErr,
        timedOut: r.timedOut || (killedByLimit && r.ms >= lang.timeMs - 150),
        memory: mem ? Number(mem[1]) : null
    };
};

// ─── public API ──────────────────────────────────────────────────────────────
/**
 * @param {string} languageId   one of the ids in languages.js
 * @param {string} code         complete program (already wrapped by code-generator)
 * @param {{input:string}[]} testCases
 * @param {{isFailure?:(result:object, testCase:object)=>boolean}} [options]
 *        When `isFailure` returns true the remaining tests are skipped (the judge
 *        stops at the first failure anyway, so running them is wasted CPU).
 * @returns {Promise<{results: object[]}>}
 */
const executeCode = async (languageId, code, testCases, options = {}) => {
    const lang = getLanguage(languageId);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codeforge-"));
    await fs.chmod(dir, 0o755);

    try {
        await fs.writeFile(path.join(dir, lang.file), code);
        const useDocker = await checkDocker();

        const prepared = useDocker ? await prepareDocker(lang, dir) : await prepareDirect(lang, dir);
        if (!prepared.ok) {
            return {
                results: testCases.map(() => ({
                    status: "compile_error", output: "", error: prepared.error, runtime: 0
                }))
            };
        }

        const results = [];
        for (const testCase of testCases) {
            const r = useDocker
                ? await runDocker(lang, dir, testCase.input)
                : await runDirect(lang, dir, testCase.input);

            let result;
            if (r.timedOut) {
                result = { status: "time_limit_exceeded", output: "", error: "Time limit exceeded", runtime: r.ms };
            } else if (r.overflow) {
                result = { status: "runtime_error", output: "", error: "Output limit exceeded", runtime: r.ms };
            } else if (r.code !== 0) {
                const reason = r.signal ? `Terminated by ${r.signal}` : `Exited with code ${r.code}`;
                result = {
                    status: "runtime_error", output: r.stdout,
                    error: tidy(r.stderr, dir) || reason, runtime: r.ms
                };
            } else {
                result = {
                    status: "success", output: r.stdout, error: tidy(r.stderr, dir),
                    runtime: r.ms, memory: r.memory ?? null
                };
            }
            results.push(result);

            if (options.isFailure && options.isFailure(result, testCase)) break;
        }
        return { results };
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
};

module.exports = { executeCode, checkDocker, runProcess, RUNNER_IMAGE };
