import { createContext, useContext } from 'react';

/**
 * Opens the player panel (#68) from anywhere in the tree.
 *
 * A context rather than a prop threaded through every table, because the point
 * of the panel is that any row in any tab can open it — and the tables sit
 * three and four components deep. Null outside the provider, where a name
 * stays plain text rather than becoming a button that does nothing.
 */
export const OpenPlayerContext = createContext<((id: string) => void) | null>(null);

export const useOpenPlayer = () => useContext(OpenPlayerContext);
