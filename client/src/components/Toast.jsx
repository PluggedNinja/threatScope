import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { sfx } from '../sounds.js';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((t) => {
    const id = ++idRef.current;
    const toast = { id, type: 'info', ttl: 4500, ...t };
    setToasts((cur) => [...cur, toast]);
    if (toast.type === 'alert') sfx.alert();
    else if (toast.type === 'warn') sfx.fail();
    else sfx.click();
    if (toast.ttl) setTimeout(() => setToasts((c) => c.filter((x) => x.id !== id)), toast.ttl);
    return id;
  }, []);

  const remove = (id) => setToasts((c) => c.filter((x) => x.id !== id));

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast ${t.type}`}
              initial={{ opacity: 0, x: 60, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              onClick={() => remove(t.id)}
            >
              <div className="t-title">{t.title || 'INFO'}</div>
              <div>{t.message}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
