'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

const ModalContext = createContext(null);

function toneTitle(tone) {
  if (tone === 'success') return 'Success';
  if (tone === 'info') return 'Notice';
  return 'Error';
}

export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null);
  const resolvePromptRef = useRef(null);
  const inputRef = useRef(null);
  const titleId = useId();

  const close = useCallback(() => {
    if (resolvePromptRef.current) {
      resolvePromptRef.current(null);
      resolvePromptRef.current = null;
    }
    setModal(null);
  }, []);

  const notify = useCallback((opts) => {
    const payload = typeof opts === 'string' ? { message: opts } : opts || {};
    const tone = payload.tone || 'error';
    setModal({
      mode: 'alert',
      title: payload.title || toneTitle(tone),
      message: payload.message || '',
      tone
    });
  }, []);

  const prompt = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolvePromptRef.current = resolve;
      setModal({
        mode: 'prompt',
        title: opts.title || 'Input required',
        message: opts.message || '',
        placeholder: opts.placeholder || '',
        inputType: opts.inputType || 'text',
        minLength: opts.minLength,
        confirmLabel: opts.confirmLabel || 'Continue',
        tone: 'info'
      });
    });
  }, []);

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolvePromptRef.current = resolve;
      setModal({
        mode: 'confirm',
        title: opts.title || 'Confirm',
        message: opts.message || 'Are you sure?',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        tone: opts.tone || 'error'
      });
    });
  }, []);

  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    if (modal.mode === 'prompt') {
      queueMicrotask(() => inputRef.current?.focus());
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, close]);

  function submitPrompt(event) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('value') || '');
    if (modal?.minLength && value.length < modal.minLength) {
      return;
    }
    if (resolvePromptRef.current) {
      resolvePromptRef.current(value);
      resolvePromptRef.current = null;
    }
    setModal(null);
  }

  function acceptConfirm() {
    if (resolvePromptRef.current) {
      resolvePromptRef.current(true);
      resolvePromptRef.current = null;
    }
    setModal(null);
  }

  return (
    <ModalContext.Provider value={{ notify, prompt, confirm }}>
      {children}
      {modal ? (
        <div className="app-modal-backdrop" role="presentation" onClick={close}>
          <div
            className={`app-modal app-modal--${modal.tone || 'error'}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="app-modal-eyebrow">
              {modal.mode === 'confirm'
                ? 'Confirm'
                : modal.tone === 'success'
                  ? 'Done'
                  : modal.tone === 'info'
                    ? 'Action'
                    : 'Alert'}
            </p>
            <h2 id={titleId}>{modal.title}</h2>
            {modal.message ? <p className="app-modal-message">{modal.message}</p> : null}

            {modal.mode === 'prompt' ? (
              <form className="app-modal-form" onSubmit={submitPrompt}>
                <label>
                  <span className="sr-only">{modal.title}</span>
                  <input
                    ref={inputRef}
                    name="value"
                    type={modal.inputType || 'text'}
                    placeholder={modal.placeholder || ''}
                    minLength={modal.minLength || undefined}
                    required
                  />
                </label>
                <div className="app-modal-actions">
                  <button type="button" className="secondary-button" onClick={close}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-button">
                    {modal.confirmLabel || 'Continue'}
                  </button>
                </div>
              </form>
            ) : modal.mode === 'confirm' ? (
              <div className="app-modal-actions">
                <button type="button" className="secondary-button" onClick={close}>
                  {modal.cancelLabel || 'Cancel'}
                </button>
                <button type="button" className="primary-button" onClick={acceptConfirm} autoFocus>
                  {modal.confirmLabel || 'Confirm'}
                </button>
              </div>
            ) : (
              <div className="app-modal-actions">
                <button type="button" className="primary-button" onClick={close} autoFocus>
                  OK
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error('useModal must be used within ModalProvider');
  }
  return ctx;
}

export function friendlyError(error) {
  const message = error?.message || 'Something went wrong.';
  if (error?.status === 401 || /unauthorized/i.test(message)) {
    return 'Your session expired. Please sign in again.';
  }
  return message;
}
