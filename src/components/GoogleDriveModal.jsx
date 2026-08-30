import React from 'react';
import { Cloud, CheckCircle, X, LogOut, ExternalLink } from 'lucide-react';

export function GoogleDriveModal({ 
  isOpen, 
  onClose, 
  userProfile, 
  onSignIn, 
  onSignOut 
}) {
  if (!isOpen) return null;

  return (
    <div 
      className="modal-overlay animate-fade-in"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(10px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div 
        className="card"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '32px',
          borderRadius: '24px',
          boxShadow: 'var(--shadow-lg)'
        }}
      >
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: 'rgba(0, 113, 227, 0.1)',
              color: 'var(--accent-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Cloud size={22} />
            </div>
            <div>
              <h3 className="text-title" style={{ fontSize: '18px', margin: 0 }}>Google Drive</h3>
              <p className="text-caption" style={{ margin: 0 }}>Cloud backup and syncing</p>
            </div>
          </div>
          <button 
            className="btn btn-secondary" 
            style={{ borderRadius: '50%', width: '36px', height: '36px', padding: 0 }}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {userProfile ? (
          <div>
            <div className="card p-4 mb-6 flex items-center gap-4" style={{ backgroundColor: 'rgba(52, 199, 89, 0.08)', border: '1px solid rgba(52, 199, 89, 0.2)' }}>
              {userProfile.picture ? (
                <img 
                  src={userProfile.picture} 
                  alt={userProfile.name} 
                  style={{ width: '48px', height: '48px', borderRadius: '50%' }}
                />
              ) : (
                <CheckCircle size={32} color="var(--success-color)" />
              )}
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>{userProfile.name || 'Connected'}</div>
                <div className="text-caption">{userProfile.email}</div>
                <div style={{ color: 'var(--success-color)', fontSize: '12px', fontWeight: 600, marginTop: '2px' }}>
                  ✓ Connected to Google Drive
                </div>
              </div>
            </div>

            <p className="text-caption mb-6">
              Photos are automatically synced to the <strong>Photo Vault</strong> folder in your Google Drive.
            </p>

            <div className="flex gap-3">
              <a 
                href="https://drive.google.com" 
                target="_blank" 
                rel="noreferrer"
                className="btn btn-secondary flex-1"
                style={{ justifyContent: 'center' }}
              >
                <ExternalLink size={16} /> Open Drive
              </a>
              <button 
                className="btn btn-secondary" 
                style={{ color: '#ff3b30' }}
                onClick={onSignOut}
              >
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-subtitle" style={{ fontSize: '14px', lineHeight: 1.4, margin: 0 }}>
              Sign in with your Google account to automatically back up and sync your photo library with Google Drive.
            </p>

            <button 
              className="btn btn-primary w-full" 
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '14px 0',
                fontSize: '15px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginTop: '4px'
              }}
              onClick={onSignIn}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
              Sign in with Google
            </button>

            <div style={{ textAlign: 'center', marginTop: '4px' }}>
              <a 
                href="https://drive.google.com" 
                target="_blank" 
                rel="noreferrer"
                className="text-caption"
                style={{ color: 'var(--accent-color)', textDecoration: 'none', fontSize: '12px' }}
              >
                Open Google Drive in browser &rarr;
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
