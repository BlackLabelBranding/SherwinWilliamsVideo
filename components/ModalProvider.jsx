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
  const resolveConfirmRef = useRef(null);
  const inputRef = useRef(null);
  const titleId = useId();
  const busy = modal?.mode === 'busy';

  const close = useCallback(() => {
    if (busy) return;
    if (resolvePromptRef.current) {
      resolvePromptRef.current(null);
      resolvePromptRef.current = null;
    }
    if (resolveConfirmRef.current) {
      resolveConfirmRef.current(false);
      resolveConfirmRef.current = null;
    }
    setModal(null);
  }, [busy]);

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
        loadingTitle: opts.loadingTitle || 'Updating…',
        loadingMessage: opts.loadingMessage || 'Please wait.',
        tone: 'info'
      });
    });
  }, []);

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolveConfirmRef.current = resolve;
      setModal({
        mode: 'confirm',
        title: opts.title || 'Confirm',
        message: opts.message || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        tone: opts.tone || 'info',
        destructive: Boolean(opts.destructive)
      });
    });
  }, []);

  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && modal.mode !== 'busy') close();
    };
    window.addEventListener('keydown', onKey);
    if (modal.mode === 'prompt') {
      queueMicrotask(() => inputRef.current?.focus());
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, close]);

  function submitPrompt(event) {
    event.preventDefault();
    if (busy) return;
    const value = String(new FormData(event.currentTarget).get('value') || '');
    if (modal?.minLength && value.length < modal.minLength) {
      return;
    }
    const resolve = resolvePromptRef.current;
    resolvePromptRef.current = null;
    // Keep modal visible — switch to loading, then caller notify()/error replaces it.
    setModal((prev) => ({
      mode: 'busy',
      title: prev?.loadingTitle || 'Updating…',
      message: prev?.loadingMessage || 'Please wait.',
      tone: 'info'
    }));
    resolve?.(value);
  }

  function submitConfirm(confirmed) {
    if (busy) return;
    const resolve = resolveConfirmRef.current;
    resolveConfirmRef.current = null;
    setModal(null);
    resolve?.(confirmed);
  }

  return (
    <ModalContext.Provider value={{ notify, prompt, confirm }}>
      {children}
      {modal ? (
        <div
          className="app-modal-backdrop"
          role="presentation"
          onClick={busy ? undefined : close}
        >
          <div
            className={`app-modal app-modal--${modal.tone || 'error'}${busy ? ' app-modal--busy' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-busy={busy ? 'true' : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="app-modal-eyebrow">
              {busy ? 'Please wait' : modal.tone === 'success' ? 'Done' : modal.tone === 'info' ? 'Action' : 'Alert'}
            </p>
            <h2 id={titleId}>{modal.title}</h2>
            {modal.message ? <p className="app-modal-message">{modal.message}</p> : null}

            {modal.mode === 'busy' ? (
              <div className="app-modal-loading" role="status">
                <span className="section-spinner" />
                <span>Processing…</span>
              </div>
            ) : null}

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
            ) : null}

            {modal.mode === 'alert' ? (
              <div className="app-modal-actions">
                <button type="button" className="primary-button" onClick={close} autoFocus>
                  OK
                </button>
              </div>
            ) : null}

            {modal.mode === 'confirm' ? (
              <div className="app-modal-actions">
                <button type="button" className="secondary-button" onClick={() => submitConfirm(false)}>
                  {modal.cancelLabel || 'Cancel'}
                </button>
                <button
                  type="button"
                  className={modal.destructive ? 'danger-button' : 'primary-button'}
                  onClick={() => submitConfirm(true)}
                  autoFocus
                >
                  {modal.confirmLabel || 'Confirm'}
                </button>
              </div>
            ) : null}
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
