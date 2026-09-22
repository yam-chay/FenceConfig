import { useState } from 'react';

/** Modal on entry + a permanent strip — screenshots get forwarded without the modal. */
export function ViewDisclaimer() {
  const [open, setOpen] = useState(true);

  return (
    <>
      <div className="view-disclaimer-strip" dir="rtl">
        הדמיה להמחשה בלבד · הנראות בפועל תיקבע לפי תנאי השטח והמדידה באתר
      </div>

      {open && (
        <div className="view-modal-backdrop" role="dialog" aria-modal="true" dir="rtl">
          <div className="view-modal">
            <h2>הדמיה להמחשה בלבד</h2>
            <p>
              ההדמיה מוצגת בתנאי מעבדה ונועדה להמחשה כללית של העיצוב. הנראות בפועל — גוונים, פרופורציות
              ופרטים — תיקבע לפי תנאי השטח, המידות המדויקות שיימדדו באתר והסביבה.
            </p>
            <p>ההדמיה אינה מהווה הצעת מחיר או מפרט טכני מחייב.</p>
            <p className="view-modal-hint">
              אפשר לסובב ולקרב את המצלמה, לשנות את שעת היום, וללחוץ על הגדר כדי להתמקד בה.
            </p>
            <button className="view-modal-btn" onClick={() => setOpen(false)}>
              הבנתי, להמשך צפייה
            </button>
          </div>
        </div>
      )}
    </>
  );
}
