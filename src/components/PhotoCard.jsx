import { Maximize2 } from 'lucide-react';

export default function PhotoCard({ photo, onClick }) {
  if (photo.isSkeleton) {
    return <div className="photo-card skeleton"></div>;
  }

  return (
    <div className="photo-card" onClick={() => onClick(photo)}>
      <img src={photo.thumbnailDataUrl || photo.url} alt={photo.originalName || "Photo"} />
      <div className="photo-card-overlay">
        <div style={{ fontSize: '0.85rem', fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'white' }}>
          {photo.originalName}
        </div>
        <Maximize2 size={18} color="white" style={{ opacity: 0.8 }} />
      </div>
    </div>
  );
}
