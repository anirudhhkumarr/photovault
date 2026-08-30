import React from 'react';
import { Upload, FolderUp, Trash2, Download, Cloud } from 'lucide-react';

export function Header({ 
  isProcessing, 
  hasItems, 
  googleUser,
  onOpenGoogleModal,
  onClear, 
  onUpload, 
  onUploadFolder,
  onExportAll 
}) {
  return (
    <div className="flex justify-between items-center mb-8">
      <div>
        <h1 className="text-title" style={{ fontSize: '24px', letterSpacing: '-0.02em', margin: 0 }}>
          PhotoVault
        </h1>
        {googleUser && (
          <p className="text-caption" style={{ marginTop: '2px', color: 'var(--success-color)' }}>
            Google Drive: {googleUser.email}
          </p>
        )}
      </div>

      <div className="flex gap-3 items-center">
        {/* Google Drive Status / Connect Button */}
        <button 
          className="btn btn-secondary"
          onClick={onOpenGoogleModal}
          disabled={isProcessing}
          style={{
            borderColor: googleUser ? 'rgba(52, 199, 89, 0.4)' : 'var(--border-color)',
            background: googleUser ? 'rgba(52, 199, 89, 0.08)' : 'var(--card-bg)'
          }}
        >
          <Cloud size={16} color={googleUser ? 'var(--success-color)' : 'var(--text-secondary)'} />
          {googleUser ? 'Google Drive' : 'Google Drive'}
        </button>

        {hasItems && onExportAll && (
          <button 
            className="btn btn-secondary" 
            onClick={onExportAll} 
            disabled={isProcessing}
          >
            <Download size={16} /> Export
          </button>
        )}

        {hasItems && (
          <button 
            className="btn btn-secondary" 
            onClick={onClear} 
            disabled={isProcessing}
          >
            <Trash2 size={16} /> Clear
          </button>
        )}

        {/* Upload Entire Folder */}
        <label className="btn btn-secondary" style={{ cursor: isProcessing ? 'not-allowed' : 'pointer' }}>
          <FolderUp size={16} /> Add Folder
          <input 
            type="file" 
            webkitdirectory="true"
            directory="true"
            multiple 
            style={{ display: 'none' }} 
            onChange={onUploadFolder || onUpload} 
            disabled={isProcessing}
          />
        </label>

        {/* Upload Photos */}
        <label className="btn btn-primary" style={{ cursor: isProcessing ? 'not-allowed' : 'pointer' }}>
          <Upload size={16} /> Add Photos
          <input 
            type="file" 
            multiple 
            accept="image/*" 
            style={{ display: 'none' }} 
            onChange={onUpload} 
            disabled={isProcessing}
          />
        </label>
      </div>
    </div>
  );
}
