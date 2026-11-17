// Pure anti-cheat rules (no I/O) so they can be unit-tested exhaustively.
//
// Client-side detection can always be bypassed, so this is a deterrent backed
// by server-side checks the client cannot fake:
//   * focus time is measured by the SERVER (client-reported durations are only logged)
//   * code growth between two syncs is compared with the paste/insert events the
//     client reported - a big jump with no matching event means the client hooks
//     were bypassed or disabled ("unreported_jump")
//
// Nothing here punishes on a single ambiguous signal: short focus losses and
// small pastes are logged but free, simultaneous tab_hidden+window_blur count as
// ONE strike, and enforcement can be switched to monitor-only.

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const config = (env = process.env) => ({
    mode: env.ANTICHEAT_MODE === "enforce" ? "enforce" : "monitor",
    forfeitStrikes: num(env.ANTICHEAT_FORFEIT_STRIKES, 3),   // 0 disables forfeits
    tabAwayMinMs: num(env.ANTICHEAT_TAB_AWAY_MS, 3000),      // shorter absences are free
    pasteMinChars: num(env.ANTICHEAT_PASTE_MIN_CHARS, 25),   // smaller pastes are free
    largeInsertChars: num(env.ANTICHEAT_LARGE_INSERT_CHARS, 80),
    jumpChars: num(env.ANTICHEAT_JUMP_CHARS, 150),
    maxCharsPerSec: num(env.ANTICHEAT_MAX_CPS, 20),         // generous: fast typists reach ~10
    reportGraceMs: 4000,                                    // paste event may arrive just after the sync
    strikeCooldownMs: 2500,
    maxEvents: 300,
    eventsPerMinute: 90
});

// Events the client may send. Anything else is rejected.
const EVENT_TYPES = [
    "tab_hidden", "tab_visible", "window_blur", "window_focus",
    "paste", "copy", "cut", "large_insert", "context_menu", "fullscreen_exit"
];

const newState = () => ({
    monitorOnly: true,
    strikes: 0,
    lastStrikeAt: 0,
    hiddenSince: null,       // tab hidden
    blurSince: null,         // window lost focus (tab still visible)
    lastSync: null,          // { length, at, language }
    lastReportedInsertAt: 0, // last paste / large_insert the client told us about
    recent: [],              // timestamps for flood control
    counts: { tabSwitches: 0, windowBlurs: 0, pastes: 0, pastedChars: 0, smallPastes: 0,
              copies: 0, largeInserts: 0, unreportedJumps: 0, submitWithoutSync: 0 },
    awayMs: 0,
    flags: []
});

const cloneState = (s) => ({ ...s, recent: [...s.recent], flags: [...s.flags], counts: { ...s.counts },
    lastSync: s.lastSync ? { ...s.lastSync } : null });

// Awards a strike unless one was just given (tab_hidden and window_blur arrive
// together when switching tabs; that is one act, not two).
const strike = (state, reason, now, cfg) => {
    if (cfg.mode === 'monitor') {
        state.monitorOnly = true;
        return { awarded: false, reason };
    }
    state.monitorOnly = false;
    if (state.lastStrikeAt && now - state.lastStrikeAt < cfg.strikeCooldownMs) {
        return { awarded: false, reason };
    }
    state.strikes += 1;
    state.lastStrikeAt = now;
    return { awarded: true, reason };
};

const decide = (state, struck, cfg) => {
    if (!struck.awarded) return "none";
    if (cfg.mode === "enforce" && cfg.forfeitStrikes > 0 && state.strikes >= cfg.forfeitStrikes) return "forfeit";
    return "warn";
};

const absence = (state, key, now, cfg, label) => {
    const since = state[key];
    state[key] = null;
    if (since == null) return null;
    const away = Math.max(0, now - since);
    state.awayMs += away;
    return away >= cfg.tabAwayMinMs ? { reason: label, away } : { reason: null, away };
};

/**
 * Applies one client event. Returns { state, record, strike, action }.
 *  record : what to persist (or null when the event is ignored)
 *  strike : { awarded, reason } | null
 *  action : "none" | "warn" | "forfeit"
 */
const applyEvent = (prev, event, now, cfg = config()) => {
    const state = cloneState(prev);
    const type = event && event.type;
    if (!EVENT_TYPES.includes(type)) return { state, record: null, strike: null, action: "none", rejected: "unknown_event" };

    // flood control: a script spamming events must not bloat storage
    state.recent = state.recent.filter((t) => now - t < 60000);
    if (state.recent.length >= cfg.eventsPerMinute) return { state, record: null, strike: null, action: "none", rejected: "rate_limited" };
    state.recent.push(now);

    const meta = {};
    let struck = null;

    switch (type) {
        case "tab_hidden":
            if (state.hiddenSince == null) { state.hiddenSince = now; state.counts.tabSwitches += 1; }
            break;
        case "tab_visible": {
            const a = absence(state, "hiddenSince", now, cfg, "tab_switch");
            state.blurSince = null; // visibility return implies focus return
            if (a) { meta.awayMs = a.away; if (a.reason) struck = strike(state, a.reason, now, cfg); }
            if (Number.isFinite(Number(event.meta && event.meta.awayMs))) meta.clientAwayMs = Number(event.meta.awayMs);
            break;
        }
        case "window_blur":
            if (state.hiddenSince == null && state.blurSince == null) { state.blurSince = now; state.counts.windowBlurs += 1; }
            break;
        case "window_focus": {
            if (state.hiddenSince != null) break; // tab_visible will account for it
            const a = absence(state, "blurSince", now, cfg, "window_blur");
            if (a) { meta.awayMs = a.away; if (a.reason) struck = strike(state, a.reason, now, cfg); }
            break;
        }
        case "paste": {
            const len = Math.max(0, Math.min(1e6, Math.floor(num(event.meta && event.meta.length, 0))));
            meta.length = len;
            state.counts.pastes += 1; state.counts.pastedChars += len;
            state.lastReportedInsertAt = now;
            if (len >= cfg.pasteMinChars) struck = strike(state, "paste", now, cfg);
            else state.counts.smallPastes += 1;
            break;
        }
        case "large_insert": {
            const len = Math.max(0, Math.min(1e6, Math.floor(num(event.meta && event.meta.length, 0))));
            meta.length = len;
            state.lastReportedInsertAt = now;
            state.counts.largeInserts += 1;
            if (len >= cfg.largeInsertChars) struck = strike(state, "large_insert", now, cfg);
            break;
        }
        case "copy": case "cut":
            state.counts.copies += 1; // copying the statement out is logged, never punished
            meta.length = Math.max(0, Math.min(1e6, Math.floor(num(event.meta && event.meta.length, 0))));
            break;
        default:
            break; // context_menu, fullscreen_exit: logged only
    }

    return { state, record: { type, at: now, meta }, strike: struck, action: struck ? decide(state, struck, cfg) : "none" };
};

/**
 * Server-side check on every code_sync. `codeLength` is what the client claims
 * the editor currently holds; the growth since the previous sync must be
 * explained by typing speed or by a paste/insert the client reported.
 */
const applySync = (prev, { codeLength, language }, now, cfg = config()) => {
    const state = cloneState(prev);
    const length = Math.max(0, Math.floor(num(codeLength, 0)));
    const last = state.lastSync;
    state.lastSync = { length, at: now, language: language || (last && last.language) || null };

    // baseline: first sync, or the language changed (starter code is swapped in)
    if (!last || (language && last.language && language !== last.language)) {
        return { state, record: null, strike: null, action: "none" };
    }

    const growth = length - last.length;
    const elapsed = now - last.at;
    const explained = state.lastReportedInsertAt && Math.abs(now - state.lastReportedInsertAt) <= cfg.reportGraceMs + elapsed;

    // growth that typing could not plausibly produce in the time elapsed
    const plausible = (Math.max(0, elapsed) / 1000) * cfg.maxCharsPerSec + 40;
    if (growth >= cfg.jumpChars && growth > plausible && !explained) {
        state.counts.unreportedJumps += 1;
        state.flags.push("unreported_jump");
        const struck = strike(state, "unreported_jump", now, cfg);
        return { state, record: { type: "unreported_jump", at: now, meta: { growth, elapsedMs: elapsed } }, strike: struck, action: decide(state, struck, cfg) };
    }
    return { state, record: null, strike: null, action: "none" };
};

/** At submit time: does the submitted code match what the server saw being typed? */
const checkSubmit = (prev, { codeLength }, now, cfg = config()) => {
    const state = cloneState(prev);
    const length = Math.max(0, Math.floor(num(codeLength, 0)));
    const last = state.lastSync;
    // No sync at all, or a large unexplained difference since the last one.
    // Flag only (never a strike): sockets reconnect and debounce, so this is weak evidence alone.
    const stale = !last || (Math.abs(length - last.length) > 300 && now - last.at > 2000);
    if (stale) {
        state.counts.submitWithoutSync += 1;
        state.flags.push("submit_without_sync");
        return { state, record: { type: "submit_without_sync", at: now, meta: { submitted: length, lastSynced: last ? last.length : null } }, strike: null, action: "none" };
    }
    return { state, record: null, strike: null, action: "none" };
};

/** Close open intervals when the battle ends so a player who left the tab for good is still measured. */
const finalize = (prev, now) => {
    const state = cloneState(prev);
    for (const key of ["hiddenSince", "blurSince"]) {
        if (state[key] != null) { state.awayMs += Math.max(0, now - state[key]); state[key] = null; }
    }
    return state;
};

const summarize = (state) => {
    const c = state.counts;
    if (state.monitorOnly) return { strikes: 0, score: null, label: 'recorded', awayMs: state.awayMs, counts: { ...c }, flags: [...new Set(state.flags)] };
    const score = Math.max(0, 100 - state.strikes * 20 - c.unreportedJumps * 15 - c.submitWithoutSync * 5 - Math.min(10, c.smallPastes * 2));
    const label = state.strikes === 0 && c.unreportedJumps === 0 ? (score >= 90 ? "clean" : "minor")
        : state.strikes >= 3 || c.unreportedJumps >= 2 ? "flagged" : "suspicious";
    return { strikes: state.strikes, score, label, awayMs: state.awayMs, counts: { ...c }, flags: [...new Set(state.flags)] };
};

const WARNING_TEXT = {
    tab_switch: "You left the battle tab.",
    window_blur: "The battle window lost focus.",
    paste: "A large paste was detected.",
    large_insert: "A large block of code appeared at once.",
    unreported_jump: "A large block of code appeared without typing."
};

module.exports = { config, EVENT_TYPES, newState, applyEvent, applySync, checkSubmit, finalize, summarize, WARNING_TEXT };
