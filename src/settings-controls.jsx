import React from 'react';

export function Switch({ label, checked, onChange }) {
  return <label className="switch-row"><strong>{label}</strong><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /></label>;
}
