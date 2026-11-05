export type AccountMenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

/** Returns the destination menu-item index, or null when the key should not move focus. */
export function nextAccountMenuIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount
  if (key === 'ArrowUp') return currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount
  return null
}
