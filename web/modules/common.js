export function dedupeMessages(messages) {
  return [...new Set(Array.isArray(messages) ? messages : [])];
}

export function isPastOrToday(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return date <= cutoff;
}
