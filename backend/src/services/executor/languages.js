// Single source of truth for supported languages. The judge, the submission
// validator, the starter-code generator and (via /problems/languages) the
// frontend language picker all read from here.
//
// `files`   : name of the source file written into the sandbox directory
// `compile` : optional compile / syntax-check step, run once per submission
// `run`     : command used for every test case
// `timeMs`  : per-test wall-clock limit (interpreted/JIT languages get more)
// `memMb`   : memory limit used in Docker mode
const LANGUAGES = {
    cpp: {
        id: "cpp", label: "C++17", monaco: "cpp", ext: "cpp", file: "main.cpp",
        compile: ["g++", "-O2", "-std=c++17", "-Werror=return-type", "main.cpp", "-o", "main"],
        run: ["./main"],
        timeMs: 2000, memMb: 256, compileTimeMs: 15000,
        // ulimit -v (KB) applied in direct mode. Runtimes that reserve huge
        // virtual ranges (JVM, V8) are limited via their own flags instead.
        virtualKb: 1024 * 1024
    },
    python: {
        id: "python", label: "Python 3", monaco: "python", ext: "py", file: "main.py",
        compile: ["python3", "-m", "py_compile", "main.py"],
        run: ["python3", "main.py"],
        timeMs: 6000, memMb: 256, compileTimeMs: 10000,
        virtualKb: 1536 * 1024
    },
    javascript: {
        id: "javascript", label: "JavaScript (Node)", monaco: "javascript", ext: "js", file: "main.js",
        compile: ["node", "--check", "main.js"],
        run: ["node", "--max-old-space-size=192", "main.js"],
        timeMs: 4000, memMb: 384, compileTimeMs: 10000,
        virtualKb: null
    },
    java: {
        id: "java", label: "Java 17+", monaco: "java", ext: "java", file: "Main.java",
        compile: ["javac", "-J-Xmx256m", "-d", ".", "Main.java"],
        run: ["java", "-Xmx192m", "-Xss64m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "Main"],
        timeMs: 5000, memMb: 512, compileTimeMs: 25000,
        virtualKb: null
    }
};

const SUPPORTED = Object.keys(LANGUAGES);

const isSupported = (language) =>
    typeof language === "string" && Object.prototype.hasOwnProperty.call(LANGUAGES, language);

const getLanguage = (language) => {
    if (!isSupported(language)) {
        throw Object.assign(
            new Error(`Unsupported language: ${language}. Supported: ${SUPPORTED.join(", ")}`),
            { status: 400 }
        );
    }
    return LANGUAGES[language];
};

// Public, serialisable view for the frontend (no commands).
const publicLanguages = () =>
    SUPPORTED.map((id) => {
        const { label, monaco, ext } = LANGUAGES[id];
        return { id, label, monaco, ext };
    });

module.exports = { LANGUAGES, SUPPORTED, isSupported, getLanguage, publicLanguages };
