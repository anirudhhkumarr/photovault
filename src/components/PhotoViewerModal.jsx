import React, { useEffect } from 'react';
import { X, Download } from 'lucide-react';

export function PhotoViewerModal({ photo, fullPhotoUrl, onDownload, onClose }) {
  // Prevent body scrolling when modal is open
  useEffect(() => {
    if (photo) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [photo]);

  if (!photo) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Floating Header */}
        <div 
          className="flex justify-between items-center w-full"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '24px 32px',
            zIndex: 10,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)'
          }}
        >
          <div style={{ color: 'white', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>{photo.filename}</h3>
            {photo.size && (
              <span style={{ fontSize: '13px', opacity: 0.8 }}>{(photo.size / 1024 / 1024).toFixed(2)} MB</span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {onDownload && (
              <button 
                className="btn"
                onClick={() => onDownload(photo)} 
                style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(10px)',
                  color: 'white',
                  padding: '8px 16px'
                }}
              >
                <Download size={16} strokeWidth={2} /> Download
              </button>
            )}
            <button 
              className="btn btn-icon"
              onClick={onClose} 
              style={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(10px)',
                color: 'white',
                padding: '8px' 
              }}
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Image Container (Edge-to-Edge) */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px' }}>
          {fullPhotoUrl ? (
            <img 
              src={fullPhotoUrl} 
              alt={photo.filename} 
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }} 
            />
          ) : (
            <div className="flex items-center gap-3" style={{ color: 'white' }}>
              <div className="spinner"></div>
              <span style={{ fontSize: '15px', fontWeight: 500 }}>Loading full resolution...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
