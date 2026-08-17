// Field CONTROLLER — layout math and descriptor types. No DOM.

export type FieldGridVariant = 'settings' | 'inputs';
export type FieldLabelSize = 'sm' | 'md';

/** Label↔control and between-row rhythm shared by the settings surfaces. */
export const FIELD_GAP_PX = 16;

/** Grid tracks for a field grid. Settings hugs both columns; inputs give leftover
 *  space to the control column. Mobile flips the label to a flexible track. */
export function fieldGridColumns(variant: FieldGridVariant, mobile: boolean): string {
    if (variant === 'inputs') return mobile ? 'minmax(0,1fr) auto' : 'max-content 1fr';
    return mobile ? 'minmax(0,1fr) max-content' : 'max-content max-content';
}
