import React from 'react';
import { Image as ImageIcon, X, Eye, Download } from 'lucide-react';

export function PhotoGrid({ photos, onInspect, onDownload, onDelete }) {
  if (photos.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center text-center p-6" style={{ height: '320px', margin: '20px 0' }}>
        <ImageIcon size={48} color="var(--text-secondary)" className="mb-4" />
        <h3 className="text-title" style={{ fontSize: '20px' }}>No photos in library</h3>
        <p className="text-subtitle mt-2">Add photos or folders to start building your vault.</p>
      </div>
    );
  }

  return (
    <div className="photo-grid">
      {photos.map(photo => (
        <div 
          key={photo.id} 
          className="photo-item animate-fade-in" 
          onClick={() => onInspect(photo)} 
          style={{ cursor: 'pointer' }}
        >
          {photo.thumbnail ? (
            <img src={photo.thumbnail} alt={photo.filename} />
          ) : (
            <div className="flex items-center justify-center w-full" style={{ height: '100%', background: 'rgba(0,0,0,0.05)' }}>
              <ImageIcon size={32} color="var(--text-secondary)" />
            </div>
          )}

          {/* Hover Actions & Info */}
          <div className="photo-overlay flex-col justify-between" style={{ padding: '12px' }}>
            <div className="flex justify-between w-full">
              <div className="flex gap-2">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspect(photo);
                  }}
                  className="btn btn-secondary"
                  style={{ padding: '6px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.9)', color: '#1d1d1f' }}
                  title="View photo"
                >
                  <Eye size={14} />
                </button>
                {onDownload && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(photo);
                    }}
                    className="btn btn-secondary"
                    style={{ padding: '6px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.9)', color: '#1d1d1f' }}
                    title="Download original"
                  >
                    <Download size={14} />
                  </button>
                )}
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(photo.id);
                }} 
                className="btn btn-danger"
                style={{ padding: '6px', borderRadius: '50%', background: 'rgba(255, 59, 48, 0.9)', color: 'white' }}
                title="Delete photo"
              >
                <X size={14} />
              </button>
            </div>

            <div className="text-center w-full" style={{ background: 'rgba(0,0,0,0.7)', padding: '6px 8px', borderRadius: '8px' }}>
              <div style={{ color: 'white', fontWeight: 500, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {photo.filename}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '10px' }}>
                {(photo.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
