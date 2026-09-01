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
        border: isDragging ? '2px dashed var(--primary)' : '1px solid var(--glass-border)',
        backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
        boxShadow: isDragging ? '0 0 40px rgba(59, 130, 246, 0.2)' : 'none',
        transition: 'all 0.3s ease'
      }}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {photos.length === 0 ? (
        <div className="dropzone-empty" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%'
        }}>
          <Upload size={64} style={{ 
            marginBottom: '1.5rem', 
            color: 'var(--primary)',
            animation: 'bounce 2s infinite ease-in-out',
            filter: 'drop-shadow(0 0 10px rgba(59, 130, 246, 0.5))'
          }} strokeWidth={1.5} />
          <h3 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>Drag & Drop Photos Here</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>or click below to browse your library</p>
          <button className="btn" style={{ padding: '0.8rem 2rem', fontSize: '1rem', borderRadius: '999px', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.4)' }} onClick={() => fileInputRef.current?.click()}>Select Files</button>
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
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-15px); }
        }
      `}</style>
    </div>
  );
}
