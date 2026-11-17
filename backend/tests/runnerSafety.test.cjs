const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');

function check(extraEnv, expected) {
    const script = `const assert=require('node:assert/strict'); const {checkDocker}=require('./src/services/executor/runner'); assert.rejects(checkDocker, ${expected}).catch(e=>{console.error(e);process.exitCode=1});`;
    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: path.join(__dirname, '..'),
        env: {...process.env, NODE_ENV: 'production', FORCE_DIRECT_EXECUTION: '', ...extraEnv},
        encoding: 'utf8', timeout: 20000, windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test('production refuses forced execution of submitted code on the host', () => {
    check({FORCE_DIRECT_EXECUTION: 'true'}, '/Direct execution is disabled in production/');
});

test('missing Docker runner never silently falls back to host execution', () => {
    check({RUNNER_IMAGE: 'codeforge-integration-missing-image:never'}, '/Docker or image .* unavailable/');
});
