/**
 * Everything a mark needs to be hoverable, focusable and announced — in one
 * place, so the three can never drift apart.
 *
 * Keyboard focus must show what hover shows. Wiring `onPointerEnter` and
 * `onFocus` to the same setter is the only way that stays true as charts get
 * edited, and returning them together means a mark that is hoverable is
 * focusable by construction.
 */
export function markProps(
  key: string,
  label: string,
  onActivate: (key: string | null) => void,
) {
  return {
    tabIndex: 0,
    role: 'img' as const,
    'aria-label': label,
    onPointerEnter: () => onActivate(key),
    onPointerLeave: () => onActivate(null),
    onFocus: () => onActivate(key),
    onBlur: () => onActivate(null),
  };
}
