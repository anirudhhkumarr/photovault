import { Cloud, CheckCircle, Loader, LogOut, RefreshCw } from 'lucide-react';

export default function Header({ profile, onConnect, onDisconnect, onSync, queueIdle, totalSavedBytes }) {
  const savedMb = (totalSavedBytes / (1024 * 1024)).toFixed(2);
  
  return (
    <header className="header glass">
      <div className="header-brand">PhotoVault</div>
      
      <div className="header-actions">
        {totalSavedBytes > 0 && (
          <div style={{ fontSize: '0.875rem', color: 'var(--success)' }}>
            Saved: {savedMb} MB
          </div>
        )}
        
        {!queueIdle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
            <Loader size={16} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '0.875rem' }}>Syncing...</span>
          </div>
        )}
        
        {profile ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="btn icon-btn" onClick={onSync} disabled={!queueIdle} style={{ padding: '0.5rem' }} title="Sync with Drive">
              <RefreshCw size={16} />
            </button>
            <img 
              src={profile.picture} 
              alt="Profile" 
              style={{ width: 32, height: 32, borderRadius: '50%' }} 
            />
            <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{profile.name}</span>
            <button className="btn icon-btn" onClick={onDisconnect} style={{ padding: '0.5rem', marginLeft: '0.5rem' }} title="Sign Out">
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <button className="btn" onClick={onConnect}>
            <Cloud size={18} />
            Connect Drive
          </button>
        )}
      </div>
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </header>
  );
}
