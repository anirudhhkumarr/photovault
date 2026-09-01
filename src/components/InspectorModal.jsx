import { X, Download } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function InspectorModal({ photo, onClose, onDownload }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real implementation, we would extract the full-res frame from the video container here.
    // For now, we will just use the thumbnail or an object URL if available.
    if (photo.file) {
      const url = URL.createObjectURL(photo.file);
      setImageSrc(url);
      setLoading(false);
      return () => URL.revokeObjectURL(url);
    } else {
      setImageSrc(photo.thumbnailDataUrl);
      setLoading(false);
    }
  }, [photo]);

  if (!photo) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <X size={24} />
        </button>
        
        <div style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{photo.originalName || 'Photo'}</h2>
          <button className="btn" onClick={() => onDownload(photo)}>
            <Download size={18} />
            Download Original
          </button>
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
