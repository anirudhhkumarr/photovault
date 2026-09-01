export default function PhotoCard({ photo, onClick }) {
  if (photo.isSkeleton) {
    return <div className="photo-card skeleton"></div>;
  }

  return (
    <div className="photo-card" onClick={() => onClick(photo)}>
      <img src={photo.thumbnailDataUrl || photo.url} alt={photo.originalName || "Photo"} />
      <div className="photo-card-overlay">
        <div style={{ fontSize: '0.75rem', fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {photo.originalName}
        </div>
      </div>
    </div>
  );
}
