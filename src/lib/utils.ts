import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isTodayKenyanTime(dateInput: Date | string | number): boolean {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return false;

    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };
    const formatter = new Intl.DateTimeFormat('en-CA', options);

    const todayStr = formatter.format(new Date());
    const targetStr = formatter.format(d);

    return todayStr === targetStr;
  } catch {
    const now = new Date();
    const d = new Date(dateInput);
    return now.toDateString() === d.toDateString();
  }
}
