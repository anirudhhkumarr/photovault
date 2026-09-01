import { useState, useRef } from 'react';
import PhotoCard from './PhotoCard';
import { Upload } from 'lucide-react';

export default function PhotoGrid({ photos, onFilesAdded, onPhotoClick, onLazyLoad }) {
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
        <div className="dropzone-empty">
          <Upload size={56} style={{ marginBottom: '1.5rem', color: 'var(--primary)' }} strokeWidth={1.5} />
          <h3>Drag & Drop Photos Here</h3>
          <p>or click below to browse your library</p>
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
            <PhotoCard key={photo.id || `temp-${idx}`} photo={photo} onClick={onPhotoClick} onLazyLoad={onLazyLoad} />
          ))}
        </div>
      )}
    </div>
  );
}
