import { MeasureBox } from './MeasureBox';

/**
 * The Date & Price Range drawing — a draggable box labelled with the price delta and/or
 * the date delta. Each line is toggled in settings (`showPrice` / `showDate`), so this one
 * tool covers price-only, date-only, and combined ranges.
 */
export class DatePriceRange extends MeasureBox {
    readonly type = 'datepricerange' as const;
}
