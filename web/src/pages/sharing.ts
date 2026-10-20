import { firstName } from '../format'

/** Shown by every box that adds a prayer burden or comment: co-shepherds all see them. */
export const sharedWithShepherds = (name?: string) =>
  `Everyone who shepherds ${name ? firstName(name) : 'this person'} sees prayer burdens and comments.`
