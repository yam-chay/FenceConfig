import { useEffect, useRef, useState } from 'react';
import { buildShareUrl, createShortShareUrl, type DesignSnapshot } from '../persistence';

/** Past this, some messaging apps start truncating links. Only the long fallback link gets near it. */
const LONG_URL_WARN_CHARS = 4000;
const STATUS_MS = 3500;

type Status = 'pending' | 'copied' | 'copied-long';

const STATUS_TEXT: Record<Status, string> = {
  pending: 'מייצר קישור...',
  copied: 'הקישור הועתק',
  'copied-long': 'הועתק — הקישור ארוך, אפליקציות מסוימות עלולות לקצר אותו',
};

/**
 * Copies `url` once it resolves. Where supported, the clipboard write starts
 * synchronously inside the click with a pending ClipboardItem — Safari drops
 * the user gesture across an await, and writeText after the network call
 * would be rejected there.
 */
async function copyWhenReady(url: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const blob = url.then((u) => new Blob([u], { type: 'text/plain' }));
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    } catch {
      // Older engines reject promise-valued items — retry the plain way below.
    }
  }
  await navigator.clipboard.writeText(await url);
}

export function ShareLinkButton({ getSnapshot }: { getSnapshot: () => DesignSnapshot }) {
  const [status, setStatus] = useState<Status | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function handleClick() {
    if (status === 'pending') return;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setStatus('pending');

    const snapshot = getSnapshot();
    // Never rejects: any server failure silently falls back to the long hash link.
    const urlPromise = createShortShareUrl(snapshot).then((short) => short ?? buildShareUrl(snapshot));

    try {
      await copyWhenReady(urlPromise);
    } catch {
      // Clipboard blocked (permissions / insecure context) — manual copy.
      setStatus(null);
      window.prompt('העתיקו את הקישור:', await urlPromise);
      return;
    }
    const url = await urlPromise;
    setStatus(url.length > LONG_URL_WARN_CHARS ? 'copied-long' : 'copied');
    timeoutRef.current = window.setTimeout(() => setStatus(null), STATUS_MS);
  }

  return (
    <div className="share-link-wrap" dir="rtl">
      <button type="button" className="share-link-btn" onClick={handleClick} disabled={status === 'pending'}>
        העתק קישור צפייה
      </button>
      {status && (
        <span className="share-link-status" role="status">
          {STATUS_TEXT[status]}
        </span>
      )}
    </div>
  );
}
