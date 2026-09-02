import { useState, useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';

export default function PhotoCard({ photo, onClick, onLazyLoad }) {
  const [isVisible, setIsVisible] = useState(false);
  const [objectUrl, setObjectUrl] = useState(null);
  const cardRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (photo.isSkeleton && onLazyLoad) {
            onLazyLoad(photo);
          }
          if (!photo.isSkeleton) {
            observer.disconnect();
          }
        }
      },
      { rootMargin: '200px' }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [photo, onLazyLoad]);

  useEffect(() => {
    if (photo.isSkeleton && photo.file) {
      const url = URL.createObjectURL(photo.file);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [photo.isSkeleton, photo.file]);

  if (photo.isSkeleton) {
    const isUpload = !!photo.file;
    
    return (
      <div className="photo-card skeleton" ref={cardRef}>
        {isUpload && objectUrl && (
           <img 
             src={objectUrl} 
             alt="Uploading..." 
             style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(100%) opacity(0.5)' }} 
           />
        )}
        <div className="skeleton-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}>
          <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '2px', borderTopColor: 'var(--primary, #fff)' }}></div>
          {photo.syncStatus && (
            <div style={{ marginTop: '8px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-color, #fff)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {photo.syncStatus.replace('_', ' ')}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="photo-card" ref={cardRef} onClick={() => onClick(photo)}>
      {isVisible ? (
        <>
          <img 
            src={photo.thumbnailDataUrl || photo.url} 
            alt={photo.originalName || "Photo"} 
            loading="lazy"
            decoding="async"
          />
          {photo.syncStatus === 'failed' && (
            <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'var(--danger)', color: 'white', borderRadius: '50%', padding: '4px', zIndex: 10 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
          )}
          {photo.syncStatus === 'pending' && (
            <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.5)', color: 'white', borderRadius: '50%', padding: '4px', zIndex: 10 }}>
              <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderTopColor: 'white' }}></div>
            </div>
          )}
        </>
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.05)' }} />
      )}
      <div className="photo-card-overlay">
        <div style={{ fontSize: '0.85rem', fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'white' }}>
          {photo.originalName || photo.filename}
        </div>
        <Maximize2 size={18} color="white" style={{ opacity: 0.8 }} />
      </div>
    </div>
  );
}
