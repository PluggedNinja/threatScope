import React from 'react';

export default function Hint({ children }) {
  return (
    <span className="hint">
      <span className="q">?</span>
      <span className="bubble">{children}</span>
    </span>
  );
}
