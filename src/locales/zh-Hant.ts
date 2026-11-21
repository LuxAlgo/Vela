// `@luxalgo/vela/locales/zh-Hant`: every core message in Traditional Chinese. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'zh-Hant'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './zh-Hant.json';

const zhHant: LocalePack = { locale: 'zh-Hant', messages };

export default zhHant;
