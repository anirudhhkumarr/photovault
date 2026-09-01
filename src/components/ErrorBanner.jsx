import { AlertTriangle, X } from 'lucide-react';

export default function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;

  return (
    <div className="error-banner glass">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <AlertTriangle size={20} color="var(--danger)" />
        <span style={{ fontWeight: 500 }}>{error.message || String(error)}</span>
      </div>
      <button data-testid="close-error" onClick={onDismiss} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>
        <X size={20} />
      </button>
    </div>
  );
}
