import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearLocalDesign, type AppMode } from '../persistence';

/**
 * Last line of defence behind persistence.ts validation. Never wipes the
 * saved design on its own — a crash may be an unrelated bug, and silently
 * deleting someone's work for it is worse than the crash.
 */

export function CenteredNotice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="centered-notice" dir="rtl">
      <div className="centered-notice-card">
        <h2>{title}</h2>
        <p>{body}</p>
        {children && <div className="centered-notice-actions">{children}</div>}
      </div>
    </div>
  );
}

interface Props {
  mode: AppMode;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class DesignErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[fence] render crash', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    if (this.props.mode === 'view') {
      return (
        <CenteredNotice
          title="לא ניתן להציג את ההדמיה"
          body="ייתכן שהקישור פגום או שנוצר בגרסה קודמת של המערכת. אפשר לבקש קישור חדש."
        />
      );
    }

    return (
      <CenteredNotice title="משהו השתבש בטעינה" body="העיצוב שלך לא נמחק. אפשר לנסות שוב, או להתחיל עיצוב חדש מההתחלה.">
        <button className="notice-btn" onClick={() => window.location.reload()}>
          נסה שוב
        </button>
        <button
          className="notice-btn notice-btn-secondary"
          onClick={() => {
            clearLocalDesign();
            window.location.reload();
          }}
        >
          התחל עיצוב חדש
        </button>
      </CenteredNotice>
    );
  }
}
