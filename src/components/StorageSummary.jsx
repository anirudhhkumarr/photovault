import React from 'react';

export function StorageSummary({ totalOriginal, totalCompressed, photoCount }) {
  const spaceSaved = Math.max(0, totalOriginal - totalCompressed);
  
  // To render the bar, we show Vault Storage vs Space Saved 
  // out of the totalOriginal size.
  const compressedPercent = totalOriginal > 0 ? (totalCompressed / totalOriginal) * 100 : 0;
  const savedPercent = totalOriginal > 0 ? (spaceSaved / totalOriginal) * 100 : 0;

  return (
    <div className="card mb-8 p-6">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h2 className="text-title" style={{ fontSize: '28px', margin: 0 }}>
            {(totalOriginal / 1024 / 1024).toFixed(1)} MB <span style={{ fontSize: '18px', color: 'var(--text-secondary)', fontWeight: 500 }}>of Original Library</span>
          </h2>
          <p className="text-caption mt-2">{photoCount} Photos Total</p>
        </div>
      </div>

      {/* iCloud Style Horizontal Storage Bar */}
      <div className="storage-bar-track mb-4">
        <div 
          className="storage-bar-fill" 
          style={{ 
            width: `${compressedPercent}%`, 
            backgroundColor: 'var(--accent-color)',
            zIndex: 2
          }} 
        />
        <div 
          className="storage-bar-fill" 
          style={{ 
            width: `${compressedPercent + savedPercent}%`, 
            backgroundColor: 'var(--success-color)',
            zIndex: 1
          }} 
        />
      </div>

      <div className="flex gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--accent-color)' }}></div>
          <div>
            <div className="text-caption" style={{ fontWeight: 600, color: 'var(--text-color)' }}>Vault Storage</div>
            <div className="text-caption" style={{ fontSize: '12px' }}>{(totalCompressed / 1024 / 1024).toFixed(1)} MB on Drive</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--success-color)' }}></div>
          <div>
            <div className="text-caption" style={{ fontWeight: 600, color: 'var(--text-color)' }}>Space Saved</div>
            <div className="text-caption" style={{ fontSize: '12px' }}>{(spaceSaved / 1024 / 1024).toFixed(1)} MB ({savedPercent.toFixed(0)}%)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
