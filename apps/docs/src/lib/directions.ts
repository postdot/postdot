export const directions = ['prism', 'studio', 'signal'] as const
export type DirectionStyle = (typeof directions)[number]
