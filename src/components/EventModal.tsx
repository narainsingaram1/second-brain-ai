import React, { useEffect, useState } from "react";
import { X, Trash2, MapPin, Link2, Users, Clock } from "lucide-react";
import { DialogBackdrop } from "./workspace/DialogBackdrop";
import { CustomDatePicker } from "./CustomDatePicker";
import { CalendarEvent, EventKind } from "../types";
import { EVENT_KINDS, safeEventLink } from "../utils/events";
import { getLocalDateString } from "../utils/habitStreaks";

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: CalendarEvent | null;
  defaultDate?: string;
  onSave: (event: CalendarEvent) => void;
  onDelete?: (eventId: string) => void;
}

const field =
  "w-full bg-slate-50 dark:bg-slate-800/80 text-xs text-ink px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white transition-all";
const label = "block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1";

/** Adds an hour to "HH:MM", capped at 23:59, as a sensible default end time. */
function plusHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return h >= 23 ? "23:59" : `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const EventModal: React.FC<EventModalProps> = ({ isOpen, onClose, event, defaultDate, onSave, onDelete }) => {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<EventKind>("meeting");
  const [date, setDate] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [link, setLink] = useState("");
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setTitle(event?.title || "");
    setKind(event?.kind || "meeting");
    setDate(event?.date || defaultDate || getLocalDateString());
    setAllDay(event ? !event.startTime : false);
    setStartTime(event?.startTime || "09:00");
    setEndTime(event?.endTime || (event?.startTime ? "" : "10:00"));
    setLocation(event?.location || "");
    setLink(event?.link || "");
    setAttendees(event?.attendees?.join(", ") || "");
    setNotes(event?.notes || "");
    setError("");
  }, [event, defaultDate, isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    if (!allDay && endTime && endTime <= startTime) {
      setError("End time must be after the start time.");
      return;
    }
    const safeLink = safeEventLink(link);
    if (link.trim() && !safeLink) {
      setError("Enter a full link starting with http:// or https://.");
      return;
    }
    const now = new Date().toISOString();
    const people = attendees.split(",").map((a) => a.trim()).filter(Boolean);
    onSave({
      id: event?.id || crypto.randomUUID(),
      title: title.trim(),
      kind,
      date,
      ...(!allDay ? { startTime, ...(endTime ? { endTime } : {}) } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(safeLink ? { link: safeLink } : {}),
      ...(people.length ? { attendees: people } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      createdAt: event?.createdAt || now,
      updatedAt: now,
    });
    onClose();
  };

  return (
    <DialogBackdrop onClose={onClose} label="Event details" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in">
      <div className="workspace-dialog bg-panel rounded-3xl border border-line shadow-2xl w-full max-w-lg overflow-visible flex flex-col max-h-[92vh]">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-base tracking-tight text-ink">{event ? "Edit Event" : "New Event"}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Meetings, classes and appointments with a time and place</p>
          </div>
          <button aria-label="Close dialog" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label htmlFor="event-title" className={label}>Title *</label>
            <input id="event-title" type="text" required autoFocus maxLength={300} placeholder="e.g. Office hours with Prof. Smith" value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} font-bold`} />
          </div>

          <div>
            <span className={label}>Type</span>
            <div className="grid grid-cols-4 gap-1.5 bg-raised p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700" role="radiogroup" aria-label="Event type">
              {EVENT_KINDS.map((k) => (
                <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)}
                  className={`py-1.5 rounded-xl text-[11px] font-bold transition-all ${kind === k.id ? "bg-white dark:bg-slate-700 text-ink shadow-xs" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={label}>Date *</span>
            <CustomDatePicker value={date} onChange={setDate} placeholder="Choose date" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Time</span>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 cursor-pointer">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-slate-900" />
                All day
              </label>
            </div>
            {!allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="event-start" className="block text-[11px] font-semibold text-slate-400 mb-1">Starts</label>
                  <input id="event-start" type="time" required value={startTime}
                    onChange={(e) => { const next = e.target.value; setStartTime(next); if (next && (!endTime || endTime <= next)) setEndTime(plusHour(next)); }}
                    className={`${field} font-bold`} />
                </div>
                <div>
                  <label htmlFor="event-end" className="block text-[11px] font-semibold text-slate-400 mb-1">Ends (optional)</label>
                  <input id="event-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={`${field} font-bold`} />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="event-location" className={`${label} flex items-center gap-1`}><MapPin className="w-3.5 h-3.5" /> Location</label>
              <input id="event-location" type="text" maxLength={300} placeholder="e.g. Klaus 1447" value={location} onChange={(e) => setLocation(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="event-link" className={`${label} flex items-center gap-1`}><Link2 className="w-3.5 h-3.5" /> Meeting link</label>
              <input id="event-link" type="url" inputMode="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} className={field} />
            </div>
          </div>

          <div>
            <label htmlFor="event-attendees" className={`${label} flex items-center gap-1`}><Users className="w-3.5 h-3.5" /> People</label>
            <input id="event-attendees" type="text" placeholder="Comma separated, e.g. Alex, Prof. Smith" value={attendees} onChange={(e) => setAttendees(e.target.value)} className={field} />
          </div>

          <div>
            <label htmlFor="event-notes" className={label}>Notes</label>
            <textarea id="event-notes" rows={3} placeholder="Agenda, prep, dial-in details…" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${field} resize-none`} />
          </div>

          {error && <p role="alert" className="text-xs font-semibold text-rose-500">{error}</p>}

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            {event && onDelete ? (
              <button type="button" onClick={() => { onDelete(event.id); onClose(); }} className="text-xs font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> Delete Event
              </button>
            ) : <div />}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-full text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">Cancel</button>
              <button type="submit" className="px-5 py-2 rounded-full bg-slate-950 dark:bg-white text-white dark:text-slate-950 text-xs font-bold shadow-sm hover:opacity-90 active:scale-95 transition-all">Save Event</button>
            </div>
          </div>
        </form>
      </div>
    </DialogBackdrop>
  );
};
