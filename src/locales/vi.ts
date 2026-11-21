// `@luxalgo/vela/locales/vi`: every core message in Vietnamese. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'vi'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './vi.json';

const vi: LocalePack = { locale: 'vi', messages };

export default vi;
