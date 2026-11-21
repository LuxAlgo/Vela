// Line breaking for text drawn on the canvas (a note, a box's label). Lines break at spaces;
// scripts written without spaces between words (Thai, Lao, Khmer, Myanmar, Chinese,
// Japanese) also break between their words, found by `Intl.Segmenter`.
import { textSegmenter } from '../../core/i18n/text';

/** Scripts that write words without spaces between them. */
const UNSPACED = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/**
 * The break units of a run of text without spaces: its words, each carrying the
 * punctuation that follows it (a line never starts with a closing mark). One unit for
 * text in spaced scripts, or where the engine has no word segmenter.
 */
function breakUnits(token: string): string[] {
    if (!UNSPACED.test(token)) return [token];
    const words = textSegmenter(undefined, 'word');
    if (!words) return [token];
    const units: string[] = [];
    for (const { segment, isWordLike } of words.segment(token)) {
        if (units.length > 0 && isWordLike === false) units[units.length - 1] += segment;
        else units.push(segment);
    }
    return units;
}

/**
 * Wrap `text` to lines no wider than `maxWidth` (as `measure` reports widths). Hard line
 * breaks are kept; a unit wider than the line on its own overflows on a line of its own.
 */
export function wrapTextLines(text: string, maxWidth: number, measure: (text: string) => number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
        if (measure(para) <= maxWidth) {
            out.push(para);
            continue;
        }
        let line = '';
        for (const token of para.split(/(\s+)/)) {
            for (const unit of /^\s*$/.test(token) ? [token] : breakUnits(token)) {
                const trial = line + unit;
                if (line && measure(trial) > maxWidth) {
                    out.push(line.trimEnd());
                    line = unit.trimStart();
                } else {
                    line = trial;
                }
            }
        }
        if (line.trim()) out.push(line.trimEnd());
    }
    return out;
}
