import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, Clock, MapPin, Pencil, Plus, RefreshCw, Search, Users } from "lucide-react";
import type { CalendarEvent, EventKind } from "../types";
import { EVENT_KINDS, eventTimeLabel, safeEventLink, sortEvents } from "../utils/events";
import { getLocalDateString } from "../utils/habitStreaks";
import { googleEvents, serverFeatures, type GoogleCalendarEvent } from "../services/serverApi";
import { PageHeading } from "./workspace/PageHeading";

type Period = "upcoming" | "today" | "past";
type AgendaEvent = {
  id: string; title: string; date: string; endDate?: string; startTime?: string; endTime?: string;
  location?: string; link?: string; notes?: string; people: string; kind: EventKind | "google";
  original?: CalendarEvent;
};
const shiftDay = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return getLocalDateString(value);
};
const fullDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function EventsView({ events, onAddEvent, onEditEvent }: {
  events: CalendarEvent[]; onAddEvent: (date?: string) => void; onEditEvent: (event: CalendarEvent) => void;
}) {
  const [period, setPeriod] = useState<Period>("upcoming");
  const [kind, setKind] = useState<EventKind | "all" | "google">("all");
  const [search, setSearch] = useState("");
  const [today, setToday] = useState(getLocalDateString);
  const [remote, setRemote] = useState<GoogleCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(getLocalDateString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const from = period === "past" ? shiftDay(today, -60) : today;
  const to = period === "past" ? today : period === "today" ? shiftDay(today, 1) : shiftDay(today, 60);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setRemote([]);
    serverFeatures().then(features => features.google ? googleEvents(from, to, refresh > 0) : [])
      .then(items => { if (live) setRemote(items); })
      .catch(() => { /* Local events remain available when the server is offline. */ })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [from, to, refresh]);

  const all: AgendaEvent[] = [
    ...events.map(event => ({ ...event, id: `local:${event.id}`, people: event.attendees?.join(", ") || "", original: event })),
    ...remote.map(event => ({ ...event, id: `google:${event.id}`, kind: "google" as const, people: event.attendees ? `${event.attendees} attendee${event.attendees === 1 ? "" : "s"}` : "" })),
  ];
  const query = search.trim().toLocaleLowerCase();
  const visible = sortEvents(all.filter(event => {
    const end = event.endDate || event.date;
    if (period === "upcoming" ? end < today : period === "today" ? event.date > today || end < today : end >= today) return false;
    if (kind !== "all" && event.kind !== kind) return false;
    return !query || [event.title, event.location, event.people, event.notes].some(value => value?.toLocaleLowerCase().includes(query));
  }));
  // Most recent days first in history, chronological times within each day.
  const groups = new Map<string, AgendaEvent[]>();
  for (const event of visible) {
    const date = period !== "past" && event.date < today ? today : event.date;
    groups.set(date, [...(groups.get(date) || []), event]);
  }
  const days = [...groups].sort(([a], [b]) => period === "past" ? b.localeCompare(a) : a.localeCompare(b));
  const filtered = kind !== "all" || Boolean(query);

  return <section className="events-page" aria-label="Events and meetings">
    <PageHeading title="Events" description="Your meetings, classes and appointments, in one place.">
      <button className="workspace-primary" onClick={() => onAddEvent(today)}><Plus size={16} /> New event</button>
    </PageHeading>
    <div className="events-toolbar">
      <div className="segmented" role="group" aria-label="Event period">
        {([ ["upcoming", "Upcoming"], ["today", "Today"], ["past", "Past"] ] as const).map(([value, label]) =>
          <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}
      </div>
      <div className="events-filters">
        <label className="field-search"><Search size={15} /><input aria-label="Search events" placeholder="Search events…" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <select className="field-select" aria-label="Event type" value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
          <option value="all">All types</option>
          {EVENT_KINDS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          <option value="google">Google Calendar</option>
        </select>
        <button className="icon-control" aria-label="Refresh Google events" title="Refresh Google events" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
      </div>
    </div>
    <p className="events-result-count" role="status">{visible.length} {visible.length === 1 ? "event" : "events"}{filtered ? " matching your filters" : period === "today" ? " today" : period === "past" ? " in your history" : " coming up"}{loading ? " · Checking Google Calendar…" : ""}</p>
    {days.length ? <div className="events-agenda">{days.map(([date, items]) => <section className="events-day" key={date} aria-label={fullDate(date)}>
      <div className="events-date"><span>{date === today ? "Today" : date === shiftDay(today, 1) ? "Tomorrow" : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}</span><time dateTime={date}>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) })}</time></div>
      <div className="events-day-list">{items.map(event => {
        const link = safeEventLink(event.link);
        const label = EVENT_KINDS.find(item => item.id === event.kind)?.label || "Google Calendar";
        return <article className={`events-row events-kind-${event.kind}`} key={event.id} data-record-id={event.original?.id || event.id}>
          <div className="events-time"><Clock size={14} /><span>{eventTimeLabel(event)}{event.endDate && event.endDate !== event.date && <small>{fullDate(event.date)} – {fullDate(event.endDate)}</small>}</span></div>
          <div className="events-details">
            <div className="events-title-line">{event.original ? <button className="events-title" onClick={() => onEditEvent(event.original!)}>{event.title}</button> : <h3 className="events-title">{event.title}</h3>}<span className="events-kind-label">{label}</span></div>
            {(event.location || event.people) && <div className="events-meta">{event.location && <span><MapPin size={13} />{event.location}</span>}{event.people && <span><Users size={13} />{event.people}</span>}</div>}
            {event.notes && <p className="events-notes">{event.notes}</p>}
          </div>
          <div className="events-row-actions">
            {link && <a href={link} target="_blank" rel="noopener noreferrer" className="events-link">{event.kind === "google" ? "Open" : "Join"}<ArrowUpRight size={14} /><span className="sr-only"> {event.title}</span></a>}
            {event.original && <button className="icon-control" aria-label={`Edit ${event.title}`} onClick={() => onEditEvent(event.original!)}><Pencil size={15} /></button>}
          </div>
        </article>;
      })}</div>
    </section>)}</div> : <div className="events-empty">
      <CalendarDays size={30} strokeWidth={1.25} />
      <h2>{filtered ? "No matching events" : period === "today" ? "Your day is clear" : period === "past" ? "No past events" : "Nothing on the calendar yet"}</h2>
      <p>{filtered ? "Try another search or event type." : period === "past" ? "Previous events will appear here." : "Add a meeting, class or appointment to see it here and on your calendar."}</p>
      {filtered ? <button className="text-action" onClick={() => { setSearch(""); setKind("all"); }}>Clear filters</button> : period !== "past" && <button className="workspace-primary" onClick={() => onAddEvent(today)}><Plus size={15} /> New event</button>}
    </div>}
    {remote.length > 0 && <p className="events-calendar-note">Google Calendar events are shown for {period === "today" ? "today" : period === "past" ? "the previous 60 days" : "the next 60 days"}. Open them in Google Calendar to make changes.</p>}
  </section>;
}
