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
  onExportAll,
  onReindex
}) {
  return (
    <div className="glass-header flex justify-between items-center mb-8">
      {/* Left side: Title and Cloud Status */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <img src="./logo.png" alt="PhotoVault Logo" style={{ width: '32px', height: '32px' }} />
          <div>
            <h1 className="text-title" style={{ fontSize: '24px', margin: 0, lineHeight: 1 }}>
              PhotoVault
            </h1>
            {googleUser && (
              <div className="flex items-center gap-1 mt-1 text-caption" style={{ color: 'var(--success-color)' }}>
                <Cloud size={14} />
                <span>{googleUser.email}</span>
              </div>
            )}
          </div>
        </div>

        {/* Secondary Actions (Icons) */}
        <div className="flex items-center gap-2" style={{ marginLeft: '16px' }}>
          <button 
            className="btn btn-secondary btn-icon"
            onClick={onOpenGoogleModal}
            disabled={isProcessing}
            title="Google Drive Settings"
            style={{
              color: googleUser ? 'var(--success-color)' : 'var(--text-color)',
            }}
          >
            <Cloud size={18} strokeWidth={2} />
          </button>

          {hasItems && onExportAll && (
            <button 
              className="btn btn-secondary btn-icon" 
              onClick={onExportAll} 
              disabled={isProcessing}
              title="Export All Containers"
            >
              <Download size={18} strokeWidth={2} />
            </button>
          )}

          {googleUser && (
            <button 
              className="btn btn-secondary btn-icon" 
              onClick={onReindex} 
              disabled={isProcessing}
              title="Rebuild database from Google Drive"
            >
              <FolderUp size={18} strokeWidth={2} style={{ transform: 'rotate(180deg)' }} />
            </button>
          )}

          {hasItems && (
            <button 
              className="btn btn-danger btn-icon" 
              onClick={onClear} 
              disabled={isProcessing}
              title="Clear Local Vault"
            >
              <Trash2 size={18} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Right side: Primary Upload Actions */}
      <div className="flex items-center gap-3">
        {/* Upload Entire Folder */}
        <label className="btn btn-secondary" style={{ cursor: isProcessing ? 'not-allowed' : 'pointer' }}>
          <FolderUp size={18} strokeWidth={2} /> 
          <span>Add Folder</span>
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
          <Upload size={18} strokeWidth={2} /> 
          <span>Add Photos</span>
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
