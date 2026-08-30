import React from 'react';
import { X, Download } from 'lucide-react';

export function PhotoViewerModal({ photo, fullPhotoUrl, onDownload, onClose }) {
  if (!photo) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(20px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
      onClick={onClose}
    >
      <div 
        className="card" 
        style={{ 
          maxWidth: '92vw', 
          maxHeight: '90vh', 
          padding: '20px', 
          background: 'var(--card-bg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderRadius: '20px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center w-full mb-3">
          <div>
            <h3 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>{photo.filename}</h3>
            {photo.size && (
              <span className="text-caption">{(photo.size / 1024 / 1024).toFixed(2)} MB</span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {onDownload && (
              <button 
                className="btn btn-primary" 
                onClick={() => onDownload(photo)} 
                style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Download size={15} /> Download Original
              </button>
            )}
            <button 
              className="btn btn-secondary" 
              onClick={onClose} 
              style={{ padding: '8px', borderRadius: '50%', width: '36px', height: '36px' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
          {fullPhotoUrl ? (
            <img 
              src={fullPhotoUrl} 
              alt={photo.filename} 
              style={{ maxWidth: '100%', maxHeight: '72vh', borderRadius: '12px', objectFit: 'contain' }} 
            />
          ) : (
            <div className="flex items-center gap-3">
              <div className="spinner" style={{ borderTopColor: 'var(--accent-color)' }}></div>
              <span className="text-caption">Loading full resolution photo...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
