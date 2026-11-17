import './LanguageSelect.css';

export default function LanguageSelect({ language, languages, onChange, disabled }) {
  return (
    <label className="lang-select">
      <span className="lang-select__label">Language</span>
      <select
        className="lang-select__control"
        value={language}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Programming language"
      >
        {languages.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </label>
  );
}
