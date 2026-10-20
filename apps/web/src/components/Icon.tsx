const P: Record<string, string> = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  plans: '<rect x="4" y="4.5" width="16" height="16" rx="3"/><path d="M8 3v3M16 3v3M4 9.5h16M8.5 14l2 2 4-4"/>',
  task: '<rect x="4" y="4.5" width="16" height="16" rx="3"/><path d="M8.5 13l2.5 2.5 5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  food: '<path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M8 11.5V8m4 3.5V6m4 5.5V9"/>',
  more: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5 5.5 5"/>',
  drop: '<path d="M12 3.5c3.2 4 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 2.8-6.5 6-10.5z"/>',
  study: '<path d="M4 5h6.5a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6.5a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2H20z"/>',
  gym: '<path d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12"/>',
  quiz: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.8 2.1c-.8.5-1.3 1-1.3 1.9M12 16.6v.2"/>',
  money: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3"/><rect x="4" y="8" width="16" height="11" rx="2.5"/>',
  books: '<path d="M5 4.5h4v15H5zM10 4.5h4v15h-4zM15 5.4l3.7-1 3.3 14.6-3.7 1z"/>',
  steps: '<path d="M7.5 3.5c1.8 0 2.8 2 2.8 4.5s-1 4.5-2.8 4.5S4.7 10.5 4.7 8s1-4.5 2.8-4.5zM16.5 7.5c1.8 0 2.8 2 2.8 4.5s-1 4.5-2.8 4.5-2.8-2-2.8-4.5 1-4.5 2.8-4.5z"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  stats: '<path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>', chevL: '<path d="M14.5 6l-6 6 6 6"/>',
  flame: '<path d="M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3 0 1.5 1 2 1.5 2C11 8 10 6 12 3z"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 13.7-5.6M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6M4 20v-4h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>'
};
export function Icon({ name, className = 'ic' }: { name: keyof typeof P | string; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[name] ?? '' }} />;
}
