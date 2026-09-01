import { X, Download, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function InspectorModal({ photo, onClose, onDownload, onDelete, onFetchFullRes }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (photo.file) {
      const url = URL.createObjectURL(photo.file);
      setImageSrc(url);
      setLoading(false);
      return () => URL.revokeObjectURL(url);
    } else {
      // Show thumbnail immediately while fetching full res
      setImageSrc(photo.thumbnailDataUrl);
      
      // Fetch high-res frame from video container
      if (onFetchFullRes) {
        setLoading(true);
        onFetchFullRes(photo).then(fullResUrl => {
          if (fullResUrl) {
            setImageSrc(fullResUrl);
          }
        }).catch(err => {
          console.error('Failed to load high res image', err);
        }).finally(() => {
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    }
  }, [photo, onFetchFullRes]);

  if (!photo) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <X size={24} />
        </button>
        
        <div style={{ padding: '1.5rem', paddingRight: '4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{photo.originalName || 'Photo'}</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn" onClick={() => onDownload(photo)}>
              <Download size={18} />
              Download
            </button>
            <button className="btn icon-btn" onClick={() => window.confirm('Delete photo?') && onDelete && onDelete(photo)} style={{ color: 'var(--danger)' }} title="Delete Photo">
              <Trash2 size={18} />
            </button>
          </div>
        </div>
        
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem', overflow: 'hidden' }}>
          {loading ? (
            <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: '8px' }}></div>
          ) : (
            <img 
              src={imageSrc} 
              alt={photo.originalName} 
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          )}
        </div>
        
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--glass-border)', fontSize: '0.875rem', color: '#94a3b8' }}>
          Dimensions: {photo.width} x {photo.height} &bull; MIME: {photo.mimeType} &bull; Hash: {photo.hash?.substring(0, 8)}...
        </div>
      </div>
    </div>
  );
}
