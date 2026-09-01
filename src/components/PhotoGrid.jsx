import { useState, useRef } from 'react';
import PhotoCard from './PhotoCard';
import { Upload } from 'lucide-react';

export default function PhotoGrid({ photos, onFilesAdded, onPhotoClick }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesAdded(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesAdded(Array.from(e.target.files));
    }
    // Reset input so the same files can be selected again if needed
    e.target.value = '';
  };

  return (
    <div 
      className="glass"
      style={{
        padding: '2rem', 
        minHeight: '60vh',
        border: isDragging ? '2px dashed var(--primary)' : '1px solid var(--glass-border)'
      }}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {photos.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.7 }}>
          <Upload size={48} style={{ marginBottom: '1rem' }} />
          <h3>Drag & Drop Photos Here</h3>
          <p style={{ marginTop: '0.5rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>or click below to browse</p>
          <button className="btn" onClick={() => fileInputRef.current?.click()}>Select Files</button>
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            multiple 
            accept="image/*"
            onChange={handleFileSelect}
          />
        </div>
      ) : (
        <div className="photo-grid">
          {photos.map((photo, idx) => (
            <PhotoCard key={photo.id || `temp-${idx}`} photo={photo} onClick={onPhotoClick} />
          ))}
        </div>
      )}
    </div>
  );
}
