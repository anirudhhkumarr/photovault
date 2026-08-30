import React from 'react';

export function StorageSummary({ totalOriginal, totalCompressed, photoCount }) {
  const spaceSaved = totalOriginal - totalCompressed;
  const ratio = totalOriginal > 0 && spaceSaved > 0 ? ((spaceSaved / totalOriginal) * 100).toFixed(0) : '0';

  return (
    <div className="flex gap-4 mb-8">
      <div className="card" style={{ flex: 1, padding: '18px 22px' }}>
        <div className="text-caption mb-1" style={{ fontWeight: 500 }}>Library Size</div>
        <div className="text-title" style={{ fontSize: '22px', margin: 0 }}>
          {(totalOriginal / 1024 / 1024).toFixed(1)} MB
        </div>
        <div className="text-caption" style={{ marginTop: '2px' }}>{photoCount} photos</div>
      </div>

      <div className="card" style={{ flex: 1, padding: '18px 22px' }}>
        <div className="text-caption mb-1" style={{ fontWeight: 500 }}>Vault Storage</div>
        <div className="text-title" style={{ fontSize: '22px', margin: 0 }}>
          {(totalCompressed / 1024 / 1024).toFixed(1)} MB
        </div>
        <div className="text-caption" style={{ marginTop: '2px' }}>In Google Drive</div>
      </div>

      <div 
        className="card" 
        style={{ 
          flex: 1, 
          padding: '18px 22px', 
          backgroundColor: 'rgba(52, 199, 89, 0.08)', 
          border: '1px solid rgba(52, 199, 89, 0.2)' 
        }}
      >
        <div className="text-caption mb-1" style={{ fontWeight: 500, color: 'var(--success-color)' }}>Total Saved</div>
        <div className="text-title" style={{ fontSize: '22px', margin: 0, color: 'var(--success-color)' }}>
          {ratio}%
        </div>
        <div className="text-caption" style={{ marginTop: '2px', color: 'var(--success-color)' }}>
          {(spaceSaved / 1024 / 1024).toFixed(1)} MB reclaimed
        </div>
      </div>
    </div>
  );
}
