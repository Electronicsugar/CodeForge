// Kept for backwards compatibility (seed scripts import executeCpp).
// All the real work now lives in the language-agnostic runner.
const { executeCode } = require("./runner");

const executeCpp = (code, testCases, options) => executeCode("cpp", code, testCases, options);

module.exports = { executeCpp };
