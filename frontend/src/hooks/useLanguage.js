import { useEffect, useState, useCallback } from 'react';
import { FALLBACK_LANGUAGES, getLanguages, getPreferredLanguage, setPreferredLanguage } from '../services/languages';

// Language the editor is writing in, remembered across problems and sessions.
export function useLanguage() {
  const [languages, setLanguages] = useState(FALLBACK_LANGUAGES);
  const [language, setLang] = useState(getPreferredLanguage);

  useEffect(() => {
    let alive = true;
    getLanguages().then((list) => {
      if (!alive) return;
      setLanguages(list);
      setLang((current) => (list.some((l) => l.id === current) ? current : list[0].id));
    });
    return () => { alive = false; };
  }, []);

  const setLanguage = useCallback((id) => { setPreferredLanguage(id); setLang(id); }, []);
  return { language, setLanguage, languages };
}
