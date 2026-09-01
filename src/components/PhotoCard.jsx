import { useState, useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';

export default function PhotoCard({ photo, onClick }) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, []);

  if (photo.isSkeleton) {
    return <div className="photo-card skeleton"></div>;
  }

  return (
    <div className="photo-card" ref={cardRef} onClick={() => onClick(photo)}>
      {isVisible ? (
        <img src={photo.thumbnailDataUrl || photo.url} alt={photo.originalName || "Photo"} />
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.05)' }} />
      )}
      <div className="photo-card-overlay">
        <div style={{ fontSize: '0.85rem', fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'white' }}>
          {photo.originalName}
        </div>
        <Maximize2 size={18} color="white" style={{ opacity: 0.8 }} />
      </div>
    </div>
  );
}
