const { executeCode } = require("./runner");
const { getLanguage } = require("./languages");

// Returns an executor: (code, testCases, options?) => Promise<{results}>
const getExecutor = (language) => {
    getLanguage(language); // throws a 400-style error for unknown languages
    return (code, testCases, options) => executeCode(language, code, testCases, options);
};

module.exports = {
    getExecutor
};
