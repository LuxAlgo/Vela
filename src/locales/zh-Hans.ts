// `@luxalgo/vela/locales/zh-Hans`: every core message in Simplified Chinese. Importing it
// registers nothing: pass it to `registerLocale`, then set the locale `'zh-Hans'`.
import type { LocalePack } from '../core/i18n/types';
import messages from './zh-Hans.json';

const zhHans: LocalePack = { locale: 'zh-Hans', messages };

export default zhHans;
