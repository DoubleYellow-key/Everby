function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatChatTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const current = new Date(now);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const dayDifference = Math.round((startOfLocalDay(now) - startOfLocalDay(timestamp)) / 86_400_000);

  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (date.getFullYear() === current.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

export function formatChatTimeTitle(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}
