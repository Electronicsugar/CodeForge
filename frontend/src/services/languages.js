import api from './api';

// Used until /problems/languages answers (and if it ever fails).
export const FALLBACK_LANGUAGES = [
  { id: 'cpp', label: 'C++17', monaco: 'cpp', ext: 'cpp' },
  { id: 'python', label: 'Python 3', monaco: 'python', ext: 'py' },
  { id: 'javascript', label: 'JavaScript (Node)', monaco: 'javascript', ext: 'js' },
  { id: 'java', label: 'Java 17+', monaco: 'java', ext: 'java' },
];

const KEY = 'codeforge:language';
let cache = null;

export const getLanguages = async () => {
  if (cache) return cache;
  try {
    const res = await api.get('/problems/languages');
    if (Array.isArray(res.data?.data) && res.data.data.length) cache = res.data.data;
  } catch { /* fall back below */ }
  return cache || FALLBACK_LANGUAGES;
};

export const getPreferredLanguage = () => {
  try { return localStorage.getItem(KEY) || 'cpp'; } catch { return 'cpp'; }
};
export const setPreferredLanguage = (id) => {
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
};

// Stored C++ starter wins for cpp; every other language is generated server-side.
export const starterFor = (problem, language) =>
  problem?.starterCodes?.[language] ?? (language === 'cpp' ? problem?.starterCode : '') ?? '';

export const languageLabel = (languages, id) => languages.find((l) => l.id === id)?.label || id;
export const languageExt = (languages, id) => languages.find((l) => l.id === id)?.ext || 'txt';
export const commentFor = (id) => (id === 'python' ? '# Write your solution here' : '// Write your solution here');
