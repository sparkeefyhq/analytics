const priorityRank = { high: 0, medium: 1, low: 2 };

function isTask(item) {
  return Object.prototype.hasOwnProperty.call(item, 'due_date');
}

function isMeeting(item) {
  return Object.prototype.hasOwnProperty.call(item, 'scheduled_date');
}

function dueDate(item, today) {
  if (isMeeting(item)) return item.scheduled_date;
  return isTask(item) ? item.due_date || today : today;
}

function dueTime(item) {
  const time = isMeeting(item) ? item.scheduled_time : isTask(item) ? item.due_time : item.time;
  return /^\d{2}:\d{2}$/.test(time || '') ? time : '99:99';
}

function isActionable(item, today) {
  if (isMeeting(item)) return item.status === 'scheduled' && item.scheduled_date === today;
  if (isTask(item)) return item.status !== 'complete' && item.status !== 'skipped' && dueDate(item, today) <= today;
  return item.status === 'pending';
}

/**
 * Orders today's focus candidates using India-local due times. An overdue one-off
 * task always comes first; priority only settles a true timing tie.
 */
export function compareFocusItems(a, b, today) {
  const aDate = dueDate(a, today);
  const bDate = dueDate(b, today);
  const aOverdue = isTask(a) && aDate < today;
  const bOverdue = isTask(b) && bDate < today;
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  if (aOverdue && aDate !== bDate) return aDate.localeCompare(bDate);

  const timeOrder = dueTime(a).localeCompare(dueTime(b));
  if (timeOrder) return timeOrder;

  const priorityOrder = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
  if (priorityOrder) return priorityOrder;
  return String(a.title).localeCompare(String(b.title));
}

export function pickTodaysFocus(items, today, currentTime = '00:00') {
  const actionable = items.filter((item) => isActionable(item, today));
  const joinableMeeting = actionable.filter((item) => isMeeting(item) && dueTime(item) >= currentTime && dueTime(item) <= addMinutes(currentTime, 15)).sort((a, b) => dueTime(a).localeCompare(dueTime(b)))[0];
  return joinableMeeting || actionable.sort((a, b) => compareFocusItems(a, b, today))[0] || null;
}

function addMinutes(time, minutes) {
  const [hour, minute] = time.split(':').map(Number);
  const total = Math.min(hour * 60 + minute + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
