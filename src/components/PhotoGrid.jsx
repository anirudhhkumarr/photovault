import React from 'react';
import { Image as ImageIcon, X, Eye, Download } from 'lucide-react';

export function PhotoGrid({ photos, onInspect, onDownload, onDelete, isLoadingData }) {
  if (photos.length === 0 && !isLoadingData) {
    return (
      <div className="card flex flex-col items-center justify-center text-center p-6" style={{ height: '360px', margin: '32px 0' }}>
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '24px',
          backgroundColor: 'rgba(134, 134, 139, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '20px'
        }}>
          <ImageIcon size={40} color="var(--text-secondary)" strokeWidth={1.5} />
        </div>
        <h3 className="text-title" style={{ fontSize: '22px' }}>No photos in library</h3>
          <p className="text-subtitle" style={{ maxWidth: '300px', margin: '0 auto' }}>
            Add photos or entire folders to start building your library.
          </p>
      </div>
    );
  }

  return (
    <div className="photo-grid">
      {photos.map((photo, index) => {
        if (!photo) {
          return (
            <div key={`skeleton-${index}`} className="photo-item skeleton-box" style={{ background: 'var(--bg-secondary)', animation: 'pulse 1.5s infinite ease-in-out' }}>
              <div className="flex items-center justify-center w-full" style={{ height: '100%', opacity: 0.2 }}>
                <ImageIcon size={32} color="var(--text-secondary)" strokeWidth={1.5} />
              </div>
            </div>
          );
        }
        
        return (
          <div 
            key={photo.id} 
            className="photo-item animate-fade-in" 
            onClick={() => onInspect(photo)}
          >
          {photo.thumbnail ? (
            <img src={photo.thumbnail} alt={photo.filename} loading="lazy" style={{ opacity: photo.isUploading ? 0.6 : 1, transition: 'opacity 0.2s' }} />
          ) : (
            <div className="flex items-center justify-center w-full" style={{ height: '100%', background: 'rgba(0,0,0,0.05)' }}>
              <ImageIcon size={32} color="var(--text-secondary)" strokeWidth={1.5} />
            </div>
          )}

          {/* Hover Actions & Info using the new pill design */}
          <div className="photo-overlay flex-col justify-between">
            {photo.isUploading ? (
              <div className="flex flex-col items-center justify-center w-full h-full gap-2 mt-4">
                <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '2px', borderTopColor: 'white' }}></div>
                <span style={{ color: 'white', fontWeight: 600, fontSize: '13px', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Processing...</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between w-full">
                  <div className="photo-actions">
                    <button 
                      onClick={(e) => { e.stopPropagation(); onInspect(photo); }}
                      className="photo-action-btn"
                      title="View full screen"
                    >
                      <Eye size={16} strokeWidth={2} />
                    </button>
                    {onDownload && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onDownload(photo); }}
                        className="photo-action-btn"
                        title="Download original"
                      >
                        <Download size={16} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                  <div className="photo-actions">
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDelete(photo.id); }} 
                      className="photo-action-btn danger"
                      title="Delete photo"
                    >
                      <X size={16} strokeWidth={2} />
                    </button>
                  </div>
                </div>

                <div className="flex-col w-full" style={{ marginTop: 'auto' }}>
                  <div style={{ color: 'white', fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
                    {photo.filename}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: '11px', fontWeight: 500, textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
                    {(photo.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}
      
      {isLoadingData && !photos.length && Array.from({ length: 10 }).map((_, i) => (
        <div key={`initial-skeleton-${i}`} className="photo-item skeleton-box" style={{ background: 'var(--bg-secondary)', animation: 'pulse 1.5s infinite ease-in-out' }}>
          <div className="flex items-center justify-center w-full" style={{ height: '100%', opacity: 0.2 }}>
            <ImageIcon size={32} color="var(--text-secondary)" strokeWidth={1.5} />
          </div>
        </div>
      ))}
    </div>
  );
}
