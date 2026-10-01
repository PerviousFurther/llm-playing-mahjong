import React from 'react';

export function Switch({ label, checked, onChange, hint }) {
  return <label className="switch-row"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="switch-track" /></label>;
}
