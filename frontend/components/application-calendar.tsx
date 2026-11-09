"use client";

import { useEffect, useState } from "react";
import { request } from "../lib/workspace-client";

type CalendarEvent = { id: number; date: string; type: string; title: string; company: string };
type CalendarData = { month: string; current: string; events: CalendarEvent[] };
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthDate(month: string) {
  return new Date(month + "-01T12:00:00Z");
}

export function ApplicationCalendar({ refresh, open }: { refresh: number; open: (id: number) => void }) {
  const [month, setMonth] = useState("");
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    request<CalendarData>("application-calendar" + (month ? "?month=" + month : ""), {
      signal: controller.signal,
    }).then((result) => {
      if (!controller.signal.aborted) {
        setData(result);
        setError(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [month, refresh]);

  if (!data || error) return <p role={error ? "alert" : "status"}>
    {error ? "Could not load the calendar." : "Loading calendar…"}
  </p>;

  const displayed = data.month;
  const first = monthDate(displayed);
  const after = monthDate(displayed);
  after.setUTCMonth(after.getUTCMonth() + 1);
  const count = Math.round((after.getTime() - first.getTime()) / 86_400_000);
  const offset = (first.getUTCDay() + 6) % 7;
  const label = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const weeks = Array.from({ length: Math.ceil((count + offset) / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => week * 7 + day - offset + 1)
  );

  function move(by: number) {
    const target = monthDate(displayed);
    target.setUTCMonth(target.getUTCMonth() + by);
    const year = target.getUTCFullYear();
    if (year >= 1 && year <= 9999) setMonth(target.toISOString().slice(0, 7));
  }

  return <div className="calendar">
    <div className="form-actions calendar-nav">
      <h3 aria-live="polite">{label}</h3>
      <button className="text-button" onClick={() => move(-1)}>Previous month</button>
      <button className="text-button" onClick={() => setMonth(data.current)}>Current month</button>
      <button className="text-button" onClick={() => move(1)}>Next month</button>
    </div>
    <div className="table-scroll">
      <table className="calendar-grid" aria-label={label + " application calendar"}>
        <thead><tr>{weekdays.map((day) => <th scope="col" key={day}>{day}</th>)}</tr></thead>
        <tbody>{weeks.map((week, index) => <tr key={index}>
          {week.map((day) => {
            if (day < 1 || day > count) return <td key={day} className="calendar-empty" />;
            const date = data.month + "-" + String(day).padStart(2, "0");
            const events = data.events.filter((entry) => entry.date === date);
            return <td key={day}>
              <time dateTime={date}>{day}</time>
              {events.map((entry) => <button className="text-button calendar-event" key={entry.id + entry.type}
                onClick={() => open(entry.id)} aria-label={entry.type + " for " + entry.title + " at " + entry.company}>
                {entry.type} · {entry.company}
              </button>)}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    {data.events.length === 0 && <p className="empty">No interviews or follow-ups in this month.</p>}
  </div>;
}
