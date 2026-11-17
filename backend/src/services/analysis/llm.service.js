// Provider-agnostic LLM client (no SDK, just fetch) so any provider works by
// changing environment variables only:
//   LLM_PROVIDER = anthropic | openai          (openai = any OpenAI-compatible API:
//                                               OpenAI, Groq, OpenRouter, Gemini's /openai endpoint, Ollama...)
//   LLM_API_KEY, LLM_MODEL, LLM_BASE_URL (optional), LLM_TIMEOUT_MS (default 25000)
//   LLM_INCLUDE_CODE = true   -> also send the player's last submission (off by default: privacy)
const PROVIDERS = {
    anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-haiku-5-5" },
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" }
};

const settings = (env = process.env) => {
    const provider = (env.LLM_PROVIDER || (env.ANTHROPIC_API_KEY ? "anthropic" : "openai")).toLowerCase();
    const def = PROVIDERS[provider] || PROVIDERS.openai;
    return {
        provider,
        apiKey: env.LLM_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || "",
        model: env.LLM_MODEL || def.model,
        baseUrl: (env.LLM_BASE_URL || def.baseUrl).replace(/\/$/, ""),
        timeoutMs: Number(env.LLM_TIMEOUT_MS) || 25000,
        includeCode: env.LLM_INCLUDE_CODE === "true"
    };
};

const isConfigured = (env = process.env) => Boolean(settings(env).apiKey);

const post = async (url, headers, body, timeoutMs, fetchImpl = fetch) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: controller.signal });
        const text = await res.text();
        if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
        return JSON.parse(text);
    } finally { clearTimeout(timer); }
};

// Returns the raw text of the model's answer.
const complete = async ({ system, user, maxTokens = 900 }, env = process.env, fetchImpl = fetch) => {
    const s = settings(env);
    if (!s.apiKey) throw new Error("LLM not configured");

    if (s.provider === "anthropic") {
        const data = await post(`${s.baseUrl}/v1/messages`,
            { "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" },
            { model: s.model, max_tokens: maxTokens, temperature: 0.3, system, messages: [{ role: "user", content: user }] },
            s.timeoutMs, fetchImpl);
        return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    }
    const data = await post(`${s.baseUrl}/chat/completions`,
        { authorization: `Bearer ${s.apiKey}` },
        { model: s.model, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
        s.timeoutMs, fetchImpl);
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
};

// Models sometimes wrap JSON in ``` fences or add a sentence before it.
const extractJson = (text) => {
    const cleaned = String(text || "").replace(/```json|```/gi, "").trim();
    const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object in LLM output");
    return JSON.parse(cleaned.slice(start, end + 1));
};

const CATEGORIES = ["edge_case", "logic", "complexity", "implementation", "time_management"];
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const list = (v, max, map) => (Array.isArray(v) ? v.slice(0, max).map(map).filter(Boolean) : []);

// Never trust model output: coerce into the exact shape the UI renders.
const validateAnalysis = (raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Analysis is not an object");
    const summary = clip(raw.summary, 600);
    if (!summary) throw new Error("Analysis has no summary");
    return {
        summary,
        mistakes: list(raw.mistakes, 5, (m) => m && m.what ? { category: CATEGORIES.includes(m.category) ? m.category : "logic", what: clip(m.what, 400), evidence: clip(m.evidence, 200) } : null),
        behaviour_insights: list(raw.behaviour_insights, 5, (x) => clip(x, 350) || null),
        strengths: list(raw.strengths, 3, (x) => clip(x, 250) || null),
        improvements: list(raw.improvements, 5, (x) => clip(x, 350) || null),
        recommended_practice: list(raw.recommended_practice, 4, (p) => p && p.tag ? { tag: clip(p.tag, 40), why: clip(p.why, 300) } : null)
    };
};

const SYSTEM = `You are a supportive competitive-programming coach reviewing one player's 1v1 coding battle.
Rules:
- Use ONLY the facts in the JSON you are given. Never invent numbers, events or code.
- Every mistake and behaviour insight must be traceable to a field in the data; put that field in "evidence".
- Be specific, constructive and concise. Never accuse the player of cheating; integrity data may only be mentioned neutrally as warnings that cost them.
- You are given a draft written by a rule engine. Improve its wording and prioritise the most useful points; you may drop weak items but do not add unsupported ones.
- Reply with ONE JSON object and nothing else, with keys: summary (string), mistakes (array of {category, what, evidence}; category in ${CATEGORIES.join("|")}), behaviour_insights (string[]), strengths (string[]), improvements (string[]), recommended_practice (array of {tag, why}).`;

const refineAnalysis = async ({ metrics, draft }, env = process.env, fetchImpl = fetch) => {
    const s = settings(env);
    const { _lastCode, ...facts } = metrics;
    const payload = { facts, draft };
    if (s.includeCode && _lastCode) payload.lastSubmittedCode = String(_lastCode).slice(0, 4000);
    const text = await complete({ system: SYSTEM, user: JSON.stringify(payload), maxTokens: 1000 }, env, fetchImpl);
    return { analysis: validateAnalysis(extractJson(text)), model: `${s.provider}:${s.model}` };
};

const COACH_SYSTEM = `You are a supportive competitive-programming coach. You receive aggregated, deterministic statistics about one player's recent battles and practice. Use ONLY these numbers. Write: a 2-3 sentence "headline" describing the player's pattern, then up to 3 "focus" items (what to work on next, concrete) and up to 2 "strengths". Reply with ONE JSON object: {"headline": string, "focus": string[], "strengths": string[]}. Never mention cheating.`;

const summariseCoach = async ({ stats }, env = process.env, fetchImpl = fetch) => {
    const s = settings(env);
    const text = await complete({ system: COACH_SYSTEM, user: JSON.stringify(stats), maxTokens: 500 }, env, fetchImpl);
    const raw = extractJson(text);
    const headline = clip(raw.headline, 500);
    if (!headline) throw new Error("Coach summary has no headline");
    return {
        narrative: { headline, focus: list(raw.focus, 3, (x) => clip(x, 300) || null), strengths: list(raw.strengths, 2, (x) => clip(x, 250) || null) },
        model: `${s.provider}:${s.model}`
    };
};

module.exports = { settings, isConfigured, complete, extractJson, validateAnalysis, refineAnalysis, summariseCoach };
