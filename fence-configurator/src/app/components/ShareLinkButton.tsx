import { useEffect, useRef, useState } from 'react';
import { buildShareUrl, type DesignSnapshot } from '../persistence';

/** Past this, some messaging apps start truncating links. */
const LONG_URL_WARN_CHARS = 4000;
const STATUS_MS = 3500;

export function ShareLinkButton({ getSnapshot }: { getSnapshot: () => DesignSnapshot }) {
  const [status, setStatus] = useState<'copied' | 'copied-long' | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  async function handleClick() {
    const url = buildShareUrl(getSnapshot());
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (permissions / insecure context) — manual copy.
      window.prompt('העתיקו את הקישור:', url);
      return;
    }
    setStatus(url.length > LONG_URL_WARN_CHARS ? 'copied-long' : 'copied');
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setStatus(null), STATUS_MS);
  }

  return (
    <div className="share-link-wrap" dir="rtl">
      <button type="button" className="share-link-btn" onClick={handleClick}>
        העתק קישור צפייה
      </button>
      {status && (
        <span className="share-link-status">
          {status === 'copied' ? 'הקישור הועתק' : 'הועתק — הקישור ארוך, אפליקציות מסוימות עלולות לקצר אותו'}
        </span>
      )}
    </div>
  );
}
